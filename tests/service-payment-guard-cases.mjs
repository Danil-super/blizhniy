import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import pg from 'pg';
import {getRefundOperatorRolePlan,verifyRefundOperatorDatabase} from '../scripts/refund-operator-role.mjs';
import {getRefundWorkerRolePlan,verifyRefundWorkerDatabase} from '../scripts/refund-worker-role.mjs';
import {assertRefundSchema} from '../scripts/refund-worker-schema.mjs';
import {verifyLocalPrimarySchema} from '../scripts/local-primary-fixture.mjs';
export async function testServicePaymentGuards(suite,{admin,config,load}){
 await admin.query('begin read only');try{await assertRefundSchema(admin,57,{localPrimary:true});await assert.rejects(assertRefundSchema(admin,56,{localPrimary:true}));}finally{await admin.query('rollback');}
 await admin.query('create database blizhniy_prod');const local=new pg.Pool({...config,database:'blizhniy_prod',max:3}),databases=[],checks=[];
 const operator=getRefundOperatorRolePlan('blizhniy_prod',{schema:57}),worker=getRefundWorkerRolePlan('blizhniy_prod',{schema:57}),merchant={shopId:'service-fixture',isTest:true};
 const state={database:'blizhniy_prod',dbPort:config.port,ownerPassword:config.password,origin:'https://127.0.0.1:3045'};
 try{
  for(const {name} of operator.journal)await local.query(await readFile(new URL('../database/migrations/'+name,import.meta.url),'utf8'));
  await local.query("create schema blizhniy_meta;create table blizhniy_meta.migrations(name text primary key,sha256 text not null);revoke all on database blizhniy_prod from public;revoke create on schema public from public;revoke all on schema blizhniy_meta from public;revoke all on blizhniy_meta.migrations from public");
  for(const {name,sha256} of operator.journal)await local.query('insert into blizhniy_meta.migrations values($1,$2)',[name,sha256]);
  await local.query(await readFile(new URL('../database/local-primary-payment.sql',import.meta.url),'utf8'));await local.query(await readFile(new URL('../database/permissions/telegram-phone.sql',import.meta.url),'utf8'));
  for(const [plan,verify] of [[operator,verifyRefundOperatorDatabase],[worker,verifyRefundWorkerDatabase]]){
   await local.query(plan.createRole);await local.query(`alter role ${plan.role} login password ${pg.escapeLiteral(config.password)}`);for(const sql of plan.grants)await local.query(sql);
   const db=new(load('postgres').PostgresDatabase)(new pg.Pool({...config,database:'blizhniy_prod',user:plan.role,max:2}));databases.push(db);checks.push(()=>verify(db,{database:'blizhniy_prod',merchant,localPrimary:true}));
  }
  const check=async()=>{await verifyLocalPrimarySchema(state);for(const fn of checks)await fn();};
  await suite.test('full local57 is exact, opt-in and gives neither financial role new privileges',async()=>{
   await check();assert.deepEqual(operator.grants,getRefundOperatorRolePlan('blizhniy_prod').grants);assert.deepEqual(worker.grants,getRefundWorkerRolePlan('blizhniy_prod',{schema:55}).grants);
   const value=process.env.BLIZHNIY_SERVICE_CHECKOUT;delete process.env.BLIZHNIY_SERVICE_CHECKOUT;try{await assert.rejects(verifyLocalPrimarySchema(state));}finally{process.env.BLIZHNIY_SERVICE_CHECKOUT=value;}
   for(const db of databases)await assert.rejects(db.query('select * from app.service_payment_terms'),{code:'42501'});
   await assert.rejects(verifyRefundOperatorDatabase(databases[0],{database:'blizhniy_prod',merchant}));await assert.rejects(verifyRefundWorkerDatabase(databases[1],{database:'blizhniy_prod',merchant}));
  });
  for(const [name,change,undo] of [
   ['unknown58',"insert into blizhniy_meta.migrations values('0058-synthetic.sql',repeat('a',64))","delete from blizhniy_meta.migrations where name='0058-synthetic.sql'"],
   ['wrong57hash',"update blizhniy_meta.migrations set sha256=repeat('0',64) where name='0057-service-payment-terms.sql'",null],
   ['terms-trigger',"alter table app.service_payment_terms disable trigger service_payment_terms_guard","alter table app.service_payment_terms enable trigger service_payment_terms_guard"],
   ['service-window-trigger',"alter table app.payment_fulfillments disable trigger service_payment_fulfillment_guard","alter table app.payment_fulfillments enable trigger service_payment_fulfillment_guard"],
   ['service-edit-trigger',"alter table app.service_publications disable trigger service_checkout_edit_guard","alter table app.service_publications enable trigger service_checkout_edit_guard"],
  ])await suite.test(name+' rejects owned launcher and both roles without silently repairing the schema',async()=>{
   await local.query(change);try{await assert.rejects(verifyLocalPrimarySchema(state));for(const fn of checks)await assert.rejects(fn());}finally{if(undo)await local.query(undo);else await local.query('update blizhniy_meta.migrations set sha256=$1 where name=$2',[operator.journal.at(-1).sha256,operator.journal.at(-1).name]);}await check();
  });
  await suite.test('missing57 and extra financial SELECT cannot be admitted',async()=>{
   await local.query("delete from blizhniy_meta.migrations where name='0057-service-payment-terms.sql'");try{await assert.rejects(check());for(const fn of checks)await assert.rejects(fn());}finally{await local.query('insert into blizhniy_meta.migrations values($1,$2)',[operator.journal.at(-1).name,operator.journal.at(-1).sha256]);}
   for(const [index,role] of [[0,operator.role],[1,worker.role]]){await local.query('grant select(intent_id) on app.service_payment_terms to '+role);try{await assert.rejects(checks[index]());}finally{await local.query('revoke select(intent_id) on app.service_payment_terms from '+role);}}await check();
  });
 }finally{for(const db of databases)await db.close();await local.end();}
}
