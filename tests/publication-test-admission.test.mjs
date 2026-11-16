import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parsePaymentIntent,PaymentIntentError} from '../src/lib/postgres-payment-intents.ts';
import {readAccountTestPaymentConfig} from '../src/lib/account-test-payment-config.ts';
import {PostgresPaymentReconciliationQueue} from '../src/lib/postgres-payment-reconciliation.ts';
import {readWorkOwnerActionsEnabled} from '../src/lib/work-owner-actions-contract.ts';

const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
const binding={id,ownerId:owner,targetType:'listing',targetId:'33333333-3333-4333-8333-333333333333',targetRevision:'1',tariffId:'listing-publication',amount:'199.00',durationDays:30,shopId:'synthetic-shop',isTest:true};
function intent(patch={},mode='account-test-v1'){
 const b={...binding,...patch};
 return {...b,requestBody:JSON.stringify({amount:{value:b.amount,currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://example.invalid/return'},metadata:{localPaymentId:b.id,targetId:b.targetId,targetType:b.targetType,tariffId:b.tariffId,...(mode===undefined?{}:{publicationMode:mode})}})};
}
test('TEST publication admission is an exact immutable original-intent marker, limited to three placement kinds',()=>{
 for(const targetType of ['listing','vacancy','workRequest']){
  const value=intent({targetType});assert.deepEqual(parsePaymentIntent(value),value);
 }
 for(const patch of [{isTest:false},...['application','specialist','fair_application','ad_marquee'].map(targetType=>({targetType}))])
  assert.throws(()=>parsePaymentIntent(intent(patch)),PaymentIntentError);
 for(const mode of [null,true,'live','account-test-v2',''])assert.throws(()=>parsePaymentIntent(intent({},mode)),PaymentIntentError);
 const old=intent();const body=JSON.parse(old.requestBody);delete body.metadata.publicationMode;old.requestBody=JSON.stringify(body);
 assert.deepEqual(parsePaymentIntent(old),old);
 body.metadata.unexpected='account-test-v1';assert.throws(()=>parsePaymentIntent({...old,requestBody:JSON.stringify(body)}),PaymentIntentError);
});
test('publication-capable TEST configuration requires the canonical PostgreSQL postmoderation deployment and original allowlist',()=>{
 const env={BLIZHNIY_LISTING_PAYMENT:'account-publication-test',BLIZHNIY_PAYMENT_TEST_USER_ID:owner,YOOKASSA_SHOP_ID:binding.shopId,YOOKASSA_SECRET_KEY:'test_synthetic_only',BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai',BLIZHNIY_LISTING_WORKFLOW:'postmoderation'};
 const checkout={shopId:binding.shopId,isTest:true,siteOrigin:env.BLIZHNIY_AUTH_ORIGIN,receiptVatCode:1};
 assert.deepEqual(readAccountTestPaymentConfig(env,checkout),{ownerId:owner,shopId:binding.shopId,isTest:true,secretKey:'test_synthetic_only',publication:true});
 for(const patch of [{BLIZHNIY_AUTH_MODE:'local'},{BLIZHNIY_AUTH_ORIGIN:'https://example.invalid'},{BLIZHNIY_LISTING_WORKFLOW:'pre-moderation'},{BLIZHNIY_LOCAL_PRIMARY:'enabled'},{YOOKASSA_SECRET_KEY:'live_synthetic_only'},{BLIZHNIY_PAYMENT_TEST_USER_ID:''}])
  assert.throws(()=>readAccountTestPaymentConfig({...env,...patch},checkout));
 assert.throws(()=>readAccountTestPaymentConfig(env,{...checkout,isTest:false}));
 assert.throws(()=>readAccountTestPaymentConfig(env,{...checkout,siteOrigin:'https://other.invalid'}));
});
test('every publication queue operation requires original local marker, TEST scope and pinned owner; unknown old jobs stay outside it',async()=>{
 const calls=[],db={transaction:async work=>work({query:async(sql,args)=>{calls.push({sql,args});return{rows:[],rowCount:0};}})};
 const queue=new PostgresPaymentReconciliationQueue(db,{shopId:binding.shopId,isTest:true,publicationTestOwner:owner});
 const claim={intentId:id,claimId:'44444444-4444-4444-8444-444444444444',attempts:1};
 assert.equal(await queue.enqueue(id),false);assert.equal(await queue.claim(),null);assert.equal(await queue.owns(claim),false);assert.equal(await queue.finish(claim,'completed'),false);
 assert.equal(calls.length,4);
 for(const {sql,args} of calls){assert.match(sql,/request_body::jsonb/);assert.match(sql,/publicationMode/);assert.match(sql,/account-test-v1/);assert.match(sql,/i\.owner_id=\$\d+/);assert.ok(args.includes(owner));assert.match(sql,/i\.is_test=\$2/);assert.match(sql,/'vacancy','workRequest'/);}
 for(const config of [{shopId:binding.shopId,isTest:false,publicationTestOwner:owner},{shopId:binding.shopId,isTest:true,publicationTestOwner:'bad'}])assert.throws(()=>new PostgresPaymentReconciliationQueue(db,config));
});
test('production work management is independent of payment dispatch and rejects local/foreign deployment confusion',()=>{
 const env={BLIZHNIY_WORK_OWNER_ACTIONS:'production-v1',BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai',BLIZHNIY_LISTING_WORKFLOW:'postmoderation'};
 assert.equal(readWorkOwnerActionsEnabled(env),true);
 assert.equal(readWorkOwnerActionsEnabled({...env,BLIZHNIY_LISTING_PAYMENT:'disabled'}),true);
 for(const patch of [{BLIZHNIY_AUTH_MODE:'local'},{BLIZHNIY_AUTH_ORIGIN:'https://other.invalid'},{BLIZHNIY_LOCAL_PRIMARY:'enabled'},{BLIZHNIY_LISTING_WORKFLOW:'pre-moderation'}])assert.throws(()=>readWorkOwnerActionsEnabled({...env,...patch}));
});
