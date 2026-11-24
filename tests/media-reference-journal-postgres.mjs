// Candidate only: fresh owned PG18, never the manual stand or installed workers.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import pg from 'pg';
import {insertMediaPayment,testMediaRetirementCandidate} from './media-retirement-candidate-cases.mjs';
import {testMediaRetentionActivation} from './media-retention-activation-cases.mjs';
const run=promisify(execFile),image='postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';
const name='blizhniy-media-journal-'+randomBytes(8).toString('hex'),label='blizhniy.media-journal-fixture',password=randomBytes(32).toString('hex');
const docker=async args=>(await run('/usr/bin/docker',['--host','unix:///var/run/docker.sock',...args],{timeout:20000,maxBuffer:1048576,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',POSTGRES_PASSWORD:password}})).stdout.trim();
test('candidate media reference journal tracks actual transitions without cleanup authority',{timeout:120000},async suite=>{
 const migration=await readFile(new URL('../database/candidates/0058-media-reference-journal.sql',import.meta.url),'utf8');
 let container,admin,holder,waiter;
 try{
  container=await docker(['run','--detach','--pull','never','--name',name,'--label',label+'='+name,'--memory','512m','--cpus','1','--tmpfs','/var/lib/postgresql:rw,size=268435456','--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD','--env','POSTGRES_DB=blizhniy_test',image]);
  const metadata=JSON.parse(await docker(['inspect',container]))[0];assert.equal(metadata.Id,container);assert.equal(metadata.Config.Labels[label],name);assert.equal(metadata.Config.Image,image);
  const binding=metadata.NetworkSettings.Ports['5432/tcp'][0];assert.equal(binding.HostIp,'127.0.0.1');
  const config={host:'127.0.0.1',port:Number(binding.HostPort),database:'blizhniy_test',user:'postgres',password,ssl:false,connectionTimeoutMillis:3000};
  const deadline=Date.now()+20000;for(;;){try{await docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres','-d','blizhniy_test']);break;}catch{assert.ok(Date.now()<deadline);}await new Promise(resolve=>setTimeout(resolve,100));}
  admin=new pg.Pool({...config,max:2});holder=new pg.Client(config);waiter=new pg.Client(config);await holder.connect();await waiter.connect();
  const migrations=(await readdir(new URL('../database/migrations/',import.meta.url))).filter(name=>/^\d{4}-[a-z-]+\.sql$/.test(name)&&name<'0058').sort();assert.equal(migrations.length,57);
  for(const file of migrations)await admin.query(await readFile(new URL('../database/migrations/'+file,import.meta.url),'utf8'));
  const owner=(await admin.query('insert into app.users(email,password_hash,email_verified_at) values($1,$2,clock_timestamp()) returning id',['journal@example.invalid','scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128)])).rows[0].id;
  async function media(){return(await admin.query("insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256,created_at) values($1,$2,'image/webp',16,9,128,$3,clock_timestamp()-interval '30 days') returning id",[owner,randomUUID(),'a'.repeat(64)])).rows[0].id;}
  const ids=[await media(),await media(),await media(),await media()];await admin.query("update app.media_objects set state='ready',ready_at=clock_timestamp() where id=any($1::uuid[])",[ids]);
  const listing=(await admin.query("insert into app.listings(author_id,listing_type,title) values($1,'sell','Синтетическая карточка') returning id",[owner])).rows[0].id;
  const work=(await admin.query("insert into app.work_publications(author_id,kind,creation_key,form) values($1,'workRequest',$2,$3) returning id",[owner,randomUUID(),{kind:'workRequest',title:'Синтетический заказ',photoIds:[ids[1]]}])).rows[0].id;
  const service=(await admin.query("insert into app.service_publications(author_id,kind,creation_key,form) values($1,'fair',$2,$3) returning id",[owner,randomUUID(),{kind:'fair',title:'Синтетическая ярмарка'}])).rows[0].id;
  await admin.query('insert into app.listing_photos(listing_id,media_id,position) values($1,$2,0)',[listing,ids[0]]);
  const legacyIntent=await insertMediaPayment(admin,owner,'listing',randomUUID());
  const before=(await admin.query('select clock_timestamp() stamp')).rows[0].stamp;await admin.query(migration);
  const events=async(id,source)=>(await admin.query('select event_type,recorded_at,resource_id from app.media_reference_events where media_id=$1 and ($2::text is null or source=$2) order by event_id',[id,source??null])).rows;
  const baseline=(await admin.query('select * from app.media_storage_budget')).rows;
  await suite.test('activation timestamps never backdate old unlinked photos',async()=>{
   for(const id of ids){const observed=(await events(id,'media_objects')).find(row=>row.event_type==='observed');assert.ok(observed.recorded_at>=before);}
   assert.ok((await events(ids[0],'listing_photos')).some(row=>row.event_type==='observed_attached'));
   assert.ok((await events(ids[1],'work_publications')).some(row=>row.event_type==='observed_attached'));
  });
  await suite.test('detach, reattach, position-only updates and rollback retain exact event semantics',async()=>{
   await admin.query('delete from app.listing_photos where listing_id=$1',[listing]);await admin.query('insert into app.listing_photos(listing_id,media_id,position) values($1,$2,0)',[listing,ids[0]]);
   const expected=['observed_attached','detached','attached'];assert.deepEqual((await events(ids[0],'listing_photos')).map(row=>row.event_type),expected);
   await admin.query('update app.listing_photos set position=1 where listing_id=$1',[listing]);assert.deepEqual((await events(ids[0],'listing_photos')).map(row=>row.event_type),expected);
   await holder.query('begin');try{await holder.query('delete from app.listing_photos where listing_id=$1',[listing]);}finally{await holder.query('rollback');}assert.deepEqual((await events(ids[0],'listing_photos')).map(row=>row.event_type),expected);
  });
  await suite.test('all photo sources and JSON source changes are recorded without copying payloads',async()=>{
   await admin.query('insert into app.work_publication_photos(publication_id,media_id,position) values($1,$2,0)',[work,ids[1]]);await admin.query('delete from app.work_publication_photos where publication_id=$1',[work]);
   await admin.query('insert into app.service_publication_photos(publication_id,media_id,position) values($1,$2,0)',[service,ids[2]]);await admin.query('delete from app.service_publication_photos where publication_id=$1',[service]);
   assert.deepEqual((await events(ids[1],'work_publication_photos')).map(row=>row.event_type),['attached','detached']);assert.deepEqual((await events(ids[2],'service_publication_photos')).map(row=>row.event_type),['attached','detached']);
   await admin.query("update app.work_publications set form=jsonb_set(form,'{photoIds}','[]') where id=$1",[work]);assert.equal((await events(ids[1],'work_publications')).at(-1).event_type,'detached');
   const application=(await admin.query(`insert into app.applications(applicant_id,work_publication_id,creation_key,target_revision,specialist_revision,snapshot)
    values($1,$2,$3,1,1,$4::jsonb) returning id`,[owner,work,randomUUID(),'{"nested":{"photo":"'+ids[3].replaceAll('-','\\u002d')+'","url":"/photo/'+ids[3].toUpperCase()+'.webp"},"contact":"private@example.invalid"}'])).rows[0].id;
   await admin.query("update app.applications set snapshot='{}' where id=$1",[application]);assert.deepEqual((await events(ids[3],'applications')).map(row=>row.event_type),['history']);
   assert.equal(JSON.stringify((await admin.query('select * from app.media_reference_events')).rows).includes('private@example.invalid'),false);
  });
  await suite.test('conflict no-op inserts cannot invent committed references',async()=>{
   const count=Number((await admin.query('select count(*) n from app.media_reference_events')).rows[0].n);
   await admin.query(`insert into app.work_publications(author_id,kind,creation_key,form)
    select author_id,kind,creation_key,$2::jsonb from app.work_publications where id=$1
    on conflict(author_id,kind,creation_key) do nothing`,[work,{kind:'workRequest',title:'Конфликтующий заказ',photoIds:[ids[3]]}]);
   await admin.query('insert into app.listing_photos(listing_id,media_id,position) values($1,$2,5) on conflict do nothing',[listing,ids[0]]);
   assert.equal(Number((await admin.query('select count(*) n from app.media_reference_events')).rows[0].n),count);
  });
  await suite.test('new media reserve and ready transitions are journaled in the same transaction',async()=>{
   await holder.query('begin');try{
    const id=(await holder.query("insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256) values($1,$2,'image/webp',16,9,128,$3) returning id",[owner,randomUUID(),'b'.repeat(64)])).rows[0].id;
    await holder.query("update app.media_objects set state='ready',ready_at=clock_timestamp() where id=$1",[id]);
    assert.deepEqual((await holder.query('select event_type from app.media_reference_events where media_id=$1 order by event_id',[id])).rows.map(row=>row.event_type),['reserved','ready']);
   }finally{await holder.query('rollback');}
   assert.deepEqual((await admin.query('select * from app.media_storage_budget')).rows,baseline);
  });
  await suite.test('different photo parents can attach one media without FK lock upgrade deadlock',async()=>{
   const another=(await admin.query("insert into app.listings(author_id,listing_type,title) values($1,'sell','Вторая карточка') returning id",[owner])).rows[0].id;
   await holder.query('begin');await waiter.query('begin');
   try{
    await holder.query('set local lock_timeout=\'2s\'');await waiter.query('set local lock_timeout=\'2s\'');
    await holder.query('select id from app.media_objects where id=$1 for key share',[ids[3]]);await waiter.query('select id from app.media_objects where id=$1 for key share',[ids[3]]);
    await holder.query('insert into app.listing_photos(listing_id,media_id,position) values($1,$2,2)',[listing,ids[3]]);
    const pending=waiter.query('insert into app.listing_photos(listing_id,media_id,position) values($1,$2,0)',[another,ids[3]]);pending.catch(()=>{});
    await holder.query('commit');await pending;await waiter.query('commit');
    assert.equal((await events(ids[3],'listing_photos')).filter(row=>row.event_type==='attached').length,2);
   }finally{await holder.query('rollback');await waiter.query('rollback');}
  });
  await suite.test('reference timestamp is taken after the shared media lock, not at transaction start',async()=>{
   await holder.query('begin');await holder.query('select id from app.media_objects where id=$1 for no key update',[ids[2]]);await waiter.query('begin');const started=(await waiter.query('select transaction_timestamp() stamp,pg_backend_pid() pid')).rows[0];
   const pending=waiter.query('insert into app.service_publication_photos(publication_id,media_id,position) values($1,$2,0)',[service,ids[2]]);pending.catch(()=>{});
   try{const deadline=Date.now()+5000;for(;;){if((await admin.query("select wait_event_type='Lock' waiting from pg_stat_activity where pid=$1",[started.pid])).rows[0]?.waiting)break;assert.ok(Date.now()<deadline);await new Promise(resolve=>setTimeout(resolve,20));}
    const released=(await admin.query('select clock_timestamp() stamp')).rows[0].stamp;await holder.query('commit');await pending;await waiter.query('commit');const last=(await events(ids[2],'service_publication_photos')).at(-1);assert.ok(last.recorded_at>=released);assert.ok(last.recorded_at>=started.stamp);
   }finally{await holder.query('rollback');await waiter.query('rollback');}
  });
  await suite.test('stale isolation and journal mutation are refused; quotas and metadata remain unchanged',async()=>{
   await holder.query('begin isolation level repeatable read');try{await assert.rejects(holder.query('delete from app.service_publication_photos where publication_id=$1',[service]),error=>error.code==='MRJ01');}finally{await holder.query('rollback');}
   for(const sql of ['update app.media_reference_events set recorded_at=recorded_at-interval \'1 day\'','delete from app.media_reference_events','truncate app.media_reference_events'])await assert.rejects(admin.query(sql),error=>error.code==='23514');
   assert.deepEqual((await admin.query('select * from app.media_storage_budget')).rows,baseline);assert.equal((await admin.query('select count(*)::int n from app.media_objects')).rows[0].n,4);
   await admin.query('create role media_journal_runtime nologin;grant usage on schema app to media_journal_runtime;grant update(form),select(id) on app.work_publications to media_journal_runtime');
   await holder.query('set role media_journal_runtime');try{
    await holder.query('update app.work_publications set form=$2::jsonb where id=$1',[work,{kind:'workRequest',title:'Разрешённое изменение',photoIds:[ids[1]]}]);
    for(const sql of ['select * from app.media_reference_events',"insert into app.media_reference_events(media_id,source,resource_id,event_type) values(gen_random_uuid(),'media_objects',gen_random_uuid(),'observed')",'truncate app.media_reference_events',"select app.media_reference_ids('{}'::jsonb)"])await assert.rejects(holder.query(sql),error=>error.code==='42501');
   }finally{await holder.query('reset role');}
   assert.equal((await events(ids[1],'work_publications')).at(-1).event_type,'attached');
  });
  async function backupMediaDatabase(){
   const target='blizhniy_media_restore_'+randomBytes(8).toString('hex'),archive='/tmp/'+target+'.dump';
   await docker(['exec',container,'pg_dump','--username=postgres','--format=custom','--file='+archive,config.database]);
   return async work=>{
    await docker(['exec',container,'createdb','--username=postgres','--template=template0',target]);
    const restored=new pg.Pool({...config,database:target,max:2});
    try{
     await docker(['exec',container,'pg_restore','--username=postgres','--dbname='+target,'--single-transaction','--exit-on-error',archive]);
     await work(restored);
    }finally{await restored.end();}
   };
  }
  await testMediaRetirementCandidate(suite,{admin,holder,waiter,owner,ids,legacyIntent,backupMediaDatabase});
  await testMediaRetentionActivation(suite,{admin,config});
 }finally{
  if(holder)await holder.end();if(waiter)await waiter.end();if(admin)await admin.end();
  if(container){const metadata=JSON.parse(await docker(['inspect',container]))[0];assert.equal(metadata.Id,container);assert.equal(metadata.Config.Labels[label],name);assert.equal(metadata.Config.Image,image);await docker(['rm','--force',container]);}
 }
});
