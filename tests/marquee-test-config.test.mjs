import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
const load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
const {readHostedMarqueeCheckout}=load('service-checkout-config');
const {readCheckoutCancellationPolicy}=load('checkout-cancellation-policy');

const owner='10000000-0000-4000-8000-000000000001';
const env={BLIZHNIY_MARQUEE_PAYMENT:'account-publication-test',
 BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai',BLIZHNIY_LISTING_WORKFLOW:'postmoderation',
 BLIZHNIY_PAYMENT_MODE:'test',BLIZHNIY_PAYMENT_SHOP_ID:'900000001',BLIZHNIY_PAYMENT_RECEIPT_VAT:'1',
 BLIZHNIY_PAYMENT_TEST_USER_ID:owner,YOOKASSA_SHOP_ID:'900000001',YOOKASSA_SECRET_KEY:'test_synthetic_only'};

test('marquee TEST admission is explicit, numeric, owner-scoped and independent of ordinary checkouts',()=>{
 assert.equal(readHostedMarqueeCheckout({}),null);
 assert.equal(readHostedMarqueeCheckout({...env,BLIZHNIY_MARQUEE_PAYMENT:'disabled'}),null);
 const enabled=readHostedMarqueeCheckout({...env,BLIZHNIY_LISTING_CHECKOUT:'disabled',BLIZHNIY_LISTING_PAYMENT:'disabled'});
 assert.equal(enabled.merchant.ownerId,owner);assert.equal(enabled.checkout.shopId,'900000001');assert.equal(enabled.merchant.isTest,true);
 for(const patch of [{BLIZHNIY_MARQUEE_PAYMENT:'local-v1'},{BLIZHNIY_PAYMENT_MODE:'live'},
  {BLIZHNIY_PAYMENT_SHOP_ID:'fixture',YOOKASSA_SHOP_ID:'fixture'},{BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://127.0.0.1:3045'},
  {BLIZHNIY_SERVICE_CHECKOUT:'local-v1'},{BLIZHNIY_AUTH_ORIGIN:'https://example.invalid'},{YOOKASSA_SECRET_KEY:'live_synthetic'}]){
  assert.throws(()=>readHostedMarqueeCheckout({...env,...patch}));
 }
});

test('the separate hosted cancellation permission includes marquee and excludes fair',()=>{
 const enabled=readCheckoutCancellationPolicy({...env,BLIZHNIY_CHECKOUT_CANCELLATION:'hosted-test-v1'});
 assert.deepEqual(enabled,{ad_marquee:{shopId:'900000001',ownerId:owner}});
});
