import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,mkdtempSync,rmSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {bootstrapPostgres,getBootstrapPlan} from '../scripts/bootstrap-postgres.mjs';
import {getPaymentReconciliationRolePlan,verifyPaymentReconciliationDatabase} from '../scripts/payment-reconciliation-role.mjs';
import {runPaymentReconciliationService} from '../scripts/payment-reconciliation-service.mjs';
import {PostgresDatabase} from '../src/lib/postgres.ts';
import {PostgresPaymentReconciliationQueue} from '../src/lib/postgres-payment-reconciliation.ts';
import * as intents from '../src/lib/postgres-payment-intents.ts';
import {buildPaymentWorker} from '../scripts/build-payment-worker.mjs';

export async function testPaymentReconciliationRole(suite,admin,config,credentials) {
 assert.equal(config.host,'127.0.0.1');assert.equal(config.database,'blizhniy_test');
 const target='127.0.0.1:blizhniy_test',options={includePaymentReconciliationRole:true};
 const before=(await admin.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;
 const down=readFileSync(new URL('../database/migrations/0024-reconciliation-lock-guards.down.sql',import.meta.url),'utf8');
 await suite.test('lock guards are separately opt-in, preserve23 hashes, grant nothing and can be removed before any worker grants',async()=>{
  assert.equal(before.length,23);assert.equal((await bootstrapPostgres(admin,target,options)).applied,1);
  assert.deepEqual(getBootstrapPlan(options).slice(0,23).map(({name,sha256})=>({name,sha256})),before);
  assert.equal((await bootstrapPostgres(admin,target,options)).applied,0);
  assert.equal((await admin.query("select has_table_privilege('blizhniy_runtime','app.payment_reconciliation_jobs','UPDATE') as allowed")).rows[0].allowed,false);
  await admin.query(down);await admin.query("delete from blizhniy_meta.migrations where name='0024-reconciliation-lock-guards.sql'");
  assert.equal((await bootstrapPostgres(admin,target,options)).applied,1);
 });
 const plan=getPaymentReconciliationRolePlan(config.database),password=randomUUID(),role=plan.role;
 await admin.query(plan.createRole);
 await admin.query(`alter role ${role} login password '${password}'`);
 const db=new PostgresDatabase(new pg.Pool({...config,user:role,password,max:2,options:'-c search_path=pg_catalog,public',statement_timeout:8000}));
 const check=()=>verifyPaymentReconciliationDatabase(db,{database:config.database});
 const merchant={shopId:'restricted-reconciliation',isTest:true,secretKey:'test_synthetic_role_fixture'};
 const ownerDb=new PostgresDatabase(new pg.Pool({...config,max:2})),journal=new intents.PostgresPaymentIntentStore(ownerDb);
 let fixture,artifactDirectory;
 try {
  artifactDirectory=mkdtempSync(join(tmpdir(),'blizhniy-worker-pg-'));
  const artifact=join(artifactDirectory,'artifact');buildPaymentWorker(artifact);
  symlinkSync(fileURLToPath(new URL('../node_modules',import.meta.url)),join(artifact,'node_modules'),'dir');
  const {createPaymentReconciliationWorker}=createRequire(import.meta.url)(join(artifact,'compiled/lib/payment-reconciliation-worker.js'));
  await suite.test('actual dedicated login fails before its grants and passes only after the exact column-scoped plan',async()=>{
   await assert.rejects(check(),{message:'Payment reconciliation database preflight failed'});
   for(const sql of plan.grants)await admin.query(sql);
   await check();
   await assert.rejects(verifyPaymentReconciliationDatabase(ownerDb,{database:config.database}),{message:'Payment reconciliation database preflight failed'});
   await assert.rejects(verifyPaymentReconciliationDatabase(db,{database:'wrong_target'}),{message:'Payment reconciliation database preflight failed'});
  });
  await suite.test('preflight inspects user schemas beginning with pg without hiding schema, column, table, sequence or function privileges',async()=>{
   await admin.query('create schema pgbackup_acl_probe; create table pgbackup_acl_probe.probe(id integer); create sequence pgbackup_acl_probe.counter; create function pgbackup_acl_probe.probe() returns integer language sql as $$ select 1 $$; revoke execute on function pgbackup_acl_probe.probe() from public');
   try {
    await check();
    const changes=[
     [`grant usage,create on schema pgbackup_acl_probe to ${role}`,`revoke usage,create on schema pgbackup_acl_probe from ${role}`],
     [`grant select(id) on pgbackup_acl_probe.probe to ${role}`,`revoke select(id) on pgbackup_acl_probe.probe from ${role}`],
     [`grant delete on pgbackup_acl_probe.probe to ${role}`,`revoke delete on pgbackup_acl_probe.probe from ${role}`],
     [`grant usage on sequence pgbackup_acl_probe.counter to ${role}`,`revoke usage on sequence pgbackup_acl_probe.counter from ${role}`],
     [`grant execute on function pgbackup_acl_probe.probe() to ${role}`,`revoke execute on function pgbackup_acl_probe.probe() from ${role}`],
    ];
    for(const [change,restore] of changes) {
     await admin.query(change);
     try {await assert.rejects(check(),{message:'Payment reconciliation database preflight failed'});}
     finally {await admin.query(restore);}
     await check();
    }
   }finally {await admin.query('drop function pgbackup_acl_probe.probe(); drop sequence pgbackup_acl_probe.counter; drop table pgbackup_acl_probe.probe; drop schema pgbackup_acl_probe');}
  });
  await suite.test('preflight refuses extra rights, grant options, missing reads, memberships, replication override, trigger or function tampering and hash drift',async()=>{
   await admin.query('create role reconciliation_member_probe nologin');
   const originalHash=plan.journal[0].sha256;
   const restoreFunction=getBootstrapPlan(options).at(-1).sql.match(/create function app\.guard_reconciliation_locks\(\)[\s\S]*?\$\$;/)[0].replace('create function','create or replace function');
   const changes=[
    [`grant select(email) on app.users to ${role}`,`revoke select(email) on app.users from ${role}`],
    [`grant update(role) on app.users to ${role}`,`revoke update(role) on app.users from ${role}`],
    [`grant delete on app.payment_reconciliation_jobs to ${role}`,`revoke delete on app.payment_reconciliation_jobs from ${role}`],
    [`grant select(id) on app.users to ${role} with grant option`,`revoke grant option for select(id) on app.users from ${role}`],
    [`revoke select(sha256) on blizhniy_meta.migrations from ${role}`,`grant select(sha256) on blizhniy_meta.migrations to ${role}`],
    [`grant create on schema public to ${role}`,`revoke create on schema public from ${role}`],
    [`revoke usage on schema app from ${role}`,`grant usage on schema app to ${role}`],
    [`grant execute on function app.guard_auth_version() to ${role}`,`revoke execute on function app.guard_auth_version() from ${role}`],
    [`alter role ${role} createdb`,`alter role ${role} nocreatedb`],
    [`alter role ${role} inherit`,`alter role ${role} noinherit`],
    [`grant reconciliation_member_probe to ${role}`,`revoke reconciliation_member_probe from ${role}`],
    [`grant ${role} to reconciliation_member_probe`,`revoke ${role} from reconciliation_member_probe`],
    [`grant set on parameter session_replication_role to ${role}`,`revoke set on parameter session_replication_role from ${role}`],
    ['alter table app.users disable trigger reconciliation_lock_only','alter table app.users enable always trigger reconciliation_lock_only'],
    ['alter function app.guard_reconciliation_locks() security definer','alter function app.guard_reconciliation_locks() security invoker'],
    ["create or replace function app.guard_reconciliation_locks() returns trigger language plpgsql security invoker set search_path='' as $$ begin return new;end $$;",restoreFunction],
    ["update blizhniy_meta.migrations set sha256=repeat('0',64) where name='0001-identity.sql'",`update blizhniy_meta.migrations set sha256='${originalHash}' where name='0001-identity.sql'`],
   ];
   for(const [change,restore] of changes) {
    await admin.query(change);
    try {await assert.rejects(check(),{message:'Payment reconciliation database preflight failed'});}
    finally {await admin.query(restore);}
    await check();
   }
  });
  await suite.test('worker role can lock but not update identity/reference rows; credentials, role changes, new payments, DDL and queue admission are denied',async()=>{
   const owner=randomUUID(),id=randomUUID(),intentId=randomUUID(),providerId=randomUUID();
   await admin.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',[owner,`restricted-${owner}@example.invalid`,`scrypt$131072$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`]);
   const refs=(await admin.query(`insert into app.listings(id,author_id,listing_type,category_id,city_id,title,description,contact_phone)
    select $1,$2,'sell',c.id,city.id,'Синтетическая проверка роли','Полное исполнение через отдельную роль','+79990000000'
    from app.categories c cross join app.cities city where c.slug='otdyh' and city.name='Краснодар' returning category_id,city_id`,[id,owner])).rows[0];
   const moderation=(await admin.query("insert into app.listing_moderation(listing_id,revision,state,decided_at) values($1,1,'approved',clock_timestamp()) returning id",[id])).rows[0].id;
   const media=(await admin.query(`insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256)
    values($1,gen_random_uuid(),'image/webp',2,2,12,$2) returning id`,[owner,'f'.repeat(64)])).rows[0].id;
   await admin.query("update app.media_objects set state='ready',ready_at=clock_timestamp() where id=$1",[media]);
   await admin.query('insert into app.listing_photos(listing_id,media_id,position) values($1,$2,0)',[id,media]);
   const b={id:intentId,ownerId:owner,targetType:'listing',targetId:id,targetRevision:'1',tariffId:'listing-publication',amount:'199.99',durationDays:30,shopId:merchant.shopId,isTest:true};
   await ownerDb.transaction(async tx=>{
    await journal.persistInTransaction(tx,{...b,requestBody:JSON.stringify({amount:{value:b.amount,currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://site.example.invalid/return'},metadata:{localPaymentId:b.id,targetId:id,targetType:'listing',tariffId:b.tariffId}})});
    await tx.query("insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,'listing',$4,1)",[intentId,owner,randomUUID(),id]);
   });
   await journal.authorize(b);await journal.bindProvider(b,providerId);
   for(const [table,key] of [['users',owner],['payment_checkout_intents',intentId],['categories',refs.category_id],['cities',refs.city_id],['media_objects',media],['listing_moderation',moderation]]) {
    assert.equal((await db.transaction(tx=>tx.query(`select id from app.${table} where id=$1 for update`,[key]))).rowCount,1);
    await assert.rejects(db.query(`update app.${table} set id=gen_random_uuid() where id=$1`,[key]),{code:'23514'});
    assert.equal((await admin.query(`select id from app.${table} where id=$1`,[key])).rowCount,1);
   }
   for(const sql of ['select email,password_hash from app.users limit 0',"update app.users set role='admin' where false",
    'select * from app.sessions limit 0',"update app.categories set name='changed' where false",'insert into app.payment_orders(id) values(gen_random_uuid())',
    "update app.payment_checkout_intents set amount=1 where false",'insert into app.payment_reconciliation_jobs(intent_id) values(gen_random_uuid())',
    'alter table app.users disable trigger reconciliation_lock_only','create table app.reconciliation_forbidden(id integer)',
    'delete from app.payment_fulfillments where false',"set session_replication_role='replica'"])
    await assert.rejects(db.query(sql),{code:'42501'});
   assert.equal(await new PostgresPaymentReconciliationQueue(ownerDb,merchant).enqueue(providerId),true);
   fixture={b,providerId};
  });
  await suite.test('real restricted role composes read-only service check, pending GET retry, captured verification and once-only publication with a ready photo',async()=>{
   assert.ok(fixture);const {b,providerId}=fixture;let status='pending',capturedAt=null,gets=0,closed=0;
   const events=[],controller=new AbortController();
   const fetcher=async(url,init)=>{gets++;assert.equal(init.method,'GET');assert.equal(url,`https://api.yookassa.ru/v3/payments/${providerId}`);
    return Response.json({id:providerId,status,paid:status==='succeeded',test:true,amount:{value:b.amount,currency:'RUB'},recipient:{account_id:merchant.shopId},
     metadata:{localPaymentId:b.id,targetId:b.targetId,targetType:'listing',tariffId:b.tariffId},...(capturedAt?{captured_at:capturedAt}:{})});};
   const worker=createPaymentReconciliationWorker(db,merchant,fetcher);
   const createRuntime=async()=>{
    const serviceDb=new PostgresDatabase(new pg.Pool({...config,user:role,password,max:2,options:'-c search_path=pg_catalog,public',statement_timeout:8000}));
    return{preflight:()=>verifyPaymentReconciliationDatabase(serviceDb,{database:config.database}),
     worker:createPaymentReconciliationWorker(serviceDb,merchant,fetcher),close:async()=>{closed++;await serviceDb.close();}};
   };
   assert.equal(await runPaymentReconciliationService({mode:'check',signal:controller.signal,report:async event=>events.push(event),
    createRuntime}),0);
   assert.equal(gets,0);assert.equal(closed,1);
   assert.equal((await admin.query('select attempts from app.payment_reconciliation_jobs where intent_id=$1',[b.id])).rows[0].attempts,0);
   assert.equal(await runPaymentReconciliationService({mode:'run',signal:controller.signal,createRuntime,report:async event=>{
    events.push(event);
    if(event.status==='tick'&&event.state==='deferred'){
     assert.equal(event.code,'provider_pending');
     await admin.query("update app.payment_reconciliation_jobs set next_attempt_at=clock_timestamp()-interval '1 second' where intent_id=$1",[b.id]);
     status='succeeded';capturedAt=(await admin.query(`select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as value`)).rows[0].value;
    }else if(event.status==='tick'&&event.state==='completed')controller.abort();
   }}),0);assert.equal(gets,2);assert.equal(closed,2);
   assert.deepEqual(events.at(-1).outcomes,{deferred:1,completed:1});
   assert.deepEqual((await admin.query('select status,is_paid from app.listings where id=$1',[b.targetId])).rows[0],{status:'published',is_paid:true});
   const receipt=(await admin.query('select to_jsonb(f) as value from app.payment_fulfillments f where intent_id=$1',[b.id])).rows;
   assert.equal(receipt.length,1);assert.deepEqual(await worker.tick(),{state:'idle'});assert.equal(gets,2);
   assert.deepEqual((await admin.query('select to_jsonb(f) as value from app.payment_fulfillments f where intent_id=$1',[b.id])).rows,receipt);
   assert.equal(events.at(-1).status,'stopped');await check();
  });
  await suite.test('lock-only guards leave the ordinary HTTP runtime credential update and auth-version invalidation intact',async()=>{
   const appDb=new PostgresDatabase(new pg.Pool({...config,...credentials,max:1}));
   const rollback=new Error('Owned auth-regression fixture rollback');let version;
   try {
    await assert.rejects(appDb.transaction(async tx=>{
     const hash=`scrypt$131072$8$1$${'c'.repeat(32)}$${'d'.repeat(128)}`;
     const {id}=(await tx.query('insert into app.users(email,password_hash) values($1,$2) returning id',[`lock-regression-${randomUUID()}@example.invalid`,hash])).rows[0];
     const replacement=`scrypt$131072$8$1$${'e'.repeat(32)}$${'f'.repeat(128)}`;
     await tx.query('update app.users set password_hash=$2 where id=$1',[id,replacement]);
     version=(await tx.query('select auth_version::text as value from app.users where id=$1',[id])).rows[0].value;
     throw rollback;
    }),error=>error===rollback);
    assert.equal(version,'1');
   }finally {await appDb.close();}
  });
  await suite.test('down refuses live lock grants; revocation permits guard-only rollback and reapply without changing financial history',async()=>{
   try {await assert.rejects(admin.query(down),/Revoke reconciliation lock grants/);}finally {await admin.query('rollback');}
   const receipts=(await admin.query('select to_jsonb(f) as value from app.payment_fulfillments f order by intent_id')).rows;
   for(const table of ['users','payment_checkout_intents','categories','cities','media_objects','listing_moderation'])await admin.query(`revoke update(id) on app.${table} from ${role}`);
   await admin.query(down);await admin.query("delete from blizhniy_meta.migrations where name='0024-reconciliation-lock-guards.sql'");
   await assert.rejects(check(),{message:'Payment reconciliation database preflight failed'});
   assert.equal((await bootstrapPostgres(admin,target,options)).applied,1);
   for(const sql of plan.grants)await admin.query(sql);await check();
   assert.deepEqual((await admin.query('select to_jsonb(f) as value from app.payment_fulfillments f order by intent_id')).rows,receipts);
  });
 }finally {try {await db.close();await ownerDb.close();}finally {if(artifactDirectory)rmSync(artifactDirectory,{recursive:true,force:true});}}
}
