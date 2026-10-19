import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mergePaymentVerification,PaymentVerificationError} from '../src/lib/payment-verification-contract.ts';
const state=(status,capturedAt=null)=>({status,capturedAt});
const captured='2026-10-19T11:59:00.123456789Z';
test('verified authorization stays pending and late nonterminal responses cannot undo a terminal outcome',()=>{
 assert.deepEqual(mergePaymentVerification(null,state('waiting_for_capture')),state('waiting_for_capture'));
 assert.deepEqual(mergePaymentVerification(state('waiting_for_capture'),state('pending')),state('waiting_for_capture'));
 for(const status of ['succeeded','canceled'])for(const late of ['pending','waiting_for_capture']){
  const saved=state(status,status==='succeeded'?captured:null);
  assert.deepEqual(mergePaymentVerification(saved,state(late)),saved);
 }
 for(const [old,next] of [['succeeded','canceled'],['canceled','succeeded']])
  assert.throws(()=>mergePaymentVerification(state(old),state(next)),PaymentVerificationError);
});
test('capture is never invented or reset, accepts equivalent precision and refuses a different nanosecond',()=>{
 assert.deepEqual(mergePaymentVerification(null,state('succeeded')),state('succeeded'));
 const saved=state('succeeded',captured);
 assert.deepEqual(mergePaymentVerification(saved,state('succeeded')),saved);
 assert.deepEqual(mergePaymentVerification(state('succeeded'),saved),saved);
 assert.deepEqual(mergePaymentVerification(state('succeeded','2026-10-19T11:59:00.123Z'),state('succeeded','2026-10-19T11:59:00.123000000Z')),state('succeeded','2026-10-19T11:59:00.123Z'));
 assert.throws(()=>mergePaymentVerification(saved,state('succeeded','2026-10-19T11:59:00.123456788Z')),PaymentVerificationError);
});
