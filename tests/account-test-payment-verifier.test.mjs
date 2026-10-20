import assert from 'node:assert/strict';import {test} from 'node:test';
import {createAccountTestPaymentVerifier} from '../src/lib/account-test-payment-verifier.ts';
const merchant={ownerId:'11111111-1111-4111-8111-111111111111',shopId:'123456',isTest:true,secretKey:'test_synthetic'};
test('account TEST verifier rejects LIVE or an absent fixed owner before allocating work',()=>{
 for(const patch of [{ownerId:undefined},{ownerId:'bad'},{isTest:false},{secretKey:'live_synthetic'}])assert.throws(()=>createAccountTestPaymentVerifier({transaction:()=>assert.fail()},{...merchant,...patch}));
});
test('account verifier scans only its owner/shop TEST linked orders, bounds each batch and cools down without merchant I/O',async()=>{
 let clock=1000,reads=0;
 const db={transaction:async(work,options)=>{reads++;assert.deepEqual(options,{readOnly:true});return work({query:async(sql,values)=>{
  assert.match(sql,/i\.owner_id=\$2/);assert.match(sql,/i\.is_test=true/);assert.match(sql,/join app\.payment_provider_links/);assert.match(sql,/limit 5/);
  assert.deepEqual(values.slice(0,2),[merchant.shopId,merchant.ownerId]);return{rows:[]};
 }});}};
 const worker=createAccountTestPaymentVerifier(db,merchant,async()=>assert.fail('No linked payment'),()=>clock);
 assert.deepEqual(await worker.tick(),{state:'idle'});assert.equal(reads,1);
 clock+=1000;assert.deepEqual(await worker.tick(),{state:'idle'});assert.equal(reads,1);
 clock+=30000;assert.deepEqual(await worker.tick(),{state:'idle'});assert.equal(reads,2);
});
