import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import pg from 'pg';
import {getAdminPasskeyMigrations} from '../scripts/admin-user-access-release.mjs';
import {verifyAdminPasskeyDatabase} from '../scripts/admin-passkey-verifier-role.mjs';
import {buildUserAccessOperator} from '../scripts/build-user-access-operator.mjs';
import {buildRefundWorker} from '../scripts/build-refund-worker.mjs';
import {buildRefundOperator} from '../scripts/build-refund-operator.mjs';
import {buildPublicationRestrictionOperator} from '../scripts/build-publication-restriction-operator.mjs';
import {getHostedPublicationRestrictionUpgradeSql,getHostedRefundReleasePlan} from '../scripts/publication-test-release-plan.mjs';

export async function testHostedPasskeyFinance(t,{admin,config,docker,container,PostgresDatabase,profiles,load}){
 const migrations=getAdminPasskeyMigrations().map(({name,sha256})=>({name,sha256}));
 const directory=await mkdtemp(join(tmpdir(),'blizhniy-guarded-operator-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const output=join(directory,'operator');
 const hosted='passkey-tariffs',manifest=buildUserAccessOperator(output,{hosted});
 assert.deepEqual(manifest.passkeyMigrations,migrations);
 const connect=(database,credentials)=>new PostgresDatabase(new pg.Pool({...config,...credentials,database,max:1}));
 const restored='hosted_passkey_restored';
 const verify=async (database,expectRejection=false)=>{
  for(const {role,password,verify} of profiles){
   const db=connect(database,{user:role,password});
   try{
    const check=()=>verify(db,database);
    if(expectRejection)await assert.rejects(check(),/preflight failed/);
    else await check();
   }finally{await db.close();}
  }
 };
 await verify(config.database);
 const verifier='blizhniy_passkey_verifier',role='blizhniy_user_operator';
 const verifierPassword=randomBytes(32).toString('hex'),operatorPassword=randomBytes(32).toString('hex');
 await admin.query('create role '+verifier+' login noinherit connection limit 4 password '+pg.escapeLiteral(verifierPassword));
 await admin.query('alter role '+role+' password '+pg.escapeLiteral(operatorPassword));
 await admin.query('grant connect on database "'+config.database+'" to '+verifier);
 const upgrade=await readFile(join(output,'database','admin-passkey-upgrade.sql'),'utf8');
 const apply=async sql=>{
  const client=await admin.connect();
  try{await client.query(sql);}catch(error){await client.query('rollback');throw error;}finally{client.release();}
 };
 await assert.rejects(apply(upgrade.replace(/\ncommit;\n$/,'\nselect 1/0;\ncommit;\n')),{code:'22012'});
 assert.equal((await admin.query("select to_regnamespace('app_admin_passkey') as namespace")).rows[0].namespace,null);
 await verify(config.database);
 await apply(upgrade);
 await admin.query('create database hosted_passkey_restored template template0');
 await admin.query('revoke all on database hosted_passkey_restored from public');
 for(const login of [...profiles.map(profile=>profile.role),role,verifier,'blizhniy_reconciliation_operator','blizhniy_reconciliation_monitor'])
  await admin.query('grant connect on database hosted_passkey_restored to '+login);
 await docker(['exec',container,'bash','-euo','pipefail','-c',
  'pg_dump --format=custom --username=postgres --dbname="$1" | pg_restore --single-transaction --exit-on-error --username=postgres --dbname="$2"',
  'restore-fixture',config.database,restored]);
 await verify(config.database);
 await verify(restored);
 const alter=statement=>admin.query('alter table app_admin_passkey.challenges '+statement);
 await alter('add column fixture_user uuid references app.users(id)');
 try{await verify(config.database,true);}
 finally{await alter('drop column fixture_user');}
 await verify(config.database);
 await t.test('the packaged guarded operator and verifier preserve role boundaries on the restored schema',async t=>{
  await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),join(output,'node_modules'),'dir');
  const script=name=>import(pathToFileURL(join(output,'scripts',name)).href);
  const {verifyUserAccessDatabase}=await script('user-access-role.mjs');
  const {startLocalAdminOperator}=await script('local-admin-operator.mjs');
  const credentials={user:role,password:operatorPassword};
  const operator=connect(config.database,credentials);
  t.after(()=>operator.close());
  const check=()=>verifyUserAccessDatabase(operator,{database:config.database,hosted});
  await check();
  await assert.rejects(verifyUserAccessDatabase(operator,{database:config.database,hosted:'tariffs'}),/preflight failed/);
  for(const database of [config.database,restored]){
   const db=connect(database,{user:verifier,password:verifierPassword});
   try{await verifyAdminPasskeyDatabase(db,{database});}finally{await db.close();}
  }
  const restoredOperator=connect(restored,credentials);
  try{await verifyUserAccessDatabase(restoredOperator,{database:restored,hosted});}finally{await restoredOperator.close();}
  const path=join(output,'database/candidates/0090-user-access-passkey.sql'),bytes=await readFile(path);
  await writeFile(path,Buffer.concat([bytes,Buffer.from('\n-- fixture drift\n')]));
  try{await assert.rejects(check(),/preflight failed/);}finally{await writeFile(path,bytes);}
  const legacy='app_admin.user_access_before_passkey(text,uuid,text,uuid,uuid,bigint,text,boolean,text)';
  await admin.query('grant execute on function '+legacy+' to '+role);
  try{await assert.rejects(check(),/preflight failed/);}
  finally{await admin.query('revoke execute on function '+legacy+' from '+role);}
  await admin.query('grant usage on schema app_admin_passkey to blizhniy_runtime;grant insert on app_admin_passkey.user_access_permits to blizhniy_runtime');
  try{await assert.rejects(check(),/preflight failed/);}
  finally{await admin.query('revoke insert on app_admin_passkey.user_access_permits from blizhniy_runtime;revoke usage on schema app_admin_passkey from blizhniy_runtime');}
  const {PostgresAdminUserAccess}=createRequire(join(output,'package.json'))('./compiled/lib/postgres-admin-user-access.js');
  const store=new PostgresAdminUserAccess(operator);
  const daemon=await startLocalAdminOperator({async execute(token,command){await check();return store.execute(token,command);},close:async()=>{}});
  try{
   const {hashSessionToken}=load('identity');
   const send=load('local-user-access-operator-client').callLocalUserAccessOperator;
   const actor=randomUUID(),target=randomUUID(),token=randomBytes(32).toString('hex'),session=hashSessionToken(token);
   const passwordHash='scrypt$131072$8$1$'+'0'.repeat(32)+'$'+'0'.repeat(128);
   await admin.query(`insert into app.users(id,email,password_hash,role,email_verified_at)
    values($1,$3,$5,'admin',clock_timestamp()),($2,$4,$5,'user',clock_timestamp())`,
    [actor,target,actor+'@fixture.invalid',target+'@fixture.invalid',passwordHash]);
   await admin.query("insert into app.sessions(token_hash,user_id,auth_version) values($1,$2,0)",[session,actor]);
   const input={targetId:target,id:randomUUID(),expectedVersion:'0',role:'user',isBlocked:true,reason:'Синтетическая проверка доступа'};
   const change={action:'change',expectedAdminId:actor,input};
   await assert.rejects(send(daemon.socketPath,token,change),{code:'PASSKEY_REQUIRED'});
   const key=randomBytes(32).toString('base64url');
   await admin.query('insert into app_admin_passkey.credentials(id,admin_id,user_handle,public_key,counter) values($1,$2,$1,$3,0)',
    [key,actor,randomBytes(32)]);
   await admin.query(`insert into app_admin_passkey.user_access_permits(session_hash,auth_version,credential_id,command,expires_at)
    values($1,0,$2,$3,clock_timestamp()+interval '30 seconds')`,
    [session,key,JSON.stringify([actor,target,input.id,input.expectedVersion,input.role,input.isBlocked,input.reason])]);
   const changed=await send(daemon.socketPath,token,change);
   assert.equal(changed.user.isBlocked,true);
   await assert.rejects(send(daemon.socketPath,token,change),{code:'PASSKEY_REQUIRED'});
   const recovered=await send(daemon.socketPath,token,{action:'recover',expectedAdminId:actor,targetId:target,id:input.id});
   assert.deepEqual(recovered.receipt,changed.receipt);
  }finally{await daemon.close();}
 });
 await t.test('guarded TEST refunds verify a browser key before mutations and read the committed result',async()=>{
  const {testHostedRefundPasskey}=await import('./hosted-refund-passkey-postgres.mjs');
  await testHostedRefundPasskey({admin,config,load,directory,PostgresDatabase,profiles,verifierPassword});
 });
 await t.test('restriction delivery upgrade admits exact packaged roles and survives a logical restore',async()=>{
  const owner=new pg.Pool({...config,database:restored,max:1});
  const restore='blizhniy_prod';
  const options={hostedRefunds:true,merchant:{shopId:'900000001',isTest:true,marqueeRefunds:true,specialistRefunds:true}};
  const extended=[profiles[0]];
  for(const [kind,build,verify] of [
   ['worker',buildRefundWorker,'verifyRefundWorkerDatabase'],
   ['operator',buildRefundOperator,'verifyRefundOperatorDatabase'],
  ]){
   const destination=join(directory,'publication-restriction-'+kind);
   assert.equal(build(destination,{schema:95}).schema,95);
   const api=await import(pathToFileURL(join(destination,'scripts/refund-'+kind+'-role.mjs')).href);
   extended.push({...profiles.find(profile=>profile.kind===kind),verify:(db,database)=>api[verify](db,{...options,database})});
  }
  const api=await import(pathToFileURL(join(output,'scripts/user-access-role.mjs')).href);
  extended.push({role,password:operatorPassword,verify:(db,database)=>api.verifyUserAccessDatabase(db,{database,hosted})});
  const check=async(database,admitted=true)=>{
   for(const {role:user,password,verify} of extended){
    const db=connect(database,{user,password});
    try{
     if(admitted)await verify(db,database);
     else await assert.rejects(verify(db,database),/preflight failed/);
    }finally{await db.close();}
   }
  };
  try{
   await check(restored);
   // This clone has only the earlier synthetic 0093 data, outside the hosted journal.
   await owner.query('drop schema app_publication_restriction cascade');
   await owner.query('create role blizhniy_publication_operator nologin noinherit connection limit 4');
   const sql=getHostedPublicationRestrictionUpgradeSql();
   await assert.rejects(owner.query(sql.replace(/\ncommit;\n$/,'\nselect 1/0;\ncommit;\n')),{code:'22012'});
   await owner.query('rollback');
   assert.equal((await owner.query("select to_regnamespace('app_publication_restriction') as schema")).rows[0].schema,null);
   await check(restored);
   await owner.query(sql);
   const expected=getHostedRefundReleasePlan(95).map(({name,sha256})=>({name,sha256}));
   assert.deepEqual((await owner.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows,expected);
   await check(restored);
   const signature='app_response.deliver(uuid,uuid)';
   await owner.query('alter function '+signature+' set search_path=pg_catalog,pg_temp');
   try{await check(restored,false);}finally{await owner.query('alter function '+signature+' set search_path=pg_catalog');}
   await owner.query('grant select(case_id) on app_publication_restriction.restrictions to blizhniy_runtime');
   try{await check(restored,false);}finally{await owner.query('revoke select(case_id) on app_publication_restriction.restrictions from blizhniy_runtime');}
   await assert.rejects(owner.query(sql),{code:'55000'});
   await owner.query('rollback');
   const moderation=join(directory,'publication-moderation');
   const manifest=buildPublicationRestrictionOperator(moderation);
   const verifyPasskey=async database=>{
    const db=connect(database,{user:verifier,password:verifierPassword});
    try{await verifyAdminPasskeyDatabase(db,{database});}finally{await db.close();}
   };
   const packagedSql=async(name,expectedDigest)=>{
    const sql=await readFile(join(moderation,'database/candidates',name),'utf8');
    assert.equal(createHash('sha256').update(sql).digest('hex'),expectedDigest);
    return sql;
   };
   const withdrawal=await packagedSql('0096-publication-location-withdrawals.sql',manifest.locationWithdrawal.migrationSha256);
   const consent=await packagedSql('0097-publication-location-consent.sql',manifest.locationConsent.migrationSha256);
   assert.match(consent,/\ncommit;\n$/);
   await owner.query(withdrawal);
   await assert.rejects(owner.query(consent.replace(/\ncommit;\n$/,'\nselect 1/0;\ncommit;\n')),{code:'22012'});
   await owner.query('rollback');
   const privacyState=async db=>(await db.query(`select
    to_regclass('app_publication_privacy.location_withdrawals') is not null as withdrawals,
    to_regclass('app_publication_privacy.publication_consents') is not null as consents`)).rows[0];
   assert.deepEqual(await privacyState(owner),{withdrawals:true,consents:false});
   await check(restored);
   await verifyPasskey(restored);
   const inserted=await owner.query(`insert into app_publication_privacy.location_withdrawals(kind,publication_id,scope)
    select kind,id,'location' from app.work_publications where kind in ('vacancy','workRequest') and deleted_at is null order by id limit 1`);
   assert.equal(inserted.rowCount,1);
   const withdrawalLedger='select kind,publication_id,scope,withdrawn_at from app_publication_privacy.location_withdrawals';
   const withdrawals=(await owner.query(withdrawalLedger)).rows;
   await owner.query(consent);
   assert.deepEqual(await privacyState(owner),{withdrawals:true,consents:true});
   assert.deepEqual((await owner.query(withdrawalLedger)).rows,withdrawals);
   await check(restored);
   await verifyPasskey(restored);
   const renameSubjectKey=(from,to)=>owner.query('alter table app_publication_privacy.publication_consents rename constraint '+from+' to '+to);
   const subjectKey='publication_consents_subject_id_fkey',driftedKey='fixture_drifted_consent_subject_fkey';
   await renameSubjectKey(subjectKey,driftedKey);
   try{await check(restored,false);}finally{await renameSubjectKey(driftedKey,subjectKey);}
   await check(restored);

   const ledger='select kind,publication_id,restricted_revision,case_id,restricted_at from app_publication_restriction.restrictions';
   const seed=await owner.query(`insert into app_publication_restriction.restrictions(kind,publication_id,restricted_revision,case_id)
    select kind,id,revision,$1 from app.work_publications where deleted_at is null order by id limit 1`,[randomUUID()]);
   assert.equal(seed.rowCount,1);
   const cases=(await owner.query(ledger)).rows;
   await admin.query('create database '+restore+' template template0');
   await admin.query('revoke all on database '+restore+' from public');
   await admin.query('grant connect on database '+restore+' to blizhniy_reconciliation_operator,blizhniy_reconciliation_monitor');
   for(const login of [...extended.map(({role})=>role),verifier])await admin.query('grant connect on database '+restore+' to '+login);
   await docker(['exec',container,'bash','-euo','pipefail','-c',
    'pg_dump --format=custom --username=postgres --dbname="$1" | pg_restore --single-transaction --exit-on-error --username=postgres --dbname="$2"',
    'restore-fixture',restored,restore]);
   await check(restore);
   await verifyPasskey(restore);
   const copy=connect(restore,{});
   try{
    assert.deepEqual((await copy.query(ledger)).rows,cases);
    assert.deepEqual(await privacyState(copy),{withdrawals:true,consents:true});
    assert.deepEqual((await copy.query(withdrawalLedger)).rows,withdrawals);
    const {verifyPublicationRestrictionDatabase}=await import(pathToFileURL(join(moderation,'scripts/publication-restriction-operator-role.mjs')).href);
    const password=randomBytes(32).toString('hex');
    await copy.query('alter role '+manifest.role+' login password '+pg.escapeLiteral(password));
    await copy.query('grant connect on database blizhniy_prod to '+manifest.role);
    const executor=connect(restore,{user:manifest.role,password});
    try{
     const verify=()=>verifyPublicationRestrictionDatabase(executor,{database:restore});
     await verify();
     await assert.rejects(executor.query('select case_id from app_publication_restriction.restrictions'),{code:'42501'});
     await copy.query('grant usage on schema app to '+manifest.role);
     try{await assert.rejects(verify(),/preflight failed/);}
     finally{await copy.query('revoke usage on schema app from '+manifest.role);}
     await copy.query('create foreign data wrapper fixture_restriction_wrapper no handler no validator');
     await copy.query('create server fixture_restriction_server foreign data wrapper fixture_restriction_wrapper');
     await copy.query('grant usage on foreign server fixture_restriction_server to '+manifest.role);
     try{await assert.rejects(verify(),/preflight failed/);}
     finally{await copy.query('drop foreign data wrapper fixture_restriction_wrapper cascade');}
     await verify();
    }finally{await executor.close();}
   }finally{await copy.close();}
  }finally{await owner.end();}
 });
}
