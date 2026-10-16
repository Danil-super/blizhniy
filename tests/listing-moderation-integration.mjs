import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {bootstrapPostgres,getBootstrapPlan} from '../scripts/bootstrap-postgres.mjs';
import {formModule} from './listing-form-module.mjs';
import {PostgresListingDraftStore,ListingDraftAccessError,ListingDraftConflictError} from './listing-draft-module.mjs';
import {loadAdminModule} from './admin-module.mjs';
import {moderationModule} from './listing-moderation-module.mjs';
import {createProductionListingModerationHandler} from './listing-moderation-http-module.mjs';
import {AuthRateLimiter} from '../src/lib/auth-http.ts';
import {createAdminListingModerationHandler} from './admin-listing-moderation-http-module.mjs';
import {IdentityStore} from '../src/lib/identity.ts';
const {PostgresListingModerationStore,ListingModerationInputError}=moderationModule;
const {AdminAccessError}=loadAdminModule('admin-authorization');
export async function testListingModeration(suite,operator,db,config,{owner,other,admin,token,otherToken,adminToken,session,a}){
 const store=new PostgresListingModerationStore(db),forms=new (formModule('postgres-listing-form').PostgresListingFormStore)(db);
 const down=readFileSync(new URL('../database/migrations/0014-listing-moderation.down.sql',import.meta.url),'utf8');
 const target=`${config.host}:${config.database}`;let saved,request;
 await suite.test('moderation upgrade and empty rollback are additive, journaled and grant nothing automatically',async()=>{
  const prior=(await operator.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;
  assert.equal((await bootstrapPostgres(operator,target,{includeListingModeration:true})).applied,1);
  assert.deepEqual((await operator.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows,getBootstrapPlan({includeListingModeration:true}).map(({name,sha256})=>({name,sha256})));
  await assert.rejects(db.query('select * from app.listing_moderation limit 0'),{code:'42501'});
  await operator.query(down);await operator.query("delete from blizhniy_meta.migrations where name='0014-listing-moderation.sql'");
  assert.deepEqual((await operator.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows,prior);
  assert.equal((await bootstrapPostgres(operator,target,{includeListingModeration:true})).applied,1);
  assert.equal((await bootstrapPostgres(operator,target,{includeListingModeration:true})).applied,0);
  await operator.query('grant select,insert(listing_id,revision),update(state,decision_note,decided_at,decided_by) on app.listing_moderation to blizhniy_runtime');
  for(const sql of ['delete from app.listing_moderation where false','truncate app.listing_moderation','update app.listing_moderation set revision=1 where false',"update app.listings set is_paid=true where false"])
   await assert.rejects(db.query(sql),{code:'42501'});
 });
 await suite.test('incomplete, foreign and stale drafts cannot enter moderation',async()=>{
  const empty=await new PostgresListingDraftStore(db).createEmpty(token,owner.id,randomUUID());
  await assert.rejects(store.submit(token,owner.id,empty.id,'1'),ListingModerationInputError);
  saved=await forms.update(token,owner.id,empty.id,'1',{kind:'prodam',title:'Проверка модерации',description:'Синтетическое объявление.',categorySlug:'otdyh',subcategoryName:'Турбазы',cityName:'Краснодар',contactPhone:'+79990000000',photoIds:[a]});
  await assert.rejects(store.submit(otherToken,owner.id,saved.id,saved.revision),ListingDraftAccessError);
  await assert.rejects(store.submit(otherToken,other.id,saved.id,saved.revision),ListingDraftAccessError);
  await assert.rejects(store.submit(token,owner.id,saved.id,'1'),ListingDraftConflictError);
  assert.equal((await store.read(token,owner.id,saved.id,saved.revision)).state,'not_submitted');
 });
 await suite.test('concurrent submissions share one durable revision-bound request without changing listing or paid state',async()=>{
  const before=(await operator.query('select * from app.listings where id=$1',[saved.id])).rows;
  const results=await Promise.all([store.submit(token,owner.id,saved.id,saved.revision),store.submit(await session(owner.id),owner.id,saved.id,saved.revision)]);
  assert.deepEqual(results[0],results[1]);request=results[0];assert.equal(request.state,'pending');assert.equal(request.revision,saved.revision);
  assert.equal((await operator.query('select count(*)::int as n from app.listing_moderation where listing_id=$1',[saved.id])).rows[0].n,1);
  assert.deepEqual((await operator.query('select * from app.listings where id=$1',[saved.id])).rows,before);
  assert.deepEqual(await store.read(token,owner.id,saved.id,saved.revision),request);
 });
 await suite.test('only a live database admin can inspect or decide current requests; no self approval or forged role',async()=>{
  await assert.rejects(store.inspect(token,request.id),AdminAccessError);
  await assert.rejects(store.decide(token,request.id,'approved',null),AdminAccessError);
  const detail=await store.inspect(adminToken,request.id);assert.equal(detail.snapshot.form.title,saved.form.title);assert.equal(detail.snapshot.revision,saved.revision);
  await assert.rejects(store.decide(adminToken,request.id,'rejected','  '),ListingModerationInputError);
  await operator.query("update app.users set role='user' where id=$1",[admin.id]);
  try{await assert.rejects(store.decide(adminToken,request.id,'approved',null),AdminAccessError);}finally{await operator.query("update app.users set role='admin' where id=$1",[admin.id]);}
  const queue=await store.list(adminToken,null);assert.ok(queue.items.some(item=>item.id===request.id));assert.ok(queue.items.length<=20);
 });
 await suite.test('approval remains unpaid and replay is stable; editing content invalidates the old decision',async()=>{
  const approved=await store.decide(adminToken,request.id,'approved',null);assert.equal(approved.state,'approved');
  assert.deepEqual(await store.decide(adminToken,request.id,'approved',null),approved);
  await assert.rejects(store.decide(adminToken,request.id,'rejected','Другое решение'),ListingDraftConflictError);
  const row=(await operator.query('select status,is_paid,published_at,expires_at from app.listings where id=$1',[saved.id])).rows[0];
  assert.deepEqual(row,{status:'draft',is_paid:false,published_at:null,expires_at:null});
  saved=await forms.update(token,owner.id,saved.id,saved.revision,{...saved.form,title:'Изменённый текст'});
  assert.equal((await store.read(token,owner.id,saved.id,saved.revision)).state,'outdated');
  await assert.rejects(store.inspect(adminToken,request.id),ListingDraftConflictError);
  await assert.rejects(store.decide(adminToken,request.id,'approved',null),ListingDraftConflictError);
  const next=await store.submit(token,owner.id,saved.id,saved.revision);assert.notEqual(next.id,request.id);request=next;
 });
 await suite.test('opposing concurrent decisions have one winner and preserve a bounded rejection reason',async()=>{
  const results=await Promise.allSettled([store.decide(adminToken,request.id,'rejected','Исправьте описание'),store.decide(await session(admin.id),request.id,'approved',null)]);
  assert.equal(results.filter(item=>item.status==='fulfilled').length,1);assert.ok(results.some(item=>item.status==='rejected'&&item.reason instanceof ListingDraftConflictError));
  const result=await store.read(token,owner.id,saved.id,saved.revision);assert.ok(['approved','rejected'].includes(result.state));
  if(result.state==='rejected'){assert.equal(result.note,'Исправьте описание');assert.deepEqual(await store.submit(token,owner.id,saved.id,saved.revision),result);}
 });
 await suite.test('a lost submit acknowledgement is not retried and resolves by private readback',async()=>{
  saved=await forms.update(token,owner.id,saved.id,saved.revision,{...saved.form,title:'Повторная проверка'});
  let attempts=0;const uncertain=new PostgresListingModerationStore({transaction:async work=>{attempts++;await db.transaction(work);throw new Error('Synthetic lost commit response');}});
  await assert.rejects(uncertain.submit(token,owner.id,saved.id,saved.revision),/Synthetic lost commit/);assert.equal(attempts,1);
  const recovered=await store.read(token,owner.id,saved.id,saved.revision);assert.equal(recovered.state,'pending');
  assert.deepEqual(await store.submit(token,owner.id,saved.id,saved.revision),recovered);
 });
 await suite.test('inactive references can be inspected and rejected but never approved; tariff availability does not gate review',async()=>{
  const request=await store.read(token,owner.id,saved.id,saved.revision);
  const category=(await operator.query('select category_id from app.listings where id=$1',[saved.id])).rows[0].category_id;
  await operator.query('update app.categories set active=false where id=$1',[category]);
  try{
   const detail=await store.inspect(adminToken,request.id);assert.ok(detail.check.issues.some(item=>item.field==='category'));
   await assert.rejects(store.decide(adminToken,request.id,'approved',null),ListingModerationInputError);
   assert.equal((await store.decide(adminToken,request.id,'rejected','Категория отключена')).state,'rejected');
  }finally{await operator.query('update app.categories set active=true where id=$1',[category]);}
  saved=await forms.update(token,owner.id,saved.id,saved.revision,{...saved.form,title:'Без доступного тарифа'});
  const offer=(await operator.query("select id,active from app.tariffs where action='listing_publication'")).rows[0];
  await operator.query('update app.tariffs set active=false where id=$1',[offer.id]);
  try{assert.equal((await store.submit(token,owner.id,saved.id,saved.revision)).state,'pending');}
  finally{await operator.query('update app.tariffs set active=$2 where id=$1',[offer.id,offer.active]);}
 });
 await suite.test('blocked authors and self-owned admin listings cannot receive approval',async()=>{
  const request=await store.read(token,owner.id,saved.id,saved.revision);
  await operator.query('update app.users set is_blocked=true where id=$1',[owner.id]);
  try{await assert.rejects(store.inspect(adminToken,request.id),ListingDraftAccessError);await assert.rejects(store.decide(adminToken,request.id,'approved',null),ListingDraftAccessError);}
  finally{await operator.query('update app.users set is_blocked=false where id=$1',[owner.id]);}
  const own=await new PostgresListingDraftStore(db).createEmpty(adminToken,admin.id,randomUUID());
  const complete=await forms.update(adminToken,admin.id,own.id,'1',{...saved.form,photoIds:[]});
  const review=await store.submit(adminToken,admin.id,own.id,complete.revision);
  await assert.rejects(store.decide(adminToken,review.id,'approved',null),AdminAccessError);
 });
 await suite.test('session expiring after insert rolls back the request, not only its HTTP response',async()=>{
  saved=await forms.update(token,owner.id,saved.id,saved.revision,{...saved.form,title:'Проверка истечения сессии'});
  let reached=false;const delayed=new PostgresListingModerationStore({transaction:work=>db.transaction(tx=>work({query:async(sql,values)=>{
   const result=await tx.query(sql,values);if(sql.startsWith('insert into app.listing_moderation')){reached=true;await operator.query('select pg_sleep(0.6)');}return result;
  }}))});
  await assert.rejects(delayed.submit(await session(owner.id,true),owner.id,saved.id,saved.revision),loadAdminModule('app-session-transaction').AppSessionAccessError);
  assert.equal(reached,true);assert.equal((await store.read(token,owner.id,saved.id,saved.revision)).state,'outdated');
 });
 await suite.test('nonempty rollback refuses to erase moderation history and public has no access',async()=>{
  try{await assert.rejects(operator.query(down),/Refusing to remove nonempty listing moderation/);}finally{await operator.query('rollback');}
  assert.equal((await operator.query("select exists(select 1 from pg_class c,lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid='app.listing_moderation'::regclass and a.grantee=0) as allowed")).rows[0].allowed,false);
  assert.ok((await operator.query('select count(*)::int as n from app.listing_moderation')).rows[0].n>=3);
 });
 await suite.test('owner HTTP uses real cookie transaction, limited SQL and safe private readback',async()=>{
  const origin='https://app.example.invalid',events=[],limiter=new AuthRateLimiter(db,'m'.repeat(64));
  const handle=createProductionListingModerationHandler({origin},()=>({store,limiter}),event=>events.push(event));
  const body={expectedOwnerId:owner.id,listingId:saved.id,expectedRevision:saved.revision};
  const request=(data=body,credential=token,method='POST')=>new Request(origin+'/api/account/listing-moderation',{method,headers:{host:'app.example.invalid',origin,'x-blizhniy-request':'1','x-real-ip':'192.0.2.66','content-type':'application/json',cookie:'__Host-blizhniy_session='+credential},body:JSON.stringify(data)});
  assert.equal((await handle(request(body,token,'PUT'))).status,200);
  assert.equal((await (await handle(request())).json()).state,'pending');
  assert.equal((await handle(request({...body,expectedOwnerId:other.id},otherToken))).status,404);
  assert.equal((await handle(request({...body,expectedOwnerId:owner.id},otherToken))).status,404);
  assert.equal((await handle(request({...body,expectedRevision:'1'},token,'PUT'))).status,409);
  assert.equal((await handle(request({...body,state:'approved'},token,'PUT'))).status,422);
  for(const value of [token,owner.id,saved.id])assert.equal(JSON.stringify(events).includes(value),false);
  await assert.rejects(db.query("insert into app.listing_moderation(listing_id,revision,state) values($1,$2,'approved')",[saved.id,'900000']),{code:'42501'});
 });
 await suite.test('admin requests bind the expected account, not just any administrator cookie',async()=>{
  const review=await store.read(token,owner.id,saved.id,saved.revision);
  await assert.rejects(store.inspect(adminToken,review.id,other.id),AdminAccessError);
  await assert.rejects(store.list(adminToken,null,other.id),AdminAccessError);
  await assert.rejects(store.decide(adminToken,review.id,'approved',null,other.id),AdminAccessError);
  assert.equal((await store.inspect(adminToken,review.id,admin.id)).snapshot.id,saved.id);
 });
 await suite.test('admin image preview authorizes current review and exact photo before any file read',async()=>{
  const review=await store.read(token,owner.id,saved.id,saved.revision);let reads=0;
  const preview=new PostgresListingModerationStore(db,{read:async record=>{reads++;assert.equal(record.id,a);assert.equal(record.mimeType,'image/webp');return Buffer.alloc(record.size);}});
  await operator.query('grant select(sha256) on app.media_objects to blizhniy_runtime');
  await assert.rejects(preview.readPhoto(token,review.id,a,owner.id),AdminAccessError);
  await assert.rejects(preview.readPhoto(adminToken,review.id,a,other.id),AdminAccessError);
  await assert.rejects(preview.readPhoto(adminToken,review.id,randomUUID(),admin.id),ListingDraftAccessError);assert.equal(reads,0);
  const unlinked=(await operator.query("select id from app.media_objects where owner_id=$1 and state='ready' and id<>$2 limit 1",[owner.id,a])).rows[0].id;
  await assert.rejects(preview.readPhoto(adminToken,review.id,unlinked,admin.id),ListingDraftAccessError);assert.equal(reads,0);
  const photo=await preview.readPhoto(adminToken,review.id,a,admin.id);assert.equal(photo.record.id,a);assert.equal(photo.bytes.length,12);assert.equal(reads,1);
  saved=await forms.update(token,owner.id,saved.id,saved.revision,{...saved.form,title:'Новая версия после просмотра'});
  await assert.rejects(preview.readPhoto(adminToken,review.id,a,admin.id),ListingDraftConflictError);assert.equal(reads,1);
 });
 await suite.test('moderation queue excludes self-owned admin submissions and paginates every current request once',async()=>{
  const own=(await operator.query('select id from app.listings where author_id=$1',[admin.id])).rows.map(row=>row.id);
  const queue=await store.list(adminToken,null,admin.id);assert.equal(queue.items.some(item=>own.includes(item.listingId)),false);
  const drafts=(await operator.query(`insert into app.listings(author_id,listing_type,title,description,category_id,city_id,contact_phone)
   select $1,'sell','Проверка очереди','Синтетическое описание',category_id,city_id,'+79990000000' from app.listings cross join generate_series(1,25) where id=$2 returning id`,[owner.id,saved.id])).rows.map(row=>row.id);
  await operator.query('insert into app.listing_moderation(listing_id,revision) select id,revision from app.listings where id=any($1::uuid[])',[drafts]);
  const expected=(await operator.query(`select m.id from app.listing_moderation m join app.listings l on l.id=m.listing_id and l.revision=m.revision
   where m.state='pending' and l.status='draft' and l.author_id<>$1 order by m.submitted_at,m.id`,[admin.id])).rows.map(row=>row.id);
  let cursor=null;const found=[];for(let n=0;n<5;n++){const page=await store.list(adminToken,cursor,admin.id);assert.ok(page.items.length<=20);found.push(...page.items.map(item=>item.id));cursor=page.nextCursor;if(!cursor)break;}
  assert.equal(cursor,null);assert.deepEqual(found,expected);assert.equal(new Set(found).size,found.length);
 });
 await suite.test('admin HTTP composes real role/CAS authorization and private photos without publication or paid writes',async()=>{
  const review=await store.submit(token,owner.id,saved.id,saved.revision),origin='https://app.example.invalid',events=[];
  const preview=new PostgresListingModerationStore(db,{read:async record=>Buffer.alloc(record.size)});
  const handle=createAdminListingModerationHandler({origin},()=>({store:preview,identity:new IdentityStore(db),limiter:new AuthRateLimiter(db,'n'.repeat(64))}),event=>events.push(event));
  const request=(body,credential=adminToken,expectedAdminId=admin.id,method='POST')=>new Request(origin+'/api/admin/listing-moderation',{method,
   headers:{host:'app.example.invalid',origin,'x-blizhniy-request':'1','x-real-ip':'192.0.2.77','content-type':'application/json',cookie:'__Host-blizhniy_session='+credential},body:JSON.stringify({expectedAdminId,...body})});
  assert.equal((await handle(request({action:'inspect',requestId:review.id},token,owner.id))).status,403);
  assert.equal((await handle(request({action:'inspect',requestId:review.id},adminToken,other.id))).status,403);
  const detail=await handle(request({action:'inspect',requestId:review.id}));assert.equal(detail.status,200);assert.equal((await detail.json()).snapshot.id,saved.id);
  const photo=await handle(request({action:'photo',requestId:review.id,fileId:a}));assert.equal(photo.status,200);assert.equal((await photo.arrayBuffer()).byteLength,12);
  const accepted=await handle(request({requestId:review.id,state:'approved',note:null},adminToken,admin.id,'PUT'));assert.equal(accepted.status,200);assert.equal((await accepted.json()).state,'approved');
  assert.deepEqual((await operator.query('select status,is_paid,published_at,expires_at from app.listings where id=$1',[saved.id])).rows[0],{status:'draft',is_paid:false,published_at:null,expires_at:null});
  for(const value of [token,adminToken,owner.id,saved.id,a])assert.equal(JSON.stringify(events).includes(value),false);
 });
}
