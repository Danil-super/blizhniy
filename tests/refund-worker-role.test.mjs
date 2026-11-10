import assert from 'node:assert/strict';
import {test} from 'node:test';
import {getRefundWorkerRolePlan,verifyRefundWorkerDatabase} from '../scripts/refund-worker-role.mjs';

test('refund worker plan is inert, NOLOGIN and pinned to the reviewed migration boundary',()=>{
 const plan=getRefundWorkerRolePlan('blizhniy_test');
 assert.equal(plan.role,'blizhniy_refund_worker');
 assert.match(plan.createRole,/nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls connection limit 4$/);
 assert.equal(plan.journal.length,54);
 assert.equal(plan.journal.at(-1).name,'0054-refund-worker-locks.sql');
 assert.ok(plan.journal.every(row=>/^[a-f0-9]{64}$/.test(row.sha256)));
 assert.ok(plan.grants.every(sql=>/^grant (connect|usage|select\(|insert\(|update\(id\)|execute on function)/.test(sql)));
 assert.equal(plan.grants.some(sql=>/app\.(sessions|profiles|notifications|listings|work_publications)\b/.test(sql)),false);
 assert.equal(plan.grants.some(sql=>/^grant insert.* on app.payment_refund_approvals /.test(sql)),false);
 assert.equal(plan.grants.some(sql=>/refund_recovery/.test(sql)),false);
});

test('refund worker target rejects identifiers before producing SQL',()=>{
 for(const value of [undefined,null,'','a";drop database x;--','a'.repeat(64),{},1])assert.throws(()=>getRefundWorkerRolePlan(value));
 assert.ok(getRefundWorkerRolePlan('fixture-db.v1').grants[0].includes('"fixture-db.v1"'));
});

test('refund worker preflight rejects LIVE or malformed scope before reading the database',async()=>{
 let reads=0;const db={transaction:async()=>{reads++;throw Error('Must not reach DB');}};
 for(const merchant of [{shopId:'fixture',isTest:false},{shopId:'',isTest:true},null])
  await assert.rejects(verifyRefundWorkerDatabase(db,{database:'blizhniy_test',merchant}),/Refund worker database preflight failed/);
 assert.equal(reads,0);
});

test('refund worker preflight requires a read-only transaction and redacts database errors',async()=>{
 let calls=0;
 const db={transaction:async(work,options)=>{calls++;assert.deepEqual(options,{readOnly:true});return work({query:async()=>{throw Error('sensitive database detail');}});}};
 await assert.rejects(verifyRefundWorkerDatabase(db,{database:'blizhniy_test',merchant:{shopId:'fixture',isTest:true}}),{message:'Refund worker database preflight failed'});
 assert.equal(calls,1);
});
