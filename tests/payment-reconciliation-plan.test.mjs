import assert from 'node:assert/strict';import {test} from 'node:test';
import {getBootstrapPlan} from '../scripts/bootstrap-postgres.mjs';
import {getHostedRefundMigrationPlan,getHostedRefundMigrationSql} from '../scripts/publication-test-release-plan.mjs';
import {getHostedRefundReleasePlan,getHostedRefundUpgradeSql,getUndeliveredResponseCompensationMigration} from '../scripts/publication-test-release-plan.mjs';
test('payment reconciliation queue is additive and opt-in, preserves all prior migrations and grants nothing',()=>{
 const before=getBootstrapPlan({includePaymentFulfillment:true}),plan=getBootstrapPlan({includePaymentReconciliation:true});
 assert.equal(before.length,22);assert.equal(plan.length,23);assert.deepEqual(plan.slice(0,22),before);
 assert.equal(plan.at(-1).name,'0023-payment-reconciliation.sql');assert.match(plan.at(-1).sql,/revoke all on app\.payment_reconciliation_jobs from public/);
 assert.doesNotMatch(plan.at(-1).sql,/grant|security definer|delete from|truncate/i);
 assert.throws(()=>getBootstrapPlan({includePaymentReconciliation:'true'}),/Invalid/);
});

test('the undelivered response upgrade pins a new journal entry and preserves the reviewed refund package',()=>{
 const previous=getHostedRefundReleasePlan(),current=getHostedRefundReleasePlan(76),migration=getUndeliveredResponseCompensationMigration();
 assert.deepEqual(current.slice(0,-1),previous);
 assert.deepEqual(current.at(-1),migration);
 const upgrade=getHostedRefundUpgradeSql();
 assert.equal([...upgrade.matchAll(/^begin;$/gm)].length,1);
 assert.equal([...upgrade.matchAll(/^commit;$/gm)].length,1);
 assert.ok(upgrade.includes("('"+migration.name+"','"+migration.sha256+"')"));
 assert.doesNotMatch(upgrade,/create table app\.payment_refund_reservations/);
});

test('the hosted refund package restores cancellation and records its pinned migrations in one transaction',()=>{
 const plan=getHostedRefundMigrationPlan(),sql=getHostedRefundMigrationSql();
 assert.equal(plan.length,20);
 assert.equal(plan[0].name,'0035-application-contact-views.sql');
 assert.equal(plan.at(-2).name,'0057-service-payment-terms.sql');
 assert.equal(plan.at(-1).name,'0075-hosted-refund-compatibility.sql');
 assert.equal(new Set(plan.map(row=>row.name)).size,plan.length);
 assert.doesNotMatch(plan.map(row=>row.name).join(' '),/0041-|0046-|0047-|0071-/);
 assert.equal([...sql.matchAll(/^begin;$/gm)].length,1);
 assert.equal([...sql.matchAll(/^commit;$/gm)].length,1);
 assert.ok(sql.indexOf('lock table blizhniy_meta.migrations')<sql.indexOf('create table app.payment_refund_reservations'));
 assert.ok(sql.lastIndexOf('checkout_cancellation_admitted(purchase)')>sql.indexOf('create table app.service_payment_terms'));
 assert.ok(sql.lastIndexOf('checkout_cancellation_admitted(purchase)')<sql.indexOf('insert into blizhniy_meta.migrations'));
 for(const {name,sha256} of plan)assert.ok(sql.includes("('"+name+"','"+sha256+"')"));
});
