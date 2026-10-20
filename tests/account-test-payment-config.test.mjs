import assert from 'node:assert/strict';import {test} from 'node:test';
import {readAccountTestPaymentConfig} from '../src/lib/account-test-payment-config.ts';
const owner='11111111-1111-4111-8111-111111111111';
const checkout={shopId:'123456',isTest:true,siteOrigin:'https://site.example.invalid',receiptVatCode:1};
const enabled={BLIZHNIY_LISTING_PAYMENT:'account-test',BLIZHNIY_PAYMENT_TEST_USER_ID:owner,YOOKASSA_SHOP_ID:'123456',YOOKASSA_SECRET_KEY:'test_synthetic_only'};
test('account TEST dispatch is disabled by default and pins one owner, original shop, TEST key and explicit receipt',()=>{
 assert.equal(readAccountTestPaymentConfig({},checkout),null);
 assert.deepEqual(readAccountTestPaymentConfig(enabled,checkout),{ownerId:owner,shopId:'123456',isTest:true,secretKey:'test_synthetic_only'});
 for(const patch of [{BLIZHNIY_LISTING_PAYMENT:'live'},{BLIZHNIY_PAYMENT_TEST_USER_ID:undefined},{BLIZHNIY_PAYMENT_TEST_USER_ID:'x'},{YOOKASSA_SHOP_ID:'other'},{YOOKASSA_SECRET_KEY:'live_synthetic'},{YOOKASSA_SECRET_KEY:'test_has space'}])assert.throws(()=>readAccountTestPaymentConfig({...enabled,...patch},checkout));
 for(const patch of [{isTest:false},{receiptVatCode:null}])assert.throws(()=>readAccountTestPaymentConfig(enabled,{...checkout,...patch}));
});
