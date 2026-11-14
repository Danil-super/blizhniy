// New disposable PG18 only: no existing stand or provider access.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import pg from 'pg';
import {PostgresDatabase} from '../src/lib/postgres.ts';
import {readMediaRetentionInventory} from '../scripts/media-retention-inventory.mjs';
const run=promisify(execFile),image='postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';
const name='blizhniy-media-inventory-'+randomBytes(8).toString('hex'),label='blizhniy.media-inventory-fixture',password=randomBytes(32).toString('hex');
const docker=async args=>(await run('/usr/bin/docker',['--host','unix:///var/run/docker.sock',...args],{timeout:20000,maxBuffer:1048576,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',POSTGRES_PASSWORD:password}})).stdout.trim();
test('media retention SQL inventory preserves references and accounting on real PostgreSQL',{timeout:120000},async suite=>{
 let container,admin,db;
 try{
  container=await docker(['run','--detach','--pull','never','--name',name,'--label',label+'='+name,'--memory','512m','--cpus','1','--tmpfs','/var/lib/postgresql:rw,size=268435456','--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD','--env','POSTGRES_DB=blizhniy_test',image]);
  const metadata=JSON.parse(await docker(['inspect',container]))[0];assert.equal(metadata.Id,container);assert.equal(metadata.Config.Labels[label],name);assert.equal(metadata.Config.Image,image);
  const binding=metadata.NetworkSettings.Ports['5432/tcp'][0];assert.equal(binding.HostIp,'127.0.0.1');
  const config={host:'127.0.0.1',port:Number(binding.HostPort),database:'blizhniy_test',user:'postgres',password,ssl:false,connectionTimeoutMillis:3000};
  const deadline=Date.now()+20000;for(;;){try{await docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres','-d','blizhniy_test']);break;}catch{assert.ok(Date.now()<deadline);}await new Promise(resolve=>setTimeout(resolve,100));}
  admin=new pg.Pool({...config,max:2});db=new PostgresDatabase(new pg.Pool({...config,max:1}));
  const migrations=(await readdir(new URL('../database/migrations/',import.meta.url))).filter(name=>/^\d{4}-[a-z-]+\.sql$/.test(name)&&name<'0058').sort();assert.equal(migrations.length,57);
  for(const file of migrations)await admin.query(await readFile(new URL('../database/migrations/'+file,import.meta.url),'utf8'));
  const owner=(await admin.query('insert into app.users(email,password_hash,email_verified_at) values($1,$2,clock_timestamp()) returning id',['inventory@example.invalid','scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128)])).rows[0].id;
  const ids=[];for(let i=0;i<6;i++)ids.push((await admin.query("insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256) values($1,$2,'image/webp',16,9,128,$3) returning id",[owner,randomUUID(),'a'.repeat(64)])).rows[0].id);
  for(const id of [ids[0],ids[4]])await admin.query('insert into app.media_write_attempts(media_id) values($1)',[id]);
  await admin.query("update app.media_objects set state='ready',ready_at=clock_timestamp() where id=any($1::uuid[])",[ids.slice(0,4)]);
  const listing=(await admin.query("insert into app.listings(author_id,listing_type,title) values($1,'sell','Синтетическая карточка') returning id",[owner])).rows[0].id;
  const work=(await admin.query("insert into app.work_publications(author_id,kind,creation_key,form) values($1,'workRequest',$2,$3) returning id",[owner,randomUUID(),{kind:'workRequest',title:'Синтетический заказ',photoIds:[ids[1]]}])).rows[0].id;
  const service=(await admin.query("insert into app.service_publications(author_id,kind,creation_key,form) values($1,'fair',$2,$3) returning id",[owner,randomUUID(),{kind:'fair',title:'Синтетическая ярмарка'}])).rows[0].id;
  await admin.query('insert into app.listing_photos(listing_id,media_id,position) values($1,$2,0)',[listing,ids[0]]);
  await admin.query('insert into app.work_publication_photos(publication_id,media_id,position) values($1,$2,0)',[work,ids[1]]);
  await admin.query('insert into app.service_publication_photos(publication_id,media_id,position) values($1,$2,0)',[service,ids[2]]);
  const unicode=ids[3].replaceAll('-','\\u002d');
  await admin.query(`insert into app.applications(applicant_id,work_publication_id,creation_key,target_revision,specialist_revision,snapshot)
   values($1,$2,$3,1,1,$4::jsonb)`,[owner,work,randomUUID(),' {"private":"contact@example.invalid","nested":[{"photo":"'+unicode+'"},{"url":"/photo/'+ids[3].toUpperCase()+'.webp"}]}']);
  const inspect=()=>db.readTransaction(readMediaRetentionInventory,{timeoutMs:5000});
  await suite.test('three photo tables, nested escaped/uppercase/repeated references and pending attempts are distinguished',async()=>{
   const report=await inspect();assert.equal(report.summary.objects,6);assert.equal(report.summary.linked,4);assert.equal(report.summary.unlinked,2);assert.equal(report.summary.bytes,768);
   assert.equal(report.summary.pendingWithAttempt,1);assert.equal(report.summary.pendingWithoutAttempt,1);assert.equal(report.cleanupAuthorized,false);
   assert.deepEqual(report.media.find(row=>row.id===ids[0]).references,['listing_photos']);assert.deepEqual(report.media.find(row=>row.id===ids[1]).references,['work_form','work_photos']);assert.deepEqual(report.media.find(row=>row.id===ids[2]).references,['service_photos']);assert.deepEqual(report.media.find(row=>row.id===ids[3]).references,['application_snapshot']);assert.deepEqual(report.media.find(row=>row.id===ids[5]).references,[]);
   assert.equal(JSON.stringify(report).includes('contact@example.invalid'),false);assert.ok(report.media.every(row=>row.action==='retain'&&row.unlinkedSince===null));
  });
  await suite.test('inspection neither changes accounting nor grants write access',async()=>{
   const before=(await admin.query('select * from app.media_storage_budget')).rows;await inspect();assert.deepEqual((await admin.query('select * from app.media_storage_budget')).rows,before);
   await assert.rejects(db.readTransaction(tx=>tx.query('delete from app.media_objects'),{timeoutMs:5000}),error=>error.code==='25006');
  });
  await suite.test('a later unlink cannot make the existing snapshot lose its reference',async()=>{
   const report=await db.readTransaction(async tx=>{await tx.query('select count(*) from app.media_objects');await admin.query('delete from app.listing_photos where listing_id=$1',[listing]);return readMediaRetentionInventory(tx);},{timeoutMs:5000});
   assert.deepEqual(report.media.find(row=>row.id===ids[0]).references,['listing_photos']);const fresh=await inspect();assert.deepEqual(fresh.media.find(row=>row.id===ids[0]).references,[]);assert.equal(fresh.media.find(row=>row.id===ids[0]).unlinkedSince,null);
  });
  await suite.test('unknown external FK and mismatched budget refuse a complete report',async()=>{
   await admin.query('create table public.foreign_media(media_id uuid references app.media_objects(id))');try{await assert.rejects(inspect(),/MEDIA_INVENTORY_UNAVAILABLE/);}finally{await admin.query('drop table public.foreign_media');}
   await admin.query('update app.media_storage_budget set charged_bytes=charged_bytes+1');try{await assert.rejects(inspect(),/MEDIA_INVENTORY_UNAVAILABLE/);}finally{await admin.query('update app.media_storage_budget set charged_bytes=charged_bytes-1');}
   assert.equal((await inspect()).summary.accountingMatches,true);
  });
 }finally{
  if(db)await db.close();if(admin)await admin.end();
  if(container){const metadata=JSON.parse(await docker(['inspect',container]))[0];assert.equal(metadata.Id,container);assert.equal(metadata.Config.Labels[label],name);assert.equal(metadata.Config.Image,image);await docker(['rm','--force',container]);}
 }
});
