import assert from 'node:assert/strict';import {randomBytes,randomUUID} from 'node:crypto';
import {createPostgresDatabase} from '../src/lib/postgres.ts';import {hashSessionToken} from '../src/lib/identity.ts';
import * as contract from '../src/lib/service-publication-contract.ts';import {workPublicationModule} from './work-publication-module.mjs';
const {PostgresServicePublicationStore,ServicePublicationAccessError,ServicePublicationConflictError}=workPublicationModule('postgres-service-publications',{'./service-publication-contract.ts':contract});
export async function testServicePublications(suite,admin,config,credentials){
 assert.equal(config.host,'127.0.0.1');const db=createPostgresDatabase({NODE_ENV:'test',BLIZHNIY_DB_HOST:config.host,BLIZHNIY_DB_PORT:String(config.port),BLIZHNIY_DB_NAME:config.database,
  BLIZHNIY_DB_USER:credentials.user,BLIZHNIY_DB_PASSWORD:credentials.password,BLIZHNIY_DB_SSL_MODE:'disable'}),store=new PostgresServicePublicationStore(db);
 const owner=randomUUID(),other=randomUUID(),token=randomBytes(32).toString('hex'),otherToken=randomBytes(32).toString('hex'),saved=new Map();
 try{
  for(const [id,session] of [[owner,token],[other,otherToken]]){
   await admin.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',[id,`service-store-${id}@example.invalid`,`scrypt$131072$8$1$${'c'.repeat(32)}$${'d'.repeat(128)}`]);
   await admin.query("insert into app.sessions(token_hash,user_id,scope,auth_version,expires_at) values($1,$2,'app',0,clock_timestamp()+interval '1 hour')",[hashSessionToken(session),id]);
  }
  await suite.test('three cookie-owned service forms persist complete distinct fields and stable intents without publishing or paying',async()=>{
   const forms={specialist:{title:'Технический мастер',cityName:'Краснодар',professionName:'Сантехник',price:'1250.50',skills:'Ремонт',experience:'5 лет',videoUrl:'https://example.invalid/video'},
    fair:{title:'Мастерская',category:'Посуда',comment:'Синтетические пожелания',cityName:'Краснодар'},marquee:{title:'Синтетический рекламный текст',href:'https://example.invalid/'}};
   for(const kind of ['specialist','fair','marquee']){
    const key=randomUUID(),form=contract.parseServicePublicationForm(kind,forms[kind]),row=await store.create(token,owner,kind,key,form);saved.set(kind,{key,row});
    assert.deepEqual(row.form,form);assert.equal(row.revision,'1');assert.equal(row.paid,false);assert.equal(row.status,'draft');
    assert.deepEqual(await store.read(token,owner,kind,row.id),row);assert.deepEqual(await store.readIntent(token,owner,kind,key),row);
    assert.deepEqual(await store.create(token,owner,kind,key,form),row);assert.equal((await store.list(token,owner,kind,null)).items.length,1);
   }
  });
  await suite.test('one specialist per account is enforced even for two different creation intents without overwriting the saved profile',async()=>{
   const before=saved.get('specialist').row,results=await Promise.all([store.create(token,owner,'specialist',randomUUID(),{title:'Другой мастер'}),store.create(token,owner,'specialist',randomUUID(),{title:'Ещё один мастер'})]);
   for(const row of results)assert.deepEqual(row,before);assert.equal((await store.list(token,owner,'specialist',null)).items.length,1);
  });
  await suite.test('service foreign IDs, wrong kinds, expected-owner substitution and revoked sessions never disclose private forms',async()=>{
   for(const [kind,{row}] of saved){await assert.rejects(store.read(otherToken,other,kind,row.id),ServicePublicationAccessError);await assert.rejects(store.read(otherToken,owner,kind,row.id),ServicePublicationAccessError);}
   await assert.rejects(store.read(token,owner,'fair',saved.get('specialist').row.id),ServicePublicationAccessError);
   assert.deepEqual((await store.list(otherToken,other,'fair',null)).items,[]);
   await admin.query('delete from app.sessions where token_hash=$1',[hashSessionToken(otherToken)]);await assert.rejects(store.read(otherToken,other,'fair',saved.get('fair').row.id),{name:'AppSessionAccessError'});
  });
  await suite.test('service CAS has one winner, preserves every form field and rejects stale or exhausted exact revisions',async()=>{
   const before=saved.get('fair').row,results=await Promise.allSettled(['Первая','Вторая'].map(title=>store.update(token,owner,'fair',before.id,before.revision,{...before.form,title})));
   const good=results.filter(result=>result.status==='fulfilled'),bad=results.filter(result=>result.status==='rejected');assert.equal(good.length,1);assert.equal(bad.length,1);assert.ok(bad[0].reason instanceof ServicePublicationConflictError);
   assert.equal(good[0].value.form.comment,before.form.comment);assert.equal(good[0].value.revision,'2');saved.get('fair').row=good[0].value;
   await admin.query('update app.service_publications set revision=9007199254740993 where id=$1',[before.id]);
   assert.equal((await store.update(token,owner,'fair',before.id,'9007199254740993',before.form)).revision,'9007199254740994');
   await admin.query('update app.service_publications set revision=9223372036854775807 where id=$1',[before.id]);
   await assert.rejects(store.update(token,owner,'fair',before.id,'9223372036854775807',before.form),ServicePublicationConflictError);
  });
  await suite.test('service photos require ready owned immutable media, and invalid references roll back the entire form and CAS',async()=>{
   const before=saved.get('specialist').row,photos=[];
   for(const id of [owner,other]){
    const media=(await admin.query("insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256) values($1,gen_random_uuid(),'image/webp',40,20,12,$2) returning id",[id,'e'.repeat(64)])).rows[0].id;
    await admin.query("update app.media_objects set state='ready',ready_at=clock_timestamp() where id=$1",[media]);photos.push(media);
   }
   const after=await store.update(token,owner,'specialist',before.id,before.revision,{...before.form,photoIds:[photos[0]]});
   assert.deepEqual(after.photos.map(item=>item.id),[photos[0]]);
   await assert.rejects(store.update(token,owner,'specialist',after.id,after.revision,{...after.form,photoIds:photos}),ServicePublicationAccessError);
   await assert.rejects(store.update(token,owner,'specialist',after.id,after.revision,{...after.form,cityName:'Неизвестный город fixture'}),contract.ServicePublicationInputError);
   assert.deepEqual(await store.read(token,owner,'specialist',after.id),after);
  });
  await suite.test('lost service create acknowledgement is recovered by exact read intent, without a second write',async()=>{
   let commits=0;const unknown=new PostgresServicePublicationStore({transaction:async work=>{await db.transaction(work);commits++;throw Error('Synthetic lost acknowledgement');}}),key=randomUUID();
   await assert.rejects(unknown.create(token,owner,'marquee',key,{title:'Неизвестный результат записи'}));
   assert.equal((await store.readIntent(token,owner,'marquee',key)).form.title,'Неизвестный результат записи');assert.equal(commits,1);
  });
  await suite.test('service owner pagination preserves microsecond order and omits private form fields from bulk replies',async()=>{
   for(let n=1;n<=25;n++)await admin.query("insert into app.service_publications(author_id,kind,creation_key,form,updated_at) values($1,'marquee',gen_random_uuid(),$2::jsonb,$3)",[owner,JSON.stringify(contract.parseServicePublicationForm('marquee',{title:`Реклама номер ${n}`})),`2026-01-01T00:00:00.${String(n).padStart(6,'0')}Z`]);
   const first=await store.list(token,owner,'marquee',null),second=await store.list(token,owner,'marquee',first.nextCursor),all=[...first.items,...second.items];
   assert.equal(first.items.length,20);assert.equal(all.length,27);assert.equal(new Set(all.map(item=>item.id)).size,27);assert.match(first.nextCursor.updatedAt,/\.\d{6}Z$/);assert.equal(second.nextCursor,null);
   for(const item of all)assert.equal(Object.hasOwn(item,'form'),false);
  });
 }finally{await db.close();}
}
