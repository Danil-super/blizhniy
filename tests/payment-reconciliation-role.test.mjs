import assert from 'node:assert/strict';
import {test} from 'node:test';
import {getBootstrapPlan} from '../scripts/bootstrap-postgres.mjs';
import {getPaymentReconciliationRolePlan,verifyPaymentReconciliationDatabase} from '../scripts/payment-reconciliation-role.mjs';

test('worker role plan is explicit, column-scoped and cannot change target identifiers or grant financial authority to the HTTP role',()=>{
 const plan=getPaymentReconciliationRolePlan('blizhniy_test');
 assert.equal(plan.role,'blizhniy_payment_reconciler');
 assert.match(plan.createRole,/nologin.*nosuperuser.*nocreatedb.*nocreaterole.*noinherit.*noreplication.*nobypassrls.*connection limit 4/);
 assert.equal(plan.journal.length,24);
 assert.deepEqual(plan.journal.slice(0,23),getBootstrapPlan({includePaymentReconciliation:true}).map(({name,sha256})=>({name,sha256})));
 assert.equal(getBootstrapPlan().length,7);assert.throws(()=>getBootstrapPlan({includePaymentReconciliationRole:'yes'}));
 for(const sql of plan.grants){assert.match(sql,/^grant /);assert.match(sql,/ to blizhniy_payment_reconciler$/);assert.equal(/\ball\b|with grant option|blizhniy_runtime/i.test(sql),false);}
 assert.equal(plan.grants.some(sql=>/^grant insert/.test(sql)&&sql.includes('payment_reconciliation_jobs')),false);
 assert.equal(plan.grants.some(sql=>sql.includes('select(id,is_blocked,email_verified_at) on app.users')),true);
 plan.grants.push('synthetic alteration');plan.journal[0].sha256='0'.repeat(64);
 assert.equal(getPaymentReconciliationRolePlan('blizhniy_test').grants.includes('synthetic alteration'),false);
 assert.notEqual(getPaymentReconciliationRolePlan('blizhniy_test').journal[0].sha256,'0'.repeat(64));
 for(const target of ['',null,'other;drop table app.users','a'.repeat(64)])assert.throws(()=>getPaymentReconciliationRolePlan(target));
});

test('preflight fails before I/O on a missing target and never exposes a raw database error',async()=>{
 let transactions=0;
 const db={transaction:async()=>{transactions++;throw Error('synthetic-password recipient@example.invalid');}};
 await assert.rejects(verifyPaymentReconciliationDatabase(db,{}),{message:'Payment reconciliation database preflight failed'});
 assert.equal(transactions,0);
 await assert.rejects(verifyPaymentReconciliationDatabase(db,{database:'blizhniy_test'}),{message:'Payment reconciliation database preflight failed'});
 assert.equal(transactions,1);
});
