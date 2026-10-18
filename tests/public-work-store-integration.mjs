import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {createPostgresDatabase} from '../src/lib/postgres.ts';import {workPublicationModule} from './work-publication-module.mjs';
import {parseWorkPublicationForm} from '../src/lib/work-publication-contract.ts';import * as projection from '../src/lib/public-work-publications.ts';

export async function testPublicWorkStore(suite,admin,config,credentials){
 assert.equal(config.host,'127.0.0.1');const {PostgresPublicWorkStore}=workPublicationModule('postgres-public-work',{'./public-work-publications.ts':projection});
 const db=createPostgresDatabase({NODE_ENV:'test',BLIZHNIY_DB_HOST:config.host,BLIZHNIY_DB_PORT:String(config.port),BLIZHNIY_DB_NAME:config.database,
  BLIZHNIY_DB_USER:credentials.user,BLIZHNIY_DB_PASSWORD:credentials.password,BLIZHNIY_DB_SSL_MODE:'disable'}),store=new PostgresPublicWorkStore(db);
 const owner=randomUUID(),hash=`scrypt$131072$8$1$${'c'.repeat(32)}$${'d'.repeat(128)}`,ids=[];
 try{
  await admin.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',[owner,`public-work-${owner}@example.invalid`,hash]);
  const refs=(await admin.query("select (select id from app.cities where name='Краснодар') as city,(select id from app.specialist_categories where name='Сантехник') as profession")).rows[0];
  for(const kind of ['vacancy','workRequest']){
   const form=parseWorkPublicationForm(kind,{title:'Публичная работа',description:'Синтетическое описание',cityName:'Краснодар',professionName:'Сантехник',contactPhone:'+79990000000',placementRightConfirmed:true,
    ...(kind==='vacancy'?{employerType:'person',organization:'Работодатель',salary:'1250.50'}:{budget:'1250.50'})});
   const row=(await admin.query('insert into app.work_publications(author_id,kind,creation_key,form,city_id,profession_id) values($1,$2,gen_random_uuid(),$3::jsonb,$4,$5) returning id',[owner,kind,JSON.stringify(form),refs.city,refs.profession])).rows[0];ids.push({id:row.id,kind,form});
  }
  await suite.test('real public work reads exclude drafts, missing moderation, unpaid and expired records, even if a status was forged',async()=>{
   for(const item of ids){assert.equal(await store.read(item.kind,item.id),undefined);assert.deepEqual(await store.list(item.kind,25,0),[]);
    await admin.query("update app.work_publications set status='published',is_paid=true,published_at=clock_timestamp()-interval '1 hour',expires_at=clock_timestamp()+interval '1 day' where id=$1",[item.id]);
    assert.equal(await store.read(item.kind,item.id),undefined);
    await admin.query("insert into app.work_moderation(publication_id,revision,state,decided_at) values($1,1,'approved',clock_timestamp())",[item.id]);
    const visible=await store.read(item.kind,item.id);assert.equal(visible.title,item.form.title);assert.equal(Object.hasOwn(visible,'phone'),false);
    await admin.query("update app.work_publications set expires_at=clock_timestamp()-interval '1 second' where id=$1",[item.id]);assert.equal(await store.read(item.kind,item.id),undefined);
    await admin.query("update app.work_publications set expires_at=clock_timestamp()+interval '1 day' where id=$1",[item.id]);
   }
  });
  await suite.test('public work list/detail filter current approval, blocked authors and inactive professions independently of private owner reads',async()=>{
   for(const item of ids){assert.equal((await store.list(item.kind,25,0)).length,1);
    await admin.query('update app.work_publications set revision=revision+1 where id=$1',[item.id]);assert.equal(await store.read(item.kind,item.id),undefined);
    await admin.query('update app.work_publications set revision=revision-1 where id=$1',[item.id]);}
   await admin.query('update app.users set is_blocked=true where id=$1',[owner]);for(const item of ids)assert.equal(await store.read(item.kind,item.id),undefined);
   await admin.query('update app.users set is_blocked=false where id=$1',[owner]);
   await admin.query('update app.specialist_categories set active=false where id=$1',[refs.profession]);
   try{for(const item of ids)assert.equal(await store.read(item.kind,item.id),undefined);}finally{await admin.query('update app.specialist_categories set active=true where id=$1',[refs.profession]);}
  });
  await suite.test('a deadline crossing while SQL resolves cannot return a work card after expiry',async()=>{
   const late=new PostgresPublicWorkStore({query:async(...args)=>{const result=await db.query(...args);for(const row of result.rows)row.expiresAt='2000-01-01T00:00:00.000001Z';return result;}});
   assert.equal(await late.read(ids[0].kind,ids[0].id),undefined);
  });
  await suite.test('public photo metadata requires the exact live approved publication, ordered association and ready owner file',async()=>{
   const item=ids[0],media=(await admin.query("insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256) values($1,gen_random_uuid(),'image/webp',2,2,12,$2) returning id",[owner,'b'.repeat(64)])).rows[0].id;
   await admin.query("update app.media_objects set state='ready',ready_at=clock_timestamp() where id=$1",[media]);
   assert.equal(await store.photoRecord(item.id,media),undefined,'an unlinked owner file is still private');
   await admin.query('update app.work_publications set form=$2::jsonb,revision=revision+1 where id=$1',[item.id,JSON.stringify({...item.form,photoIds:[media]})]);
   await admin.query('insert into app.work_publication_photos(publication_id,media_id,position) values($1,$2,0)',[item.id,media]);
   assert.equal(await store.photoRecord(item.id,media),undefined,'an old approval cannot authorize a changed photo set');
   await admin.query("insert into app.work_moderation(publication_id,revision,state,decided_at) values($1,2,'approved',clock_timestamp())",[item.id]);
   const access=await store.photoRecord(item.id,media);assert.equal(access.record.id,media);assert.equal(access.record.sha256,'b'.repeat(64));assert.equal(access.revision,'2');
   assert.equal(await store.photoRecord(item.id,randomUUID()),undefined);assert.equal(await store.photoRecord(ids[1].id,media),undefined);
   await admin.query('update app.users set is_blocked=true where id=$1',[owner]);assert.equal(await store.photoRecord(item.id,media),undefined);
   await admin.query('update app.users set is_blocked=false where id=$1',[owner]);await admin.query("update app.work_publications set status='archived' where id=$1",[item.id]);
   assert.equal(await store.photoRecord(item.id,media),undefined);
  });
 }finally{
  // Parent destroys the owned disposable database. Do not bypass media cleanup
  // proofs or owner RESTRICT to delete a fixture with immutable ready metadata.
  await db.close();
 }
}
