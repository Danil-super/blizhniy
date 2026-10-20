import assert from 'node:assert/strict';import {test} from 'node:test';
import {getBootstrapPlan} from '../scripts/bootstrap-postgres.mjs';
test('payment reconciliation queue is additive and opt-in, preserves all prior migrations and grants nothing',()=>{
 const before=getBootstrapPlan({includePaymentFulfillment:true}),plan=getBootstrapPlan({includePaymentReconciliation:true});
 assert.equal(before.length,22);assert.equal(plan.length,23);assert.deepEqual(plan.slice(0,22),before);
 assert.equal(plan.at(-1).name,'0023-payment-reconciliation.sql');assert.match(plan.at(-1).sql,/revoke all on app\.payment_reconciliation_jobs from public/);
 assert.doesNotMatch(plan.at(-1).sql,/grant|security definer|delete from|truncate/i);
 assert.throws(()=>getBootstrapPlan({includePaymentReconciliation:'true'}),/Invalid/);
});
