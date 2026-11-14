// Fresh owned PG18 only. Expected fingerprints are captured independently, never regenerated here.
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import pg from 'pg';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {buildRefundWorker} from '../scripts/build-refund-worker.mjs';
import {buildRefundOperator} from '../scripts/build-refund-operator.mjs';
import {getMediaRetentionMigration} from '../scripts/media-retention-release.mjs';
import {getMediaRetentionRolePlan,verifyMediaRetentionDatabase,mediaRetentionRuntimeGrants,verifyMediaRetentionRuntimeAccess} from '../scripts/media-retention-role.mjs';
import {getRefundWorkerRolePlan,verifyRefundWorkerDatabase} from '../scripts/refund-worker-role.mjs';
import {getRefundOperatorRolePlan,verifyRefundOperatorDatabase} from '../scripts/refund-operator-role.mjs';
import {verifyLocalPrimarySchema} from '../scripts/local-primary-fixture.mjs';
import {loadMediaModule} from './media-module.mjs';
import {fileWorkerModule} from './media-file-worker-module.mjs';
const {PostgresDatabase}=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule('postgres');
const {LocalMediaRetirement}=loadMediaModule('media-retirement');
export async function testMediaRetentionActivation(suite,{admin,config}){
 await admin.query('create database blizhniy_prod');
 const owner=new pg.Pool({...config,database:'blizhniy_prod',max:2}),databases=[],checks=[];
 const local={NODE_ENV:'test',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://127.0.0.1:3045',BLIZHNIY_LISTING_WORKFLOW:'postmoderation',BLIZHNIY_SERVICE_CHECKOUT:'local-v1',BLIZHNIY_MEDIA_RETENTION:'local-v1'};
 const saved=Object.fromEntries(Object.keys(local).map(key=>[key,process.env[key]]));Object.assign(process.env,local);
 const state={database:'blizhniy_prod',dbPort:config.port,ownerPassword:config.password,origin:local.BLIZHNIY_LOCAL_PRIMARY_ORIGIN},plan=getMediaRetentionRolePlan('blizhniy_prod');
 try{
  for(const {name} of getRefundWorkerRolePlan('blizhniy_prod',{schema:57}).journal)await owner.query(await readFile(new URL('../database/migrations/'+name,import.meta.url),'utf8'));
  await owner.query(`create role blizhniy_runtime login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
   revoke all on database blizhniy_prod from public;revoke create on schema public from public;
   create schema blizhniy_meta;create table blizhniy_meta.migrations(name text primary key,sha256 text not null);
   revoke all on schema blizhniy_meta from public;revoke all on blizhniy_meta.migrations from public`);
  await owner.query(await readFile(new URL('../database/local-primary-payment.sql',import.meta.url),'utf8'));
  await owner.query(await readFile(new URL('../database/permissions/telegram-phone.sql',import.meta.url),'utf8'));
  await owner.query(getMediaRetentionMigration().source);
  for(const {name,sha256} of plan.journal)await owner.query('insert into blizhniy_meta.migrations values($1,$2)',[name,sha256]);
  for(const sql of mediaRetentionRuntimeGrants)await owner.query(sql);
  for(const [candidate,verify] of [[plan,verifyMediaRetentionDatabase],[getRefundWorkerRolePlan('blizhniy_prod',{schema:58,localPrimary:true}),verifyRefundWorkerDatabase],[getRefundOperatorRolePlan('blizhniy_prod',{schema:58,localPrimary:true}),verifyRefundOperatorDatabase]]){
   await owner.query(candidate.createRole);await owner.query(`alter role ${candidate.role} login password ${pg.escapeLiteral(config.password)}`);
   for(const sql of candidate.grants)await owner.query(sql);
   const db=new PostgresDatabase(new pg.Pool({...config,database:'blizhniy_prod',user:candidate.role,max:2}));databases.push(db);
   checks.push(()=>verify(db,{database:'blizhniy_prod',merchant:{shopId:'media-fixture',isTest:true},localPrimary:true}));
  }
  const check=async()=>{await verifyLocalPrimarySchema(state);for(const fn of checks)await fn();};
  await suite.test('local58 needs explicit rollout, exact schema and minimal roles; financial grants stay unchanged',async()=>{
   await check();for(const fn of [getRefundWorkerRolePlan,getRefundOperatorRolePlan])assert.deepEqual(fn('blizhniy_prod',{schema:58,localPrimary:true}).grants,fn('blizhniy_prod',{schema:57}).grants);
   delete process.env.BLIZHNIY_MEDIA_RETENTION;try{await assert.rejects(verifyLocalPrimarySchema(state));}finally{process.env.BLIZHNIY_MEDIA_RETENTION='local-v1';}
   await assert.rejects(verifyRefundWorkerDatabase(databases[1],{database:'blizhniy_prod',merchant:{shopId:'media-fixture',isTest:true}}));
   await assert.rejects(verifyRefundOperatorDatabase(databases[2],{database:'blizhniy_prod',merchant:{shopId:'media-fixture',isTest:true}}));
  });
  for(const [name,change,undo] of [
   ['missing58',"delete from blizhniy_meta.migrations where name='0058-media-reference-journal.sql'",null],
   ['wrong58hash',"update blizhniy_meta.migrations set sha256=repeat('0',64) where name='0058-media-reference-journal.sql'",null],
   ['unknown59',"insert into blizhniy_meta.migrations values('0059-synthetic.sql',repeat('a',64))","delete from blizhniy_meta.migrations where name='0059-synthetic.sql'"],
   ['disabled request guard','alter table app.media_retirement_requests disable trigger media_retirement_request_guard','alter table app.media_retirement_requests enable trigger media_retirement_request_guard'],
   ['changed clock',"create or replace function app.media_retention_clock() returns timestamptz language sql volatile security definer set search_path='' as $$select pg_catalog.clock_timestamp()+interval '1 day'$$",null],
   ['view security mode','alter view app.media_active_usage set(security_invoker=true)','alter view app.media_active_usage reset(security_invoker)'],
  ])await suite.test(name+' rejects launcher and all three roles without repair',async()=>{
   const clock=(await owner.query("select pg_get_functiondef('app.media_retention_clock()'::regprocedure) source")).rows[0].source;
   await owner.query(change);try{await assert.rejects(verifyLocalPrimarySchema(state));for(const fn of checks)await assert.rejects(fn());}
   finally{if(undo)await owner.query(undo);else if(name==='changed clock')await owner.query(clock);else{await owner.query("delete from blizhniy_meta.migrations where name='0058-media-reference-journal.sql'");await owner.query('insert into blizhniy_meta.migrations values($1,$2)',[plan.journal.at(-1).name,plan.journal.at(-1).sha256]);}}
   await check();
  });
  for(const [name,grant,revoke,index=0] of [
   ['private owner column','grant select(owner_id) on app.media_objects to blizhniy_media_cleanup','revoke select(owner_id) on app.media_objects from blizhniy_media_cleanup'],
   ['clock execution','grant execute on function app.media_retention_clock() to blizhniy_media_cleanup','revoke execute on function app.media_retention_clock() from blizhniy_media_cleanup'],
   ['system secrets','grant select on pg_catalog.pg_authid to blizhniy_media_cleanup','revoke select on pg_catalog.pg_authid from blizhniy_media_cleanup'],
   ['language ownership','alter language plpgsql owner to blizhniy_media_cleanup','alter language plpgsql owner to postgres'],
   ['NOINHERIT role membership','create role media_escape nologin;grant media_escape to blizhniy_media_cleanup with inherit false,set true','revoke media_escape from blizhniy_media_cleanup;drop role media_escape'],
   ['financial metadata read','grant select(id) on app.media_objects to blizhniy_refund_worker','revoke select(id) on app.media_objects from blizhniy_refund_worker',1],
  ])await suite.test(name+' is rejected by exact admission',async()=>{await owner.query(grant);try{await assert.rejects(checks[index]());}finally{await owner.query(revoke);}await check();});
  for(const [change,undo] of [
   ['grant insert(media_id,operation_id) on app.media_retirement_requests to blizhniy_runtime','revoke insert(media_id,operation_id) on app.media_retirement_requests from blizhniy_runtime'],
   ['grant select(media_id) on app.media_retirement_completions to blizhniy_runtime','revoke select(media_id) on app.media_retirement_completions from blizhniy_runtime'],
   ['create role web_media_escape nologin;grant web_media_escape to blizhniy_runtime with inherit false,set true','revoke web_media_escape from blizhniy_runtime;drop role web_media_escape'],
  ])await suite.test('web runtime cannot acquire cleanup authority, even through SET ROLE',async()=>{await owner.query(change);try{await assert.rejects(verifyMediaRetentionRuntimeAccess(owner));await assert.rejects(verifyLocalPrimarySchema(state));}finally{await owner.query(undo);}await check();});
  await suite.test('actual cleanup role cannot read contacts, payment data, change identity or storage accounting',async()=>{
   for(const sql of ['select email from app.users','select * from app.payment_checkout_intents','select owner_id from app.media_objects','select app.media_retention_clock()','delete from app.media_objects','update app.media_storage_budget set charged_objects=0'])await assert.rejects(databases[0].query(sql),{code:'42501'});
   const user=(await owner.query("insert into app.users(email,password_hash) values('cleanup@example.invalid',$1) returning id",['scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128)])).rows[0].id;
   const id=(await owner.query("insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256) values($1,$2,'image/webp',1,1,12,$3) returning id",[user,randomUUID(),'a'.repeat(64)])).rows[0].id;
   await assert.rejects(databases[0].query('update app.media_objects set id=$2 where id=$1',[id,randomUUID()]),{code:'23514'});
  });
  await suite.test('copied financial guards admit local58 and reject altered candidate bytes without new permissions',async()=>{
   const directory=await mkdtemp(join(tmpdir(),'blizhniy-media-financial-'));
   try{
    for(const [name,build,index] of [['worker',buildRefundWorker,1],['operator',buildRefundOperator,2]]){
     const target=join(directory,name);build(target,{schema:58,localPrimary:true});
     const module=await import(pathToFileURL(join(target,'scripts/refund-'+name+'-role.mjs')));
     const verify=module[name==='worker'?'verifyRefundWorkerDatabase':'verifyRefundOperatorDatabase'];
     const options={database:'blizhniy_prod',merchant:{shopId:'media-fixture',isTest:true},localPrimary:true};
     await verify(databases[index],options);
     const candidate=join(target,'database/candidates/0058-media-reference-journal.sql'),bytes=await readFile(candidate);
     await writeFile(candidate,Buffer.concat([bytes,Buffer.from('-- changed candidate\n')]));
     try{await assert.rejects(verify(databases[index],options));}finally{await writeFile(candidate,bytes);}
     await verify(databases[index],options);
    }
   }finally{await rm(directory,{recursive:true,force:true});}
  });
  await suite.test('web upload uses the four new read columns and cannot revive a retired intent',async()=>{
   await owner.query(`alter role blizhniy_runtime password ${pg.escapeLiteral(config.password)};
    grant connect on database blizhniy_prod to blizhniy_runtime;grant usage on schema app to blizhniy_runtime;
    grant select on app.users,app.sessions,app.media_objects,app.media_write_attempts to blizhniy_runtime;
    grant update(id) on app.users to blizhniy_runtime;grant update(last_seen_at) on app.sessions to blizhniy_runtime;
    grant insert(owner_id,intent_id,mime_type,width,height,size,sha256),update(state,ready_at) on app.media_objects to blizhniy_runtime`);
   const web=new PostgresDatabase(new pg.Pool({...config,database:'blizhniy_prod',user:'blizhniy_runtime',max:2}));
   const source=(await owner.query("select pg_get_functiondef('app.media_retention_clock()'::regprocedure) source")).rows[0].source;
   try{
    const user=(await owner.query("insert into app.users(email,password_hash,email_verified_at) values('cleanup-web@example.invalid',$1,clock_timestamp()) returning id",['scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128)])).rows[0].id,token=randomBytes(32).toString('hex');
    await owner.query('insert into app.sessions(token_hash,user_id,auth_version) select $1,id,auth_version from app.users where id=$2',[createHash('sha256').update(token).digest('hex'),user]);
    const repository=new(loadMediaModule('media-metadata').MediaMetadataRepository)(web,{read(){throw Error('unexpected file read');}},true),intent=randomUUID();
    const image={mimeType:'image/webp',width:1,height:1,size:12,sha256:'a'.repeat(64)},pending=await repository.reserve(token,intent,image);
    await owner.query("create or replace function app.media_retention_clock() returns timestamptz language sql volatile security definer set search_path='' as $$select pg_catalog.clock_timestamp()+interval '7 days'$$");
    const operation=randomUUID();await databases[0].query('insert into app.media_retirement_requests(media_id,operation_id) values($1,$2)',[pending.id,operation]);
    await databases[0].query('insert into app.media_retirement_completions(media_id,operation_id) values($1,$2)',[pending.id,operation]);
    await assert.rejects(repository.getByIntent(token,intent),{code:'MEDIA_INTENT_CONFLICT'});
    await assert.rejects(repository.reserve(token,intent,image),{code:'MEDIA_INTENT_CONFLICT'});
    assert.notEqual((await repository.reserve(token,randomUUID(),image)).id,pending.id);
    await assert.rejects(web.query('insert into app.media_retirement_requests(media_id,operation_id) values($1,$2)',[pending.id,randomUUID()]),{code:'42501'});
   }finally{await owner.query(source);await web.close();}
   await check();
  });
  await suite.test('real child deletes once with exact cleanup grants; completion replay remains permitted and idempotent',async()=>{
   const directory=await mkdtemp(join(tmpdir(),'blizhniy-media-admission-'));
   const source=(await owner.query("select pg_get_functiondef('app.media_retention_clock()'::regprocedure) source")).rows[0].source;
   try{
    await writeFile(join(directory,'.writer.lock'),'',{mode:0o600,flag:'wx'});
    const user=(await owner.query("insert into app.users(email,password_hash) values('cleanup-file@example.invalid',$1) returning id",['scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128)])).rows[0].id;
    const bytes=Buffer.from('524946460400000057454250','hex');
    const id=(await owner.query("insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256) values($1,$2,'image/webp',1,1,$3,$4) returning id",[user,randomUUID(),bytes.length,createHash('sha256').update(bytes).digest('hex')])).rows[0].id;
    await owner.query('insert into app.media_write_attempts(media_id,id) values($1,$2)',[id,randomUUID()]);
    await owner.query("update app.media_objects set state='ready',ready_at=clock_timestamp() where id=$1",[id]);
    await writeFile(join(directory,id+'.webp'),bytes,{mode:0o600,flag:'wx'});
    const before=(await owner.query('select charged_objects,charged_bytes from app.media_storage_budget')).rows[0];
    await owner.query("create or replace function app.media_retention_clock() returns timestamptz language sql volatile security definer set search_path='' as $$select pg_catalog.clock_timestamp()+interval '7 days'$$");
    const worker=await fileWorkerModule().createLocalMediaFileWorker(fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,''),directory);
    const cleanup=new LocalMediaRetirement(databases[0],worker),first=await cleanup.retire(id),second=await cleanup.retire(id);
    assert.deepEqual(second,first);await assert.rejects(stat(join(directory,id+'.webp')),{code:'ENOENT'});
    const after=(await owner.query('select charged_objects,charged_bytes from app.media_storage_budget')).rows[0];
    assert.equal(before.charged_objects-after.charged_objects,1);assert.equal(BigInt(before.charged_bytes)-BigInt(after.charged_bytes),BigInt(bytes.length));
    assert.equal((await owner.query('select count(*)::int n from app.media_retirement_completions where media_id=$1',[id])).rows[0].n,1);
   }finally{await owner.query(source);await rm(directory,{recursive:true,force:true});}
   await check();
  });
 }finally{
  for(const db of databases)await db.close();await owner.end();
  for(const [key,value] of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;
 }
}
