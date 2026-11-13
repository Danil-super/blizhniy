import assert from 'node:assert/strict';
import {test} from 'node:test';
import {getRefundOperatorRolePlan,verifyRefundOperatorDatabase} from '../scripts/refund-operator-role.mjs';
import {getRefundWorkerRolePlan} from '../scripts/refund-worker-role.mjs';

test('refund operator plan is separate from sending, scope-limited and retains the original54 migration hashes',()=>{
 const plan=getRefundOperatorRolePlan('blizhniy_test');
 assert.equal(plan.role,'blizhniy_refund_operator');assert.equal(plan.journal.length,55);
 assert.deepEqual(plan.journal.slice(0,54),getRefundWorkerRolePlan('blizhniy_test').journal);
 assert.deepEqual(getRefundWorkerRolePlan('blizhniy_test',{schema:55}).grants,getRefundWorkerRolePlan('blizhniy_test').grants);
 for(const schema of [53,58,'55',null])assert.throws(()=>getRefundWorkerRolePlan('blizhniy_test',{schema}));
 assert.equal(plan.journal.at(-1).name,'0055-refund-operator-locks.sql');
 assert.match(plan.createRole,/nologin.*nosuperuser.*nocreatedb.*nocreaterole.*noinherit.*noreplication.*nobypassrls.*connection limit 4/);
 for(const sql of plan.grants){assert.match(sql,/^grant /);assert.match(sql,/ to blizhniy_refund_operator$/);assert.equal(/\ball\b|with grant option|blizhniy_runtime/i.test(sql),false);}
 const inserts=plan.grants.filter(sql=>/^grant insert/.test(sql));
 assert.equal(inserts.length,6);
 assert.ok(inserts.every(sql=>!/(reservations|requests|anchors|attempts|candidates|jobs)/.test(sql)));
 assert.deepEqual(plan.grants.filter(sql=>/^grant update/.test(sql)),[
  'grant update(id) on app.users to blizhniy_refund_operator',
  'grant update(last_seen_at) on app.sessions to blizhniy_refund_operator',
  'grant update(id) on app.payment_checkout_intents to blizhniy_refund_operator',
  'grant update(id) on app.payment_orders to blizhniy_refund_operator',
 ]);
 assert.equal(plan.grants.filter(sql=>/^grant execute/.test(sql)).length,2);
 plan.journal[0].sha256='0'.repeat(64);plan.grants.length=0;
 assert.notEqual(getRefundOperatorRolePlan('blizhniy_test').journal[0].sha256,'0'.repeat(64));
 assert.ok(getRefundOperatorRolePlan('blizhniy_test').grants.length>0);
 for(const value of ['',null,'x;drop table app.users','x'.repeat(64)])assert.throws(()=>getRefundOperatorRolePlan(value));
});

test('operator admission rejects invalid TEST scope before I/O and redacts database failures',async()=>{
 let calls=0;const db={transaction:async()=>{calls++;throw Error('synthetic sensitive driver detail');}};
 for(const input of [{},{database:'blizhniy_test',merchant:{shopId:'fixture',isTest:false}},{database:'blizhniy_test',merchant:{shopId:'bad/shop',isTest:true}}])
  await assert.rejects(verifyRefundOperatorDatabase(db,input),{message:'Refund operator database preflight failed'});
 assert.equal(calls,0);
 await assert.rejects(verifyRefundOperatorDatabase(db,{database:'blizhniy_test',merchant:{shopId:'fixture',isTest:true}}),{message:'Refund operator database preflight failed'});
 assert.equal(calls,1);
});
