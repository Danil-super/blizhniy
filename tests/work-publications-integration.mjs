import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createPostgresDatabase} from '../src/lib/postgres.ts';
import {hashSessionToken} from '../src/lib/identity.ts';
import {parseWorkPublicationForm,WorkPublicationInputError} from '../src/lib/work-publication-contract.ts';
import {workPublicationModule} from './work-publication-module.mjs';
const {PostgresWorkPublicationStore,WorkPublicationAccessError,WorkPublicationConflictError}=workPublicationModule('postgres-work-publications');

export async function testWorkPublications(suite,admin,config,credentials){
 assert.equal(config.host,'127.0.0.1');
 const db=createPostgresDatabase({NODE_ENV:'test',BLIZHNIY_DB_HOST:config.host,BLIZHNIY_DB_PORT:String(config.port),BLIZHNIY_DB_NAME:config.database,
  BLIZHNIY_DB_USER:credentials.user,BLIZHNIY_DB_PASSWORD:credentials.password,BLIZHNIY_DB_SSL_MODE:'disable'}),store=new PostgresWorkPublicationStore(db);
 const hash=`scrypt$131072$8$1$${'c'.repeat(32)}$${'d'.repeat(128)}`,owner=randomUUID(),other=randomUUID();
 const token=randomBytes(32).toString('hex'),otherToken=randomBytes(32).toString('hex');
 let saved;
 try{
  for(const [id,session] of [[owner,token],[other,otherToken]]){
   await admin.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',[id,`work-store-${id}@example.invalid`,hash]);
   await admin.query("insert into app.sessions(token_hash,user_id,scope,auth_version,expires_at) values($1,$2,'app',0,clock_timestamp()+interval '1 hour')",[hashSessionToken(session),id]);
  }
  await admin.query('grant select on app.work_publications,app.work_publication_photos to blizhniy_runtime');
  await admin.query('grant insert(author_id,kind,creation_key,form,city_id,profession_id) on app.work_publications to blizhniy_runtime');
  await admin.query('grant update(form,city_id,profession_id,revision,updated_at) on app.work_publications to blizhniy_runtime');
  await admin.query('grant insert(publication_id,media_id,position),delete on app.work_publication_photos to blizhniy_runtime');
  await suite.test('cookie-owned work creation is complete, stable-intent idempotent and persists exact fields across reads',async()=>{
   const key=randomUUID(),form=parseWorkPublicationForm('workRequest',{title:'Заказ мастеру',description:'Нужен ремонт',cityName:'Краснодар',budget:'1250.50',contactPhone:'+79990000000'});
   saved=await store.create(token,owner,'workRequest',key,form);
   assert.equal(saved.form.budget,'1250.50');assert.equal(saved.revision,'1');assert.equal(saved.status,'draft');assert.equal(saved.paid,false);
   assert.deepEqual(await store.read(token,owner,'workRequest',saved.id),saved);
   assert.deepEqual(await store.create(token,owner,'workRequest',key,form),saved);
   assert.deepEqual(await store.readIntent(token,owner,'workRequest',key),saved);
   assert.equal((await store.list(token,owner,'workRequest',null)).items.length,1);
   assert.equal(await store.readIntent(token,owner,'workRequest',randomUUID()),null);
  });
  await suite.test('work stores reject a foreign owner, another kind and revoked sessions without exposing a private form',async()=>{
   await assert.rejects(store.read(otherToken,other,'workRequest',saved.id),WorkPublicationAccessError);
   await assert.rejects(store.read(otherToken,owner,'workRequest',saved.id),WorkPublicationAccessError);
   await assert.rejects(store.read(token,owner,'vacancy',saved.id),WorkPublicationAccessError);
   assert.deepEqual((await store.list(otherToken,other,'workRequest',null)).items,[]);
   await admin.query('delete from app.sessions where token_hash=$1',[hashSessionToken(otherToken)]);
   await assert.rejects(store.read(otherToken,other,'workRequest',saved.id),{name:'AppSessionAccessError'});
  });
  await suite.test('work edits use exact CAS and concurrent edits never overwrite each other',async()=>{
   const update=title=>store.update(token,owner,'workRequest',saved.id,saved.revision,{...saved.form,title});
   const results=await Promise.allSettled([update('Первая вкладка'),update('Вторая вкладка')]);
   const good=results.filter(row=>row.status==='fulfilled'),bad=results.filter(row=>row.status==='rejected');
   assert.equal(good.length,1);assert.equal(bad.length,1);assert.ok(bad[0].reason instanceof WorkPublicationConflictError);
   saved=good[0].value;assert.equal(saved.revision,'2');
   await assert.rejects(store.update(token,owner,'workRequest',saved.id,'1',saved.form),WorkPublicationConflictError);
   assert.deepEqual(await store.read(token,owner,'workRequest',saved.id),saved);
  });
  await suite.test('unknown work commit is recovered by reading the same intent, not by creating another record',async()=>{
   const key=randomUUID(),form=parseWorkPublicationForm('vacancy',{title:'Вакансия мастера',organization:'Работодатель',employerType:'person',salary:'45000'});
   let writes=0;const uncertain=new PostgresWorkPublicationStore({transaction:async work=>{writes++;await db.transaction(work);throw Error('Synthetic lost commit');}});
   await assert.rejects(uncertain.create(token,owner,'vacancy',key,form));
   const result=await store.readIntent(token,owner,'vacancy',key);
   assert.equal(result.form.salary,'45000.00');assert.equal(writes,1);assert.equal((await store.list(token,owner,'vacancy',null)).items.length,1);
  });
  await suite.test('work photo ownership and reference failures roll back the complete form, revision and associations',async()=>{
   const media=[];
   for(const user of [owner,other]){
    const row=(await admin.query("insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256) values($1,gen_random_uuid(),'image/webp',80,40,12,$2) returning id",[user,'a'.repeat(64)])).rows[0];
    await admin.query("update app.media_objects set state='ready',ready_at=clock_timestamp() where id=$1",[row.id]);media.push(row.id);
   }
   const form={...saved.form,photoIds:[media[0]]};
   saved=await store.update(token,owner,'workRequest',saved.id,saved.revision,form);
   assert.deepEqual(saved.photos.map(row=>row.id),[media[0]]);
   await assert.rejects(store.update(token,owner,'workRequest',saved.id,saved.revision,{...form,photoIds:media}),WorkPublicationAccessError);
   await assert.rejects(store.update(token,owner,'workRequest',saved.id,saved.revision,{...form,cityName:'Неизвестный город fixture'}),WorkPublicationInputError);
   assert.deepEqual(await store.read(token,owner,'workRequest',saved.id),saved);
  });
  await suite.test('work runtime cannot forge payment/status/owner columns and exact high revisions stay decimal strings',async()=>{
   for(const field of ['is_paid','status','author_id']){
    const assignment=field==='is_paid'?'true':field==='status'?"'published'":'gen_random_uuid()';
    await assert.rejects(db.query(`update app.work_publications set ${field}=${assignment} where false`),{code:'42501'});
   }
   await admin.query('update app.work_publications set revision=9007199254740993 where id=$1',[saved.id]);
   saved=await store.update(token,owner,'workRequest',saved.id,'9007199254740993',saved.form);
   assert.equal(saved.revision,'9007199254740994');assert.equal(saved.paid,false);assert.equal(saved.status,'draft');
  });
  await suite.test('work keyset pagination preserves PostgreSQL microseconds without missing or duplicating owner rows',async()=>{
   for(let i=1;i<=25;i++)await admin.query("insert into app.work_publications(author_id,kind,creation_key,form,updated_at) values($1,'workRequest',gen_random_uuid(),$2::jsonb,$3)",
    [owner,JSON.stringify(parseWorkPublicationForm('workRequest',{title:`Страница ${i}`})),`2026-01-01T00:00:00.${String(i).padStart(6,'0')}Z`]);
   const first=await store.list(token,owner,'workRequest',null);
   assert.equal(first.items.length,20);assert.match(first.nextCursor.updatedAt,/\.\d{6}Z$/);
   const second=await store.list(token,owner,'workRequest',first.nextCursor),ids=[...first.items,...second.items].map(row=>row.id);
   assert.equal(ids.length,26);assert.equal(new Set(ids).size,26);assert.equal(second.nextCursor,null);
  });
 }finally{
  // The parent destroys its verified, disposable container. Do not bypass the
  // media cleanup-proof trigger or owner RESTRICT policy to erase SQL fixtures.
  await db.close();
 }
}
