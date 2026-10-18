import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createPostgresDatabase} from '../src/lib/postgres.ts';
import {hashSessionToken} from '../src/lib/identity.ts';
import {workPublicationModule} from './work-publication-module.mjs';
import {loadAdminModule} from './admin-module.mjs';
import * as decisions from '../src/lib/work-moderation-contract.ts';
const publications=workPublicationModule('postgres-work-publications');
export async function testWorkModeration(suite,admin,config,credentials){
 assert.equal(config.host,'127.0.0.1');
 const {PostgresWorkModerationStore}=workPublicationModule('postgres-work-moderation',{
  './postgres-work-publications':publications,'./admin-authorization':loadAdminModule('admin-authorization'),'./work-moderation-contract':decisions,
 });
 const db=createPostgresDatabase({NODE_ENV:'test',BLIZHNIY_DB_HOST:config.host,BLIZHNIY_DB_PORT:String(config.port),BLIZHNIY_DB_NAME:config.database,
  BLIZHNIY_DB_USER:credentials.user,BLIZHNIY_DB_PASSWORD:credentials.password,BLIZHNIY_DB_SSL_MODE:'disable'});
 const store=new PostgresWorkModerationStore(db),forms=new publications.PostgresWorkPublicationStore(db),users=[];
 const hash=`scrypt$131072$8$1$${'c'.repeat(32)}$${'d'.repeat(128)}`;let saved,submitted;
 try{
  for(const role of ['user','admin','admin']){const id=randomUUID(),token=randomBytes(32).toString('hex');users.push({id,token});
   await admin.query('insert into app.users(id,email,password_hash,email_verified_at,role) values($1,$2,$3,clock_timestamp(),$4)',[id,`work-review-${id}@example.invalid`,hash,role]);
   await admin.query("insert into app.sessions(token_hash,user_id,scope,auth_version,expires_at) values($1,$2,'app',0,clock_timestamp()+interval '1 hour')",[hashSessionToken(token),id]);}
  const [owner,reviewer,second]=users;
  await admin.query('grant select on app.work_moderation to blizhniy_runtime');
  await admin.query('grant insert(publication_id,revision),update(state,decided_at,decided_by,decision_note) on app.work_moderation to blizhniy_runtime');
  await suite.test('work review requires complete form, active references, owner cookie and exact current revision',async()=>{
   const draft=await forms.create(owner.token,owner.id,'vacancy',randomUUID(),{title:'Incomplete'});
   await assert.rejects(store.submit(owner.token,owner.id,'vacancy',draft.id,draft.revision),decisions.WorkModerationInputError);
   saved=await forms.create(owner.token,owner.id,'workRequest',randomUUID(),{title:'Нужен мастер',description:'Нужно выполнить ремонт.',cityName:'Краснодар',professionName:'Сантехник',contactPhone:'+79990000000',placementRightConfirmed:true});
   await assert.rejects(store.submit(reviewer.token,owner.id,'workRequest',saved.id,saved.revision),publications.WorkPublicationAccessError);
   await assert.rejects(store.submit(owner.token,owner.id,'workRequest',saved.id,'2'),publications.WorkPublicationConflictError);
   assert.equal((await store.read(owner.token,owner.id,'workRequest',saved.id,saved.revision)).state,'not_submitted');
   submitted=await store.submit(owner.token,owner.id,'workRequest',saved.id,saved.revision);
   assert.equal(submitted.state,'pending');assert.deepEqual(await store.submit(owner.token,owner.id,'workRequest',saved.id,saved.revision),submitted);
   assert.equal((await admin.query('select count(*)::int as n from app.work_moderation where publication_id=$1',[saved.id])).rows[0].n,1);
  });
  await suite.test('work queue has independent server admin checks and no self-review',async()=>{
   await assert.rejects(store.list(owner.token,null,owner.id),{name:'AdminAccessError'});
   await assert.rejects(store.list(reviewer.token,null,second.id),{name:'AdminAccessError'});
   const page=await store.list(reviewer.token,null,reviewer.id);assert.ok(page.items.some(item=>item.id===submitted.id));
   const inspected=await store.inspect(reviewer.token,submitted.id,reviewer.id);assert.deepEqual(inspected.snapshot,saved);assert.deepEqual(inspected.issues,[]);
   const own=await forms.create(reviewer.token,reviewer.id,'workRequest',randomUUID(),saved.form);
   const ownReview=await store.submit(reviewer.token,reviewer.id,'workRequest',own.id,own.revision);
   await assert.rejects(store.inspect(reviewer.token,ownReview.id,reviewer.id),{name:'AdminAccessError'});
   await assert.rejects(store.decide(reviewer.token,ownReview.id,'approved',null,reviewer.id),{name:'AdminAccessError'});
  });
  await suite.test('competing work decisions have one winner, retries preserve exactly that decision and never publish or pay',async()=>{
   const results=await Promise.allSettled([store.decide(reviewer.token,submitted.id,'approved',null,reviewer.id),store.decide(second.token,submitted.id,'rejected','Уточните задачу.',second.id)]);
   const good=results.filter(row=>row.status==='fulfilled'),bad=results.filter(row=>row.status==='rejected');assert.equal(good.length,1);assert.equal(bad.length,1);assert.ok(bad[0].reason instanceof publications.WorkPublicationConflictError);
   const winner=good[0].value;assert.deepEqual(await store.decide(reviewer.token,submitted.id,winner.state,winner.note,reviewer.id),winner);
   assert.deepEqual(await forms.read(owner.token,owner.id,'workRequest',saved.id),saved);
  });
  await suite.test('editing invalidates work approval and old pending reviews cannot act on a new revision',async()=>{
   saved=await forms.update(owner.token,owner.id,'workRequest',saved.id,saved.revision,{...saved.form,title:'Новая задача'});
   assert.equal((await store.read(owner.token,owner.id,'workRequest',saved.id,saved.revision)).state,'outdated');
   await assert.rejects(store.inspect(reviewer.token,submitted.id,reviewer.id),publications.WorkPublicationConflictError);
   const current=await store.submit(owner.token,owner.id,'workRequest',saved.id,saved.revision);
   assert.notEqual(current.id,submitted.id);assert.equal(current.revision,saved.revision);
   await admin.query('update app.specialist_categories set active=false where name=$1',[saved.form.professionName]);
   try{await assert.rejects(store.decide(reviewer.token,current.id,'approved',null,reviewer.id),decisions.WorkModerationInputError);}
   finally{await admin.query('update app.specialist_categories set active=true where name=$1',[saved.form.professionName]);}
  });
 }finally{await db.close();}
}
