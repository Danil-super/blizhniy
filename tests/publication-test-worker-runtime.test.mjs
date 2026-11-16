import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPaymentWorkerRuntime} from '../scripts/payment-worker-runtime.mjs';
const owner='11111111-1111-4111-8111-111111111111';
const env={NODE_ENV:'production',BLIZHNIY_PAYMENT_WORKER:'account-publication-test',BLIZHNIY_PAYMENT_MODE:'test',BLIZHNIY_PAYMENT_SHOP_ID:'synthetic-shop',BLIZHNIY_PAYMENT_SECRET_KEY:'test_synthetic-key',
 BLIZHNIY_DB_HOST:'17e86f80f26733d39ef4b84d.twc1.net',BLIZHNIY_DB_PORT:'5432',BLIZHNIY_DB_NAME:'blizhniy_prod',BLIZHNIY_DB_USER:'blizhniy_payment_reconciler',BLIZHNIY_DB_PASSWORD:'synthetic-db-key',BLIZHNIY_DB_SSL_MODE:'verify-full',BLIZHNIY_DB_CA_FILE:'/unused/root.crt',
 BLIZHNIY_PAYMENT_TEST_USER_ID:owner,BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai',BLIZHNIY_LISTING_WORKFLOW:'postmoderation'};
test('publication TEST runtime rejects LIVE/local/foreign deployment before pool allocation and pins the owner in the queued worker',async()=>{
 for(const patch of [{BLIZHNIY_PAYMENT_MODE:'live'},{BLIZHNIY_PAYMENT_SECRET_KEY:'live_synthetic'},{BLIZHNIY_PAYMENT_TEST_USER_ID:undefined},{BLIZHNIY_PAYMENT_TEST_USER_ID:''},{BLIZHNIY_LOCAL_PRIMARY:'enabled'},{BLIZHNIY_AUTH_MODE:'local'},{BLIZHNIY_AUTH_ORIGIN:'https://foreign.invalid'},{BLIZHNIY_LISTING_WORKFLOW:'pre-moderation'}])
  await assert.rejects(createPaymentWorkerRuntime({...env,...patch},{loadModules:()=>assert.fail('invalid configuration must fail before modules/pool')}),{message:'Payment worker configuration unavailable'});
 let configured,closed=0;
 const runtime=await createPaymentWorkerRuntime(env,{loadModules:()=>({readPostgresConfig:()=>({database:'blizhniy_prod'}),Pool:class{},PostgresDatabase:class{async close(){closed++;}},
  createAccountTestPaymentVerifier:()=>assert.fail('publication mode must not select the old verifier'),
  createPaymentReconciliationWorker:(_db,merchant,fetcher,account)=>{configured={merchant,fetcher,account};return{tick:async()=>({state:'idle'})};}})});
 assert.equal(configured.account,owner);assert.equal(configured.fetcher,undefined);assert.equal(configured.merchant.isTest,true);assert.equal(Object.isFrozen(configured.merchant),true);
 assert.deepEqual(await runtime.worker.tick(),{state:'idle'});await runtime.close();await runtime.close();assert.equal(closed,1);
});
