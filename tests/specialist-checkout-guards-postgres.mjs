// Fresh disposable PostgreSQL only; never opens an existing stand or merchant.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes} from 'node:crypto';
import {readFile,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import pg from 'pg';
import {PostgresDatabase} from '../src/lib/postgres.ts';
import {getRefundWorkerRolePlan,verifyRefundWorkerDatabase} from '../scripts/refund-worker-role.mjs';
import {getRefundOperatorRolePlan,verifyRefundOperatorDatabase} from '../scripts/refund-operator-role.mjs';
import {getMediaRetentionRolePlan,verifyMediaRetentionDatabase,mediaRetentionRuntimeGrants} from '../scripts/media-retention-role.mjs';
import {assertRefundSchema} from '../scripts/refund-worker-schema.mjs';
import {verifyLocalPrimarySchema} from '../scripts/local-primary-fixture.mjs';
import {getSpecialistCheckoutMigration} from '../scripts/specialist-checkout-release.mjs';
import {buildRefundWorker} from '../scripts/build-refund-worker.mjs';
import {buildRefundOperator} from '../scripts/build-refund-operator.mjs';
import {readMediaRetentionInventory} from '../scripts/media-retention-inventory.mjs';

const run=promisify(execFile),image='postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';
const name='blizhniy-specialist-guards-'+randomBytes(8).toString('hex'),label='blizhniy.specialist-guards-fixture',password=randomBytes(32).toString('hex');
const docker=async args=>(await run('/usr/bin/docker',['--host','unix:///var/run/docker.sock',...args],{timeout:20000,maxBuffer:1048576,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',POSTGRES_PASSWORD:password}})).stdout.trim();
test('local60 exact catalog, installed-mode recovery and unchanged financial/media authority',{timeout:120000},async suite=>{
 let id,owner;const dbs=[],checks=[],owned=await mkdtemp(join(tmpdir(),'blizhniy-specialist-guards-'));
 const env={NODE_ENV:'test',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://127.0.0.1:3045',BLIZHNIY_LISTING_WORKFLOW:'postmoderation',BLIZHNIY_MEDIA_RETENTION:'local-v1',BLIZHNIY_SERVICE_CHECKOUT:'local-v1'};
 const saved={};for(const key of [...Object.keys(env),'BLIZHNIY_SPECIALIST_CHECKOUT'])saved[key]=process.env[key];Object.assign(process.env,env);delete process.env.BLIZHNIY_SPECIALIST_CHECKOUT;
 try{
  id=await docker(['run','--detach','--pull','never','--name',name,'--label',label+'='+name,'--memory','512m','--cpus','1','--tmpfs','/var/lib/postgresql:rw,size=268435456','--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD','--env','POSTGRES_DB=blizhniy_prod',image]);
  const metadata=JSON.parse(await docker(['inspect',id]))[0],binding=metadata.NetworkSettings.Ports['5432/tcp'][0];assert.equal(binding.HostIp,'127.0.0.1');
  const config={host:'127.0.0.1',port:Number(binding.HostPort),database:'blizhniy_prod',user:'postgres',password,ssl:false,connectionTimeoutMillis:3000};
  const until=Date.now()+20000;for(;;){try{await docker(['exec',id,'pg_isready','-h','127.0.0.1','-U','postgres']);break;}catch{assert.ok(Date.now()<until);}await new Promise(r=>setTimeout(r,100));}
  owner=new pg.Client(config);await owner.connect();
  const old=getRefundWorkerRolePlan('blizhniy_prod',{schema:58,localPrimary:true});
  for(const {name} of old.journal.filter(row=>!row.name.startsWith('0058-')))await owner.query(await readFile(new URL('../database/migrations/'+name,import.meta.url),'utf8'));
  await owner.query('create role blizhniy_runtime login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;revoke all on database blizhniy_prod from public;revoke create on schema public from public;create schema blizhniy_meta;create table blizhniy_meta.migrations(name text primary key,sha256 text not null);revoke all on schema blizhniy_meta from public;revoke all on blizhniy_meta.migrations from public');
  await owner.query(await readFile(new URL('../database/local-primary-payment.sql',import.meta.url),'utf8'));
  await owner.query(await readFile(new URL('../database/permissions/telegram-phone.sql',import.meta.url),'utf8'));
  await owner.query(await readFile(new URL('../database/candidates/0058-media-reference-journal.sql',import.meta.url),'utf8'));
  for(const {name,sha256} of old.journal)await owner.query('insert into blizhniy_meta.migrations values($1,$2)',[name,sha256]);
  for(const sql of mediaRetentionRuntimeGrants)await owner.query(sql);
  const options={database:'blizhniy_prod',merchant:{shopId:'local-fixture-shop',isTest:true},localPrimary:true};
  for(const [plan,verify] of [[old,verifyRefundWorkerDatabase],[getRefundOperatorRolePlan('blizhniy_prod',{schema:58,localPrimary:true}),verifyRefundOperatorDatabase],[getMediaRetentionRolePlan('blizhniy_prod'),verifyMediaRetentionDatabase]]){
   await owner.query(plan.createRole);await owner.query('alter role '+plan.role+' login password '+pg.escapeLiteral(password));for(const sql of plan.grants)await owner.query(sql);
   const db=new PostgresDatabase(new pg.Pool({...config,user:plan.role,max:1}));dbs.push(db);checks.push(()=>verify(db,options));
  }
  const state={database:'blizhniy_prod',dbPort:config.port,ownerPassword:password,origin:env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN};
  const check=async()=>{await verifyLocalPrimarySchema(state);for(const fn of checks)await fn();};
  await suite.test('previous local58 remains accepted, enabled specialist mode requires installation',async()=>{
   await check();process.env.BLIZHNIY_SPECIALIST_CHECKOUT='local-v1';try{await assert.rejects(verifyLocalPrimarySchema(state));}finally{delete process.env.BLIZHNIY_SPECIALIST_CHECKOUT;}
  });
  const migration=getSpecialistCheckoutMigration();await owner.query(migration.source);await owner.query('insert into blizhniy_meta.migrations values($1,$2)',[migration.name,migration.sha256]);
  await suite.test('launcher requires the new web grants before allowing schema60',async()=>{await assert.rejects(verifyLocalPrimarySchema(state));});
  await owner.query('grant select(intent_id,created_at),insert(intent_id) on app.specialist_checkout_terms to blizhniy_runtime');
  await suite.test('all three roles and launcher accept exact local60 with feature enabled or disabled',async()=>{
   await check();process.env.BLIZHNIY_SPECIALIST_CHECKOUT='local-v1';await check();delete process.env.BLIZHNIY_SPECIALIST_CHECKOUT;await check();
   for(const [plan,oldSchema] of [[getRefundWorkerRolePlan,58],[getRefundOperatorRolePlan,58]])assert.deepEqual(plan('blizhniy_prod',{schema:60,localPrimary:true}).grants,plan('blizhniy_prod',{schema:oldSchema,localPrimary:true}).grants);
   assert.deepEqual(getMediaRetentionRolePlan('blizhniy_prod',{schema:60}).grants,getMediaRetentionRolePlan('blizhniy_prod').grants);
   await assert.rejects(verifyRefundWorkerDatabase(dbs[0],{...options,localPrimary:false}));await assert.rejects(verifyRefundOperatorDatabase(dbs[1],{...options,localPrimary:false}));
  });
  for(const [title,change,undo] of [
   ['missing58',"delete from blizhniy_meta.migrations where name='0058-media-reference-journal.sql'",null],
   ['wrong60 hash',"update blizhniy_meta.migrations set sha256=repeat('0',64) where name='0060-local-specialist-checkout.sql'",null],
   ['unexpected59',"insert into blizhniy_meta.migrations values('0059-production-publication-test.sql',repeat('a',64))","delete from blizhniy_meta.migrations where name like '0059-%'"],
   ['unknown61',"insert into blizhniy_meta.migrations values('0061-unknown.sql',repeat('a',64))","delete from blizhniy_meta.migrations where name='0061-unknown.sql'"],
   ['disabled new trigger','alter table app.specialist_checkout_terms disable trigger specialist_checkout_terms_guard','alter table app.specialist_checkout_terms enable trigger specialist_checkout_terms_guard'],
   ['changed new function','alter function app.specialist_checkout_ready(uuid,uuid,bigint) security invoker','alter function app.specialist_checkout_ready(uuid,uuid,bigint) security definer'],
  ])await suite.test(title+' rejects every guard without modifying the database',async()=>{
   await owner.query(change);try{await assert.rejects(verifyLocalPrimarySchema(state));for(const fn of checks)await assert.rejects(fn());}
   finally{if(undo)await owner.query(undo);else{await owner.query('delete from blizhniy_meta.migrations');for(const {name,sha256} of getRefundWorkerRolePlan('blizhniy_prod',{schema:60,localPrimary:true}).journal)await owner.query('insert into blizhniy_meta.migrations values($1,$2)',[name,sha256]);}}
   await check();
  });
  for(let index=0;index<dbs.length;index++)await suite.test('role '+index+' cannot acquire specialist reads or new callable functions',async()=>{
   const role=['blizhniy_refund_worker','blizhniy_refund_operator','blizhniy_media_cleanup'][index];
   await assert.rejects(dbs[index].query('select * from app.specialist_checkout_terms'),{code:'42501'});
   await assert.rejects(dbs[index].query('select app.specialist_checkout_ready(null,null,null)'),{code:'42501'});
   for(const [grant,revoke] of [['grant select(intent_id) on app.specialist_checkout_terms to '+role,'revoke select(intent_id) on app.specialist_checkout_terms from '+role],['grant execute on function app.specialist_checkout_ready(uuid,uuid,bigint) to '+role,'revoke execute on function app.specialist_checkout_ready(uuid,uuid,bigint) from '+role]]){
    await owner.query(grant);try{await assert.rejects(checks[index]());}finally{await owner.query(revoke);}await checks[index]();
   }
  });
  await suite.test('web admission rejects missing grants, financial writes and direct execution of new guards',async()=>{
   for(const [change,undo] of [
    ['revoke insert(intent_id) on app.specialist_checkout_terms from blizhniy_runtime','grant insert(intent_id) on app.specialist_checkout_terms to blizhniy_runtime'],
    ['grant update(created_at) on app.specialist_checkout_terms to blizhniy_runtime','revoke update(created_at) on app.specialist_checkout_terms from blizhniy_runtime'],
    ['grant execute on function app.specialist_checkout_ready(uuid,uuid,bigint) to blizhniy_runtime','revoke execute on function app.specialist_checkout_ready(uuid,uuid,bigint) from blizhniy_runtime'],
   ]){await owner.query(change);try{await assert.rejects(verifyLocalPrimarySchema(state));}finally{await owner.query(undo);}await check();}
  });
  await suite.test('retention inventory stays read-only and reconciles after specialist schema addition',async()=>{
   await owner.query('begin isolation level repeatable read read only');try{await assertRefundSchema(owner,60,{localPrimary:true});const report=await readMediaRetentionInventory(owner,{retention:true});assert.equal(report.summary.accountingMatches,true);assert.equal(report.cleanupAuthorized,false);await assert.rejects(owner.query('delete from app.specialist_checkout_terms'),{code:'25006'});}finally{await owner.query('rollback');}
  });
  await suite.test('built financial guards admit current catalog and reject changed copied migration bytes',async()=>{
   for(const [name,build,index] of [['worker',buildRefundWorker,0],['operator',buildRefundOperator,1]]){
    const target=join(owned,name);build(target,{schema:60,localPrimary:true});const module=await import(pathToFileURL(join(target,'scripts/refund-'+name+'-role.mjs'))),verify=module[name==='worker'?'verifyRefundWorkerDatabase':'verifyRefundOperatorDatabase'];
    await verify(dbs[index],options);const path=join(target,'database/candidates/0060-local-specialist-checkout.sql'),bytes=await readFile(path);await writeFile(path,Buffer.concat([bytes,Buffer.from('-- changed\n')]));await assert.rejects(verify(dbs[index],options));await writeFile(path,bytes);await verify(dbs[index],options);
   }
  });
 }finally{
  for(const db of dbs)await db.close();await owner?.end();await rm(owned,{recursive:true,force:true});for(const [key,value] of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;
  if(id){const metadata=JSON.parse(await docker(['inspect',id]))[0];assert.equal(metadata.Id,id);assert.equal(metadata.Config.Image,image);assert.equal(metadata.Config.Labels[label],name);await docker(['rm','--force',id]);}
 }
});
