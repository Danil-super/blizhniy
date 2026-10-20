import assert from 'node:assert/strict';import {test} from 'node:test';
import {PostgresPaymentReconciliationQueue} from '../src/lib/postgres-payment-reconciliation.ts';
test('queue rejects malformed merchant and IDs before database access',async()=>{
 let calls=0;const db={transaction:async()=>{calls++;assert.fail();}};
 for(const config of [null,{}, {shopId:'bad shop',isTest:true},{shopId:'fixture',isTest:'test'}])assert.throws(()=>new PostgresPaymentReconciliationQueue(db,config));
 const queue=new PostgresPaymentReconciliationQueue(db,{shopId:'fixture',isTest:true});
 await assert.rejects(queue.enqueue('https://bad.invalid'));await assert.rejects(queue.finish({intentId:'bad',claimId:'bad'},'completed'));
 await assert.rejects(queue.finish({intentId:'11111111-1111-4111-8111-111111111111',claimId:'22222222-2222-4222-8222-222222222222'},'retry','private-sql-password'));assert.equal(calls,0);
});
