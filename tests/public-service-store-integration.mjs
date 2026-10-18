import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {createPostgresDatabase} from '../src/lib/postgres.ts';import {workPublicationModule} from './work-publication-module.mjs';
import {parseServicePublicationForm} from '../src/lib/service-publication-contract.ts';import * as projection from '../src/lib/public-service-publications.ts';
export async function testPublicServiceStore(suite,admin,config,credentials){
 assert.equal(config.host,'127.0.0.1');const {PostgresPublicServiceStore}=workPublicationModule('postgres-public-service',{'./public-service-publications.ts':projection});
 const db=createPostgresDatabase({NODE_ENV:'test',BLIZHNIY_DB_HOST:config.host,BLIZHNIY_DB_PORT:String(config.port),BLIZHNIY_DB_NAME:config.database,BLIZHNIY_DB_USER:credentials.user,BLIZHNIY_DB_PASSWORD:credentials.password,BLIZHNIY_DB_SSL_MODE:'disable'}),store=new PostgresPublicServiceStore(db),owner=randomUUID(),rows=[];
 try{
  await admin.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',[owner,`public-service-${owner}@example.invalid`,`scrypt$131072$8$1$${'c'.repeat(32)}$${'d'.repeat(128)}`]);
  const refs=(await admin.query("select (select id from app.cities where name='Краснодар') as city,(select id from app.specialist_categories where name='Сантехник') as profession")).rows[0];
  for(const kind of ['specialist','fair','marquee']){
   const form=parseServicePublicationForm(kind,{title:'Публичный синтетический материал',placementRightConfirmed:true,...(kind==='marquee'?{href:'https://example.invalid/'}:{description:'Подробное описание синтетического материала.',cityName:'Краснодар',contactPhone:'+79990000000',email:'private@example.invalid',...(kind==='specialist'?{professionName:'Сантехник',price:'1250.50',skills:'Монтаж'}:{category:'Посуда',comment:'Приватный комментарий'})})});
   const {id}=(await admin.query('insert into app.service_publications(author_id,kind,creation_key,form,city_id,profession_id) values($1,$2,gen_random_uuid(),$3::jsonb,$4,$5) returning id',[owner,kind,JSON.stringify(form),kind==='marquee'?null:refs.city,kind==='specialist'?refs.profession:null])).rows[0];rows.push({id,kind,form});
  }
  await suite.test('public service SQL requires real current approval and purchased live window for every kind',async()=>{
   for(const row of rows){assert.equal(await store.read(row.kind,row.id),undefined);assert.deepEqual(await store.list(row.kind),[]);
    await admin.query("update app.service_publications set status='published',is_paid=true,published_at=clock_timestamp()-interval '1 hour',expires_at=clock_timestamp()+interval '1 day' where id=$1",[row.id]);
    assert.equal(await store.read(row.kind,row.id),undefined);await admin.query("insert into app.service_moderation(publication_id,revision,state,decided_at) values($1,1,'approved',clock_timestamp())",[row.id]);
    assert.equal((await store.read(row.kind,row.id)).id,row.id);assert.equal((await store.list(row.kind)).length,1);
    await admin.query("update app.service_publications set expires_at=clock_timestamp()-interval '1 second' where id=$1",[row.id]);assert.equal(await store.read(row.kind,row.id),undefined);
    await admin.query("update app.service_publications set published_at=clock_timestamp()+interval '1 hour',expires_at=clock_timestamp()+interval '1 day' where id=$1",[row.id]);assert.equal(await store.read(row.kind,row.id),undefined);
    await admin.query("update app.service_publications set published_at=clock_timestamp()-interval '1 hour' where id=$1",[row.id]);
   }
  });
  await suite.test('service public reads exclude blocked or unverified authors and stale or inactive reference/review state',async()=>{
   for(const row of rows){await admin.query('update app.service_publications set revision=2 where id=$1',[row.id]);assert.equal(await store.read(row.kind,row.id),undefined);await admin.query('update app.service_publications set revision=1 where id=$1',[row.id]);}
   await admin.query('update app.users set is_blocked=true where id=$1',[owner]);for(const row of rows)assert.equal(await store.read(row.kind,row.id),undefined);await admin.query('update app.users set is_blocked=false,email_verified_at=null where id=$1',[owner]);
   for(const row of rows)assert.equal(await store.read(row.kind,row.id),undefined);await admin.query('update app.users set email_verified_at=clock_timestamp() where id=$1',[owner]);
   await admin.query('update app.specialist_categories set active=false where id=$1',[refs.profession]);
   try{assert.equal(await store.read('specialist',rows[0].id),undefined);assert.equal((await store.read('fair',rows[1].id)).id,rows[1].id);}finally{await admin.query('update app.specialist_categories set active=true where id=$1',[refs.profession]);}
   await admin.query("update app.service_publications set status='archived' where id=$1",[rows[1].id]);assert.equal(await store.read('fair',rows[1].id),undefined);await admin.query("update app.service_publications set status='published' where id=$1",[rows[1].id]);
  });
  await suite.test('public service DTO never exposes contacts/comments and late SQL replies cannot extend the deadline',async()=>{
   for(const row of rows){const value=await store.read(row.kind,row.id);for(const secret of ['+79990000000','private@example.invalid','Приватный комментарий'])assert.equal(JSON.stringify(value).includes(secret),false);}
   const late=new PostgresPublicServiceStore({query:async(...args)=>{const result=await db.query(...args);for(const row of result.rows)row.expiresAt='2000-01-01T00:00:00.000001Z';return result;}});
   for(const row of rows){assert.equal(await late.read(row.kind,row.id),undefined);assert.deepEqual(await late.list(row.kind),[]);}
   await assert.rejects(store.list('fair',0));await assert.rejects(store.list('specialist',1001));assert.equal(await store.read('specialist','bad'),undefined);
  });
  await suite.test('public service photo metadata requires an exact current association and all ready owner files',async()=>{
   const row=rows[1],media=(await admin.query("insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256) values($1,gen_random_uuid(),'image/webp',2,2,12,$2) returning id",[owner,'b'.repeat(64)])).rows[0].id;
   await admin.query("update app.media_objects set state='ready',ready_at=clock_timestamp() where id=$1",[media]);assert.equal(await store.photoRecord(row.id,media),undefined);
   await admin.query('update app.service_publications set form=$2::jsonb,revision=2 where id=$1',[row.id,JSON.stringify({...row.form,photoIds:[media]})]);await admin.query('insert into app.service_publication_photos(publication_id,media_id,position) values($1,$2,0)',[row.id,media]);
   assert.equal(await store.photoRecord(row.id,media),undefined);await admin.query("insert into app.service_moderation(publication_id,revision,state,decided_at) values($1,2,'approved',clock_timestamp())",[row.id]);
   const access=await store.photoRecord(row.id,media);assert.equal(access.record.id,media);assert.equal(access.revision,'2');assert.equal(access.record.sha256,'b'.repeat(64));
   assert.equal(await store.photoRecord(rows[0].id,media),undefined);assert.equal(await store.photoRecord(row.id,randomUUID()),undefined);
   await admin.query('update app.users set is_blocked=true where id=$1',[owner]);assert.equal(await store.photoRecord(row.id,media),undefined);await admin.query('update app.users set is_blocked=false where id=$1',[owner]);
  });
  await suite.test('public marquee output is capped at five and cannot paginate into extra simultaneous advertisements',async()=>{
   for(let index=0;index<7;index++){
    const {id}=(await admin.query("insert into app.service_publications(author_id,kind,creation_key,form,status,is_paid,published_at,expires_at) values($1,'marquee',gen_random_uuid(),$2::jsonb,'published',true,clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day') returning id",[owner,JSON.stringify(parseServicePublicationForm('marquee',{title:`Синтетическая реклама ${index}`,placementRightConfirmed:true}))])).rows[0];
    await admin.query("insert into app.service_moderation(publication_id,revision,state,decided_at) values($1,1,'approved',clock_timestamp())",[id]);
   }
   const visible=await store.list('marquee',5,0);assert.equal(visible.length,5);assert.equal(new Set(visible.map(row=>row.id)).size,5);await assert.rejects(store.list('marquee',6,0));await assert.rejects(store.list('marquee',5,1));
  });
 }finally{await db.close();}
}
