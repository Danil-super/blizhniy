import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {getRefundWorkerRolePlan,verifyRefundWorkerDatabase} from '../scripts/refund-worker-role.mjs';
import {testRefundSchemaReference,testRefundSchemaDrift} from './refund-worker-schema-cases.mjs';

// Called only by the owned disposable PG18 placement fixture; no environment credentials.
export async function testRefundWorkerRole(suite,{admin,ownerDb,purchase,load,operator,merchant}){
 await admin.query(await readFile(new URL('../database/migrations/0053-application-compensation-lease.sql',import.meta.url),'utf8'));
 await admin.query(await readFile(new URL('../database/migrations/0054-refund-worker-locks.sql',import.meta.url),'utf8'));
 const plan=getRefundWorkerRolePlan('blizhniy_test'),role=plan.role,password=randomBytes(24).toString('hex');
 const {PostgresDatabase}=load('postgres');
 await admin.query(`create schema blizhniy_meta;revoke all on schema blizhniy_meta from public;
  create table blizhniy_meta.migrations(name text primary key,sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'));
  revoke all on blizhniy_meta.migrations from public`);
 for(const {name,sha256} of plan.journal)await admin.query('insert into blizhniy_meta.migrations(name,sha256) values($1,$2)',[name,sha256]);
 await admin.query(plan.createRole);await admin.query(`alter role ${role} login password ${pg.escapeLiteral(password)}`);
 const db=new PostgresDatabase(new pg.Pool({...admin.options,user:role,password,max:3}));
 const check=()=>verifyRefundWorkerDatabase(db,{database:'blizhniy_test',merchant});
 try{
  await suite.test('dedicated refund role fails without grants and succeeds only with its complete column and function plan',async()=>{
   await assert.rejects(check(),{message:'Refund worker database preflight failed'});
   for(const sql of plan.grants)await admin.query(sql);
  });
  await suite.test('refund worker lock-only capability cannot even perform a no-op UPDATE on an existing user',async()=>{
   await db.transaction(async tx=>{assert.equal((await tx.query('select id from app.users where id=$1 for update',[operator.id])).rowCount,1);});
   await assert.rejects(db.query('update app.users set id=id where id=$1',[operator.id]),{code:'23514'});
  });
  await suite.test('refund identity guards reject both SET ROLE and SECURITY DEFINER identity writes',async()=>{
   await assert.rejects(ownerDb.transaction(async tx=>{await tx.query(`set local role ${role}`);await tx.query('update app.users set id=id where id=$1',[operator.id]);}),{code:'23514'});
   await admin.query(`create function app.refund_lock_probe(value uuid) returns void language sql security definer set search_path='' as $$update app.users set id=id where id=value$$;
    revoke all on function app.refund_lock_probe(uuid) from public;grant execute on function app.refund_lock_probe(uuid) to ${role}`);
   try{await assert.rejects(db.query('select app.refund_lock_probe($1)',[operator.id]),{code:'23514'});}
   finally{await admin.query('drop function app.refund_lock_probe(uuid)');}
  });
  await suite.test('exact refund role passes read-only preflight; owner, wrong database and SET ROLE sessions fail',async()=>{
   await check();
   await assert.rejects(verifyRefundWorkerDatabase(ownerDb,{database:'blizhniy_test',merchant}));
   await assert.rejects(verifyRefundWorkerDatabase(db,{database:'wrong_database',merchant}));
   const impersonated={transaction:(work,options)=>ownerDb.transaction(async tx=>{await tx.query(`set local role ${role}`);return work(tx);},options)};
   await assert.rejects(verifyRefundWorkerDatabase(impersonated,{database:'blizhniy_test',merchant}));
  });
  await testRefundSchemaReference(suite,admin,db);
  await testRefundSchemaDrift(suite,admin,check);
  await suite.test('refund preflight refuses missing permissions, grant options, extra financial writes, PII and dangerous objects',async()=>{
   await admin.query('create schema pgbackup_refund_probe;create table pgbackup_refund_probe.probe(id integer);create sequence pgbackup_refund_probe.refund_acl_probe;create function pgbackup_refund_probe.refund_acl_probe() returns integer language sql as $$select 1$$;revoke all on function pgbackup_refund_probe.refund_acl_probe() from public');
   const toast=(await admin.query("select reltoastrelid::regclass::text as name from pg_class where oid='app.users'::regclass")).rows[0].name;
   assert.match(toast,/^pg_toast\.pg_toast_[0-9]+$/);
   const changes=[
    [`grant select(email) on app.users to ${role}`,`revoke select(email) on app.users from ${role}`],
    [`grant update(status) on app.payment_orders to ${role}`,`revoke update(status) on app.payment_orders from ${role}`],
    [`grant select(id) on app.users to ${role} with grant option`,`revoke grant option for select(id) on app.users from ${role}`],
    [`revoke select(sha256) on blizhniy_meta.migrations from ${role}`,`grant select(sha256) on blizhniy_meta.migrations to ${role}`],
    [`revoke execute on function app.assert_application_compensation_job_remaining(text,uuid,uuid) from ${role}`,`grant execute on function app.assert_application_compensation_job_remaining(text,uuid,uuid) to ${role}`],
    [`grant execute on function pgbackup_refund_probe.refund_acl_probe() to ${role}`,`revoke execute on function pgbackup_refund_probe.refund_acl_probe() from ${role}`],
    [`grant execute on function app.refund_target_admitted(uuid,uuid) to ${role} with grant option`,`revoke grant option for execute on function app.refund_target_admitted(uuid,uuid) from ${role}`],
    [`grant delete on app.payment_refund_effects to ${role}`,`revoke delete on app.payment_refund_effects from ${role}`],
    [`grant usage on sequence pgbackup_refund_probe.refund_acl_probe to ${role}`,`revoke usage on sequence pgbackup_refund_probe.refund_acl_probe from ${role}`],
    [`grant select(id) on pgbackup_refund_probe.probe to ${role}`,`revoke select(id) on pgbackup_refund_probe.probe from ${role}`],
    [`grant select on ${toast} to ${role}`,`revoke select on ${toast} from ${role}`],
    [`grant create on schema app to ${role}`,`revoke create on schema app from ${role}`],
    [`grant create on schema information_schema to ${role}`,`revoke create on schema information_schema from ${role}`],
    [`grant create on schema pg_catalog to ${role}`,`revoke create on schema pg_catalog from ${role}`],
    [`grant alter system on parameter shared_preload_libraries to ${role}`,`revoke alter system on parameter shared_preload_libraries from ${role}`],
    [`grant set on parameter session_preload_libraries to ${role}`,`revoke set on parameter session_preload_libraries from ${role}`],
    [`grant temp on database blizhniy_test to ${role}`,`revoke temp on database blizhniy_test from ${role}`],
   ];
   try{for(const [change,restore] of changes){await admin.query(change);try{await assert.rejects(check());}finally{await admin.query(restore);}await check();}}
   finally{await admin.query('drop function pgbackup_refund_probe.refund_acl_probe();drop sequence pgbackup_refund_probe.refund_acl_probe;drop schema pgbackup_refund_probe cascade');}
  });
  await suite.test('refund preflight rejects privileged flags and all incoming or outgoing memberships without managed exceptions',async()=>{
   await admin.query('create role refund_membership_probe nologin');
   const changes=[...['superuser','createdb','createrole','inherit','replication','bypassrls'].map(flag=>[`alter role ${role} ${flag}`,`alter role ${role} no${flag}`]),
    [`alter role ${role} connection limit 5`,`alter role ${role} connection limit 4`],
    [`grant refund_membership_probe to ${role}`,`revoke refund_membership_probe from ${role}`],
    [`grant ${role} to refund_membership_probe with admin true,inherit false,set false`,`revoke ${role} from refund_membership_probe`]];
   try{for(const [change,restore] of changes){await admin.query(change);try{await assert.rejects(check());}finally{await admin.query(restore);}await check();}}
   finally{await admin.query('drop role refund_membership_probe');}
  });
  await suite.test('refund preflight rejects built-in file access and catalog column ACL escalation, including PUBLIC grants',async()=>{
   for(const [change,restore] of [
    [`grant execute on function pg_catalog.pg_read_binary_file(text) to ${role}`,`revoke execute on function pg_catalog.pg_read_binary_file(text) from ${role}`],
    ['grant execute on function pg_catalog.pg_read_binary_file(text) to public','revoke execute on function pg_catalog.pg_read_binary_file(text) from public'],
    [`grant select(rolpassword) on pg_catalog.pg_authid to ${role}`,`revoke select(rolpassword) on pg_catalog.pg_authid from ${role}`],
    ['grant select(rolpassword) on pg_catalog.pg_authid to public','revoke select(rolpassword) on pg_catalog.pg_authid from public'],
    [`grant update on information_schema.schemata to ${role}`,`revoke update on information_schema.schemata from ${role}`],
    [`grant select on information_schema._pg_foreign_servers to ${role}`,`revoke select on information_schema._pg_foreign_servers from ${role}`],
   ]){await admin.query(change);try{await assert.rejects(check());}finally{await admin.query(restore);}await check();}
  });
  await suite.test('refund preflight rejects unknown migration, changed hash and disabled or altered lock guards',async()=>{
   const hash=plan.journal[0].sha256,body=(await admin.query("select prosrc from pg_proc where oid='app.guard_refund_worker_locks()'::regprocedure")).rows[0].prosrc;
   const changes=[
    ["insert into blizhniy_meta.migrations values('0055-unknown.sql',repeat('0',64))","delete from blizhniy_meta.migrations where name='0055-unknown.sql'"],
    ["update blizhniy_meta.migrations set sha256=repeat('0',64) where name='0001-identity.sql'",`update blizhniy_meta.migrations set sha256='${hash}' where name='0001-identity.sql'`],
    ...['users','payment_checkout_intents','payment_orders'].map(table=>[`alter table app.${table} disable trigger refund_worker_lock_only`,`alter table app.${table} enable always trigger refund_worker_lock_only`]),
    ['alter function app.guard_refund_worker_locks() security definer','alter function app.guard_refund_worker_locks() security invoker'],
    ["alter function app.guard_refund_worker_locks() set search_path=public", "alter function app.guard_refund_worker_locks() set search_path=''"],
    ["create or replace function app.guard_refund_worker_locks() returns trigger language plpgsql set search_path='' as $$begin return new;end$$",`create or replace function app.guard_refund_worker_locks() returns trigger language plpgsql set search_path='' as ${pg.escapeLiteral(body)}`],
    ['drop trigger refund_worker_lock_only on app.payment_orders;create trigger refund_worker_lock_only before update of status on app.payment_orders for each row execute function app.guard_refund_worker_locks();alter table app.payment_orders enable always trigger refund_worker_lock_only',
     'drop trigger refund_worker_lock_only on app.payment_orders;create trigger refund_worker_lock_only before update of id on app.payment_orders for each row execute function app.guard_refund_worker_locks();alter table app.payment_orders enable always trigger refund_worker_lock_only'],
   ];
   for(const [change,restore] of changes){await admin.query(change);try{await assert.rejects(check());}finally{await admin.query(restore);}await check();}
  });
  await suite.test('refund role cannot read sessions or profiles, approve refunds, set financial outcomes or bypass triggers',async()=>{
   for(const sql of ['select email from app.users','select token_hash from app.sessions','select * from app.cabinet_profiles',
    "update app.payment_orders set status='refunded' where false",'delete from app.payment_refund_effects where false',
    'insert into app.payment_refund_approvals default values',"set session_replication_role='replica'",'select * from app.placement_refund_jobs',
    'select * from app.application_compensation_jobs'])await assert.rejects(db.query(sql),{code:'42501'});
  });
  await suite.test('dedicated refund role completes every placement type with one effect and notification while identity updates stay forbidden',async()=>{
   for(const kind of ['listing','vacancy','workRequest']){
    const shop={...merchant,shopId:'refund-role-'+randomBytes(6).toString('hex')},item=await purchase({kind,scope:shop});
    const approval=await new (load('postgres-refund-approvals').PostgresRefundApprovalStore)(ownerDb,shop).approve(operator.token,operator.id,{id:randomUUID(),paymentIntentId:item.id,reason:'Возврат для проверки выделенной роли.'});
    if(kind==='listing')await new (load('postgres-listing-payment-fulfillment').PostgresListingPaymentFulfillmentStore)(ownerDb,shop,{postmoderation:true}).fulfill(item.id);
    const remote=provider(item,approval.id,shop),worker=load('placement-refund-worker').createPlacementRefundWorker(db,shop,remote.fetcher);
    await check();assert.deepEqual(await worker.tick(),{state:'completed'});
    assert.equal((await admin.query('select count(*)::int as n from app.payment_refund_effects where operation_id=$1',[approval.id])).rows[0].n,1);
    assert.equal((await admin.query('select count(*)::int as n from app.notifications where event_key=$1',['placement_refund:'+item.id])).rows[0].n,1);
    assert.equal((await admin.query('select status from app.payment_orders where id=$1',[item.id])).rows[0].status,'refunded');
    assert.equal(remote.posts(),1);assert.deepEqual(await worker.tick(),{state:'idle'});assert.equal(remote.posts(),1);
    for(const table of ['payment_checkout_intents','payment_orders']){
     await db.transaction(async tx=>{assert.equal((await tx.query(`select id from app.${table} where id=$1 for update`,[item.id])).rowCount,1);});
     await assert.rejects(db.query(`update app.${table} set id=id where id=$1`,[item.id]),{code:'23514'});
     await assert.rejects(db.query(`update app.${table} set id=$2 where id=$1`,[item.id,randomUUID()]),{code:'23514'});
    }
   }
  });
  await suite.test('dedicated refund role discovers and compensates one unread paid response without contact or publication write grants',async()=>{
   const shop={...merchant,shopId:'response-role-'+randomBytes(6).toString('hex')},work=await purchase({kind:'workRequest',scope:shop});
   const application=(await admin.query("insert into app.applications(applicant_id,work_publication_id,creation_key,target_revision,specialist_revision,snapshot,is_paid,status,created_at,sent_at) values($1,$2,$3,1,1,'{}',true,'sent',clock_timestamp()-interval '7 days',clock_timestamp()-interval '6 days') returning id",[operator.id,work.targetId,randomUUID()])).rows[0].id;
   const id=randomUUID(),item={id,ownerId:operator.id,targetType:'application',targetId:application,targetRevision:'1',tariffId:'job-response',amount:'99.00',durationDays:null,shopId:shop.shopId,isTest:true,providerPaymentId:randomUUID(),capturedAt:new Date(Date.now()-6*86400000-1000).toISOString()};
   item.metadata={localPaymentId:id,targetId:application,targetType:'application',tariffId:'job-response'};
   const requestBody=JSON.stringify({amount:{value:item.amount,currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://fixture.example.invalid/return'},metadata:item.metadata});
   await ownerDb.transaction(async tx=>{
    const {providerPaymentId,capturedAt,metadata,...binding}=item;assert.ok(providerPaymentId&&capturedAt&&metadata);
    await new (load('postgres-payment-intents').PostgresPaymentIntentStore)(ownerDb).persistInTransaction(tx,{...binding,requestBody});
    await tx.query("insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,'application',$4,1)",[id,item.ownerId,randomUUID(),application]);
    await tx.query('insert into app.payment_dispatch_anchors(intent_id) values($1)',[id]);await tx.query('insert into app.payment_provider_links(intent_id,provider_payment_id) values($1,$2)',[id,item.providerPaymentId]);
    await tx.query("update app.payment_orders set status='succeeded' where id=$1",[id]);await tx.query("insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,'succeeded',$3)",[id,item.providerPaymentId,item.capturedAt]);
   });
   const remote=provider(item,id,shop),worker=load('application-compensation-worker').createApplicationCompensationWorker(db,shop,remote.fetcher);
   // The bounded global cursor may visit earlier synthetic sources before this one.
   const discovery=new (load('postgres-application-compensation-discovery').PostgresApplicationCompensationDiscovery)(db,shop);
   for(let page=0;page<100;page++){
    await discovery.scan(25);
    if((await admin.query('select count(*)::int as n from app.application_compensation_cases where payment_intent_id=$1',[id])).rows[0].n===1)break;
   }
   assert.deepEqual(await worker.tick(),{state:'completed'});
   assert.equal((await admin.query('select count(*)::int as n from app.application_compensation_refunds where payment_intent_id=$1',[id])).rows[0].n,1);
   assert.equal((await admin.query('select status from app.payment_orders where id=$1',[id])).rows[0].status,'refunded');
   assert.equal((await admin.query('select status,is_paid from app.applications where id=$1',[application])).rows[0].status,'sent');
   assert.equal(remote.posts(),1);assert.deepEqual(await worker.tick(),{state:'idle'});assert.equal(remote.posts(),1);await check();
  });
 }finally{await db.close();}
}

function provider(item,operationId,shop){
 let posts=0;const refundId=randomUUID(),refund={id:refundId,payment_id:item.providerPaymentId,amount:{value:item.amount,currency:'RUB'},status:'succeeded',created_at:new Date().toISOString(),metadata:{localRefundId:operationId,localPaymentId:item.id}};
 return{posts:()=>posts,fetcher:async(url,init)=>{
  assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');
  if(init.method==='POST'){
   assert.equal(String(url),'https://api.yookassa.ru/v3/refunds');assert.equal(init.headers['Idempotence-Key'],'refund-'+operationId);
   assert.deepEqual(JSON.parse(init.body),{payment_id:item.providerPaymentId,amount:{value:item.amount,currency:'RUB'},metadata:{localRefundId:operationId,localPaymentId:item.id}});
   posts++;return Response.json(refund);
  }
  assert.equal(init.method,'GET');
  if(String(url)==='https://api.yookassa.ru/v3/payments/'+item.providerPaymentId)return Response.json({id:item.providerPaymentId,amount:{value:item.amount,currency:'RUB'},status:'succeeded',paid:true,test:true,refundable:true,captured_at:item.capturedAt,recipient:{account_id:shop.shopId},metadata:item.metadata});
  if(String(url)==='https://api.yookassa.ru/v3/refunds?payment_id='+item.providerPaymentId+'&limit=100')return Response.json({type:'list',items:[]});
  assert.equal(String(url),'https://api.yookassa.ru/v3/refunds/'+refundId);return Response.json(refund);
 }};
}
