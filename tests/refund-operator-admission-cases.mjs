import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,symlinkSync,readFileSync} from 'node:fs';
import {randomBytes,createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import pg from 'pg';
import {buildPaymentWorker} from '../scripts/build-payment-worker.mjs';
import {buildRefundWorker} from '../scripts/build-refund-worker.mjs';
import {getRefundWorkerRolePlan,verifyRefundWorkerDatabase} from '../scripts/refund-worker-role.mjs';
import {verifyPaymentReconciliationDatabase} from '../scripts/payment-reconciliation-role.mjs';
import {readRefundSchema} from '../scripts/refund-worker-schema.mjs';

export async function testRefundOperatorAdmission(suite,{admin,db,refundDb,load,merchant,check}){
 await suite.test('schema55 fingerprint matches independent full replay under another owner without changing the schema54 baseline',async()=>{
  await admin.query('create role operator_schema_owner nologin');await admin.query('create database operator_schema_reference owner operator_schema_owner');
  const reference=new pg.Client({...admin.options,user:admin.options.user,password:admin.options.password,database:'operator_schema_reference'});
  try{
   await reference.connect();await reference.query('set role operator_schema_owner');
   for(const {name,sha256}of getRefundWorkerRolePlan('blizhniy_test',{schema:55}).journal){
    const source=readFileSync(new URL('../database/migrations/'+name,import.meta.url));assert.equal(createHash('sha256').update(source).digest('hex'),sha256);await reference.query(source.toString());
   }
   await reference.query('begin read only');const fingerprint=await readRefundSchema(reference);await reference.query('commit');
   assert.deepEqual(fingerprint,JSON.parse(readFileSync(new URL('../database/refund-schema-0055.json',import.meta.url),'utf8')));
   assert.deepEqual(await db.transaction(readRefundSchema,{readOnly:true}),fingerprint);
  }finally{await reference.end();await admin.query('drop database operator_schema_reference');await admin.query('drop role operator_schema_owner');}
 });
 const owned=mkdtempSync(join(tmpdir(),'blizhniy-operator55-admission-')),password=randomBytes(24).toString('hex');
 let paymentDb;
 try{
  const payment=join(owned,'payment'),refund=join(owned,'refund');buildPaymentWorker(payment,{schema:55});buildRefundWorker(refund,{schema:55});
  for(const target of [payment,refund])symlinkSync(fileURLToPath(new URL('../node_modules',import.meta.url)),join(target,'node_modules'),'dir');
  const paymentGuard=(await import(pathToFileURL(join(payment,'scripts/payment-reconciliation-role.mjs')).href)).verifyPaymentReconciliationDatabase;
  const refundGuard=(await import(pathToFileURL(join(refund,'scripts/refund-worker-role.mjs')).href)).verifyRefundWorkerDatabase;
  await admin.query(`alter role blizhniy_payment_reconciler password ${pg.escapeLiteral(password)}`);
  paymentDb=new (load('postgres').PostgresDatabase)(new pg.Pool({...admin.options,user:'blizhniy_payment_reconciler',password,max:1}));
  const all=async()=>{await check();for(const guard of [verifyRefundWorkerDatabase,refundGuard])await guard(refundDb,{database:'blizhniy_test',merchant});for(const guard of [verifyPaymentReconciliationDatabase,paymentGuard])await guard(paymentDb,{database:'blizhniy_test'});};
  await suite.test('all three distinct roles and both compiled worker packages admit exact55 without expanding worker grants',async()=>{
   assert.deepEqual(getRefundWorkerRolePlan('blizhniy_test',{schema:55}).grants,getRefundWorkerRolePlan('blizhniy_test').grants);
   await all();
  });
  await suite.test('source and compiled workers reject mismatched54 journal with installed55, unknown56 and changed55 hash',async()=>{
   const row=(await admin.query("select * from blizhniy_meta.migrations where name='0055-refund-operator-locks.sql'")).rows[0];
   for(const [change,restore,args]of [
    ["delete from blizhniy_meta.migrations where name='0055-refund-operator-locks.sql'",'insert into blizhniy_meta.migrations values($1,$2)',[row.name,row.sha256]],
    ["insert into blizhniy_meta.migrations values('0056-unknown.sql',repeat('0',64))","delete from blizhniy_meta.migrations where name='0056-unknown.sql'"],
    ["update blizhniy_meta.migrations set sha256=repeat('0',64) where name='0055-refund-operator-locks.sql'",'update blizhniy_meta.migrations set sha256=$2 where name=$1',[row.name,row.sha256]],
   ]){
    await admin.query(change);try{
     await assert.rejects(check());for(const guard of [verifyRefundWorkerDatabase,refundGuard])await assert.rejects(guard(refundDb,{database:'blizhniy_test',merchant}));
     for(const guard of [verifyPaymentReconciliationDatabase,paymentGuard])await assert.rejects(guard(paymentDb,{database:'blizhniy_test'}));
    }finally{await admin.query(restore,args);}await all();
   }
  });
  await suite.test('unchanged55 journal cannot hide removed, disabled or altered operator lock guards from any role',async()=>{
   const body=(await admin.query("select pg_get_functiondef('app.guard_refund_operator_locks()'::regprocedure) as sql")).rows[0].sql;
   for(const [change,restore]of [
    ['drop trigger refund_operator_lock_only on app.users;drop trigger refund_operator_lock_only on app.payment_checkout_intents;drop trigger refund_operator_lock_only on app.payment_orders;drop function app.guard_refund_operator_locks()',readFileSync(new URL('../database/migrations/0055-refund-operator-locks.sql',import.meta.url),'utf8')],
    ['alter table app.users disable trigger refund_operator_lock_only','alter table app.users enable always trigger refund_operator_lock_only'],
    ["create or replace function app.guard_refund_operator_locks() returns trigger language plpgsql set search_path='' as $$begin return new;end$$",body],
    ['alter function app.guard_refund_operator_locks() security definer','alter function app.guard_refund_operator_locks() security invoker'],
    ['drop trigger refund_operator_lock_only on app.payment_orders;create trigger refund_operator_lock_only before update of status on app.payment_orders for each row execute function app.guard_refund_operator_locks();alter table app.payment_orders enable always trigger refund_operator_lock_only',
     'drop trigger refund_operator_lock_only on app.payment_orders;create trigger refund_operator_lock_only before update of id on app.payment_orders for each row execute function app.guard_refund_operator_locks();alter table app.payment_orders enable always trigger refund_operator_lock_only'],
   ]){
    await admin.query(change);try{
     await assert.rejects(check());for(const guard of [verifyRefundWorkerDatabase,refundGuard])await assert.rejects(guard(refundDb,{database:'blizhniy_test',merchant}));
     for(const guard of [verifyPaymentReconciliationDatabase,paymentGuard])await assert.rejects(guard(paymentDb,{database:'blizhniy_test'}));
    }finally{await admin.query(restore);}await all();
   }
  });
  await suite.test('operator admission rejects missing session access, excess authority, memberships and system escalation',async()=>{
   await admin.query('create role operator_membership_probe nologin');
   const changes=[
    ["revoke select(last_seen_at) on app.sessions from blizhniy_refund_operator","grant select(last_seen_at) on app.sessions to blizhniy_refund_operator"],
    ["grant select(password_hash) on app.users to blizhniy_refund_operator","revoke select(password_hash) on app.users from blizhniy_refund_operator"],
    ["grant update(status) on app.payment_orders to blizhniy_refund_operator","revoke update(status) on app.payment_orders from blizhniy_refund_operator"],
    ["grant select(id) on app.users to blizhniy_refund_operator with grant option","revoke grant option for select(id) on app.users from blizhniy_refund_operator"],
    ["grant insert(operation_id) on app.payment_refund_dispatch_anchors to blizhniy_refund_operator","revoke insert(operation_id) on app.payment_refund_dispatch_anchors from blizhniy_refund_operator"],
    ["grant execute on function app.claim_placement_refund_job(text) to blizhniy_refund_operator","revoke execute on function app.claim_placement_refund_job(text) from blizhniy_refund_operator"],
    ["grant blizhniy_refund_operator to operator_membership_probe with admin true,inherit false,set false","revoke blizhniy_refund_operator from operator_membership_probe"],
    ["grant operator_membership_probe to blizhniy_refund_operator","revoke operator_membership_probe from blizhniy_refund_operator"],
    ["grant execute on function pg_catalog.pg_read_binary_file(text) to blizhniy_refund_operator","revoke execute on function pg_catalog.pg_read_binary_file(text) from blizhniy_refund_operator"],
    ["grant select(rolpassword) on pg_catalog.pg_authid to public","revoke select(rolpassword) on pg_catalog.pg_authid from public"],
    ["alter role blizhniy_refund_operator createrole","alter role blizhniy_refund_operator nocreaterole"],
    ["grant create on schema pg_catalog to blizhniy_refund_operator","revoke create on schema pg_catalog from blizhniy_refund_operator"],
    ["grant alter system on parameter shared_preload_libraries to blizhniy_refund_operator","revoke alter system on parameter shared_preload_libraries from blizhniy_refund_operator"],
   ];
   try{for(const [change,restore]of changes){await admin.query(change);try{await assert.rejects(check());}finally{await admin.query(restore);}await check();}}
   finally{await admin.query('drop role operator_membership_probe');}await all();
  });
 }finally{await paymentDb?.close();rmSync(owned,{recursive:true,force:true});}
}
