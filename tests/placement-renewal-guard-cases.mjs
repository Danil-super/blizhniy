import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {getRefundOperatorRolePlan,verifyRefundOperatorDatabase} from '../scripts/refund-operator-role.mjs';
import {getRefundWorkerRolePlan,verifyRefundWorkerDatabase} from '../scripts/refund-worker-role.mjs';
import {assertRefundSchema} from '../scripts/refund-worker-schema.mjs';
import {verifyLocalPrimarySchema} from '../scripts/local-primary-fixture.mjs';

// Only a second database in the caller's disposable container; never the permanent stand.
export async function testPlacementRenewalGuards(suite,{admin,config,load}){
 await admin.query('begin read only');try{await assertRefundSchema(admin,56);await assert.rejects(assertRefundSchema(admin,55));}finally{await admin.query('rollback');}
 await admin.query('create database blizhniy_prod');const local=new pg.Pool({...config,database:'blizhniy_prod',max:3}),databases=[];
 const operator=getRefundOperatorRolePlan('blizhniy_prod',{schema:56}),worker=getRefundWorkerRolePlan('blizhniy_prod',{schema:56}),merchant={shopId:'renewal-fixture',isTest:true};
 const state={database:'blizhniy_prod',dbPort:config.port,ownerPassword:config.password,origin:'https://127.0.0.1:3045'};
 const old=process.env.BLIZHNIY_PLACEMENT_RENEWALS;
 try{
  for(const {name} of operator.journal)await local.query(await readFile(new URL('../database/migrations/'+name,import.meta.url),'utf8'));
  await local.query("create schema blizhniy_meta;create table blizhniy_meta.migrations(name text primary key,sha256 text not null);revoke all on database blizhniy_prod from public;revoke create on schema public from public;revoke all on schema blizhniy_meta from public;revoke all on blizhniy_meta.migrations from public");
  for(const {name,sha256} of operator.journal)await local.query('insert into blizhniy_meta.migrations(name,sha256) values($1,$2)',[name,sha256]);
  await local.query(await readFile(new URL('../database/local-primary-payment.sql',import.meta.url),'utf8'));await local.query(await readFile(new URL('../database/permissions/telegram-phone.sql',import.meta.url),'utf8'));
  const checks=[];
  for(const [plan,verify] of [[operator,verifyRefundOperatorDatabase],[worker,verifyRefundWorkerDatabase]]){
   await local.query(plan.createRole);await local.query(`alter role ${plan.role} login password ${pg.escapeLiteral(config.password)}`);for(const sql of plan.grants)await local.query(sql);
   const db=new(load('postgres').PostgresDatabase)(new pg.Pool({...config,database:'blizhniy_prod',user:plan.role,max:2}));databases.push(db);checks.push(()=>verify(db,{database:'blizhniy_prod',merchant,localPrimary:true}));
  }
  const check=async()=>{await verifyLocalPrimarySchema(state);for(const fn of checks)await fn();};
  await suite.test('full local56 requires opt-in and exact role grants without expanding either role',async()=>{
   delete process.env.BLIZHNIY_PLACEMENT_RENEWALS;await assert.rejects(verifyLocalPrimarySchema(state));
   process.env.BLIZHNIY_PLACEMENT_RENEWALS='local-v1';await check();
   assert.deepEqual(operator.grants,getRefundOperatorRolePlan('blizhniy_prod').grants);assert.deepEqual(worker.grants,getRefundWorkerRolePlan('blizhniy_prod',{schema:55}).grants);
   await assert.rejects(verifyRefundOperatorDatabase(databases[0],{database:'blizhniy_prod',merchant}));await assert.rejects(verifyRefundWorkerDatabase(databases[1],{database:'blizhniy_prod',merchant}));
   for(const db of databases)await assert.rejects(db.query('select * from app.payment_renewals'),{code:'42501'});
  });
  for(const [name,change,undo] of [
   ['unknown57',"insert into blizhniy_meta.migrations values('0057-synthetic.sql',repeat('a',64))","delete from blizhniy_meta.migrations where name='0057-synthetic.sql'"],
   ['altered renewal hash',"update blizhniy_meta.migrations set sha256=repeat('a',64) where name='0056-placement-renewals.sql'",['update blizhniy_meta.migrations set sha256=$1 where name=$2',[operator.journal.at(-1).sha256,operator.journal.at(-1).name]]],
   ['disabled renewal protection','alter table app.payment_renewals disable trigger payment_renewal_guard','alter table app.payment_renewals enable trigger payment_renewal_guard'],
   ['extra operator authority','grant update(status) on app.payment_orders to blizhniy_refund_operator','revoke update(status) on app.payment_orders from blizhniy_refund_operator'],
  ])await suite.test('local56 refuses '+name,async()=>{
   await local.query(change);try{for(const fn of (name==='extra operator authority'?checks.slice(0,1):checks))await assert.rejects(fn());if(name==='extra operator authority')await checks[1]();}finally{if(Array.isArray(undo))await local.query(...undo);else await local.query(undo);}await check();
  });
 }finally{if(old===undefined)delete process.env.BLIZHNIY_PLACEMENT_RENEWALS;else process.env.BLIZHNIY_PLACEMENT_RENEWALS=old;for(const db of databases)await db.close();await local.end();}
}
