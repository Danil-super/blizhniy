// Opt-in fresh owned PG18 only; never reads the persistent stand or its credentials.
import assert from 'node:assert/strict';import {test} from 'node:test';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {randomBytes,randomUUID,createHash} from 'node:crypto';import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {createRequire} from 'node:module';
import pg from 'pg';
import {getRefundWorkerRolePlan,verifyRefundWorkerDatabase} from '../scripts/refund-worker-role.mjs';
import {getRefundOperatorRolePlan,verifyRefundOperatorDatabase} from '../scripts/refund-operator-role.mjs';
import {readRefundSchema,assertRefundSchema} from '../scripts/refund-worker-schema.mjs';
import {restoreLocalPrimary57Checks} from '../scripts/restore-local-primary57-checks.mjs';
const {PostgresDatabase}=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule('postgres');
const run=promisify(execFile),image='postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';
const name='blizhniy-logical-restore-'+randomBytes(8).toString('hex'),label='blizhniy.logical-restore-fixture',password=randomBytes(32).toString('hex');
const docker=async args=>(await run('/usr/bin/docker',['--host','unix:///var/run/docker.sock',...args],{timeout:20000,maxBuffer:2*1024*1024,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',POSTGRES_PASSWORD:password}})).stdout.trim();
async function catalog(db,expected){await db.query('begin read only');try{if(expected)await assertRefundSchema(db,57,{localPrimary:true});return await readRefundSchema(db);}finally{await db.query('rollback');}}
async function data(db){
 const result=[];for(const {schema,name} of (await db.query("select n.nspname schema,c.relname name from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in('app','blizhniy_meta','local_primary') order by 1,2")).rows){
  const rows=(await db.query('select row_to_json(t)::text value from '+pg.escapeIdentifier(schema)+'.'+pg.escapeIdentifier(name)+' t order by row_to_json(t)::text collate "C" limit 20001')).rows;assert.ok(rows.length<=20000);
  result.push({schema,name,count:rows.length,sha256:createHash('sha256').update(rows.map(row=>row.value+'\n').join('')).digest('hex')});
 }return result;
}
test('logical local57 restore reconstructs six original checks without widening schema admission or financial rights',{timeout:90000},async suite=>{
 let id,db,restorer;const oldMode=process.env.NODE_ENV;process.env.NODE_ENV='test';
 const directory=await mkdtemp(join(tmpdir(),'blizhniy-logical-restore-')),plans=[getRefundWorkerRolePlan('blizhniy_prod',{schema:57}),getRefundOperatorRolePlan('blizhniy_prod',{schema:57})];
 try{
  id=await docker(['run','--detach','--pull','never','--name',name,'--label',label+'='+name,'--memory','512m','--cpus','1','--tmpfs','/var/lib/postgresql:rw,size=536870912','--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD','--env','POSTGRES_DB=blizhniy_prod',image]);
  const metadata=JSON.parse(await docker(['inspect',id]))[0];assert.equal(metadata.Id,id);assert.equal(metadata.Config.Image,image);assert.equal(metadata.Config.Labels[label],name);const binding=metadata.NetworkSettings.Ports['5432/tcp'][0];assert.equal(binding.HostIp,'127.0.0.1');
  const deadline=Date.now()+20000;for(;;){try{await docker(['exec',id,'pg_isready','-h','127.0.0.1','-U','postgres']);break;}catch{assert.ok(Date.now()<deadline);await new Promise(r=>setTimeout(r,100));}}
  const config={host:'127.0.0.1',port:Number(binding.HostPort),database:'blizhniy_prod',user:'postgres',password,ssl:false,connectionTimeoutMillis:3000};
  db=new pg.Client(config);await db.connect();await db.query("set timezone='UTC'");
  for(const {name} of plans[0].journal)await db.query(await readFile(new URL('../database/migrations/'+name,import.meta.url),'utf8'));
  await db.query('create role blizhniy_runtime login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls');
  await db.query(await readFile(new URL('../database/local-primary-payment.sql',import.meta.url),'utf8'));await db.query(await readFile(new URL('../database/permissions/telegram-phone.sql',import.meta.url),'utf8'));
  await db.query('create schema blizhniy_meta;create table blizhniy_meta.migrations(name text primary key,sha256 text not null);revoke all on schema blizhniy_meta from public;revoke all on blizhniy_meta.migrations from public;revoke all on database blizhniy_prod from public;revoke create on schema public from public');
  for(const {name,sha256} of plans[0].journal)await db.query('insert into blizhniy_meta.migrations values($1,$2)',[name,sha256]);
  for(const plan of plans){await db.query(plan.createRole);await db.query('alter role '+plan.role+' login password '+pg.escapeLiteral(password));for(const sql of plan.grants)await db.query(sql);}
  const owner=(await db.query("insert into app.users(email,password_hash,email_verified_at) values('restore@example.invalid',$1,clock_timestamp()) returning id",['scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128)])).rows[0].id;
  await db.query("insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256) values($1,$2,'image/webp',1,1,12,$3)",[owner,randomUUID(),'a'.repeat(64)]);
  const originalSchema=await catalog(db,true),originalData=await data(db);
  const dump=(await run('/usr/bin/docker',['--host','unix:///var/run/docker.sock','exec',id,'pg_dump','--username=postgres','--no-password','--format=custom','--dbname=blizhniy_prod'],{encoding:'buffer',timeout:20000,maxBuffer:8*1024*1024})).stdout;
  assert.equal(dump.subarray(0,5).toString(),'PGDMP');const file=join(directory,'database.dump');await writeFile(file,dump,{mode:0o600,flag:'wx'});await db.end();db=undefined;
  const admin=new pg.Client({...config,database:'postgres'});await admin.connect();try{await admin.query('alter database blizhniy_prod rename to blizhniy_original');}finally{await admin.end();}
  await docker(['cp',file,id+':/tmp/owned-restore.dump']);await docker(['exec',id,'pg_restore','--username=postgres','--no-password','--create','--exit-on-error','--dbname=postgres','/tmp/owned-restore.dump']);
  db=new pg.Client(config);await db.connect();await db.query("set timezone='UTC'");
  const restoredSchema=await catalog(db,false),repair=await readFile(new URL('../database/restore/local-primary57-checks.sql',import.meta.url),'utf8');
  restorer=new PostgresDatabase(new pg.Pool({...config,max:1}));
  await suite.test('unmodified archive preserves all rows but changed CHECK grouping refuses admission',async()=>{
   assert.deepEqual(await data(db),originalData);assert.deepEqual({...restoredSchema,constraint:originalSchema.constraint},originalSchema);assert.notDeepEqual(restoredSchema.constraint,originalSchema.constraint);await assert.rejects(catalog(db,true),/Invalid refund schema/);
  });
  await suite.test('repair refuses missing marker, wrong marker and unknown journal before changing constraints',async()=>{
   for(const marker of ['', 'foreign']){await db.query("select set_config('blizhniy.restore_drill',$1,false)",[marker]);await assert.rejects(db.query(repair),{code:'BR057'});await db.query('rollback');assert.deepEqual(await catalog(db,false),restoredSchema);}
   await db.query("select set_config('blizhniy.restore_drill','owned-local57',false)");await db.query("insert into blizhniy_meta.migrations values('0058-unknown.sql',repeat('a',64))");try{await assert.rejects(db.query(repair),{code:'BR057'});await db.query('rollback');}finally{await db.query("delete from blizhniy_meta.migrations where name='0058-unknown.sql'");}
  });
  await suite.test('changed earlier hash/name at the same count and maximum refuses both helper and SQL payload',async()=>{
   const first=plans[0].journal[0];
   for(const change of ["update blizhniy_meta.migrations set sha256=repeat('0',64) where name='0001-identity.sql'","update blizhniy_meta.migrations set name='0001-unknown.sql' where name='0001-identity.sql'"]){
    await db.query(change);try{await assert.rejects(restoreLocalPrimary57Checks(restorer));await assert.rejects(db.query(repair),{code:'BR057'});assert.deepEqual(await catalog(db,false),restoredSchema);}
    finally{await db.query("delete from blizhniy_meta.migrations where name in('0001-identity.sql','0001-unknown.sql')");await db.query('insert into blizhniy_meta.migrations values($1,$2)',[first.name,first.sha256]);}
   }
  });
  await suite.test('altered unrelated schema refuses the helper before any CHECK reconstruction',async()=>{
   await db.query('alter table app.users add column restore_probe text');try{await assert.rejects(restoreLocalPrimary57Checks(restorer));const now=await catalog(db,false);assert.deepEqual(now.constraint,restoredSchema.constraint);}
   finally{await db.query('alter table app.users drop column restore_probe');}
  });
  await suite.test('original BETWEEN definitions restore the exact pinned schema and preserve every row',async()=>{
   await restoreLocalPrimary57Checks(restorer);assert.deepEqual(await catalog(db,true),originalSchema);assert.deepEqual(await data(db),originalData);
   for(const [index,verify] of [[0,verifyRefundWorkerDatabase],[1,verifyRefundOperatorDatabase]]){const actual=new PostgresDatabase(new pg.Pool({...config,user:plans[index].role,max:1}));try{await verify(actual,{database:'blizhniy_prod',merchant:{shopId:'restore-fixture',isTest:true},localPrimary:true});}finally{await actual.close();}}
  });
  await suite.test('changing the restored email threshold is still detected by the unchanged guard',async()=>{
   await db.query('begin');try{await db.query('alter table app.users drop constraint users_email_check,add constraint users_email_check check(char_length(email)>=1)');await assert.rejects(assertRefundSchema(db,57,{localPrimary:true}),/Invalid refund schema/);}finally{await db.query('rollback');}await catalog(db,true);
  });
 }finally{
  await restorer?.close();await db?.end();if(id){const proof=JSON.parse(await docker(['inspect',id]))[0];assert.equal(proof.Id,id);assert.equal(proof.Config.Labels[label],name);assert.equal(proof.Config.Image,image);await docker(['rm','--force',id]);}await rm(directory,{recursive:true,force:true});
  if(oldMode===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=oldMode;
 }
});
