import assert from 'node:assert/strict';import {test} from 'node:test';
import {readListingCheckoutConfig} from '../src/lib/listing-checkout-config.ts';
test('local checkout preparation is opt-in, TEST-only and never consumes a merchant secret',()=>{
 const env={BLIZHNIY_LISTING_CHECKOUT:'prepare-only',BLIZHNIY_PAYMENT_SHOP_ID:'fixture-shop',BLIZHNIY_PAYMENT_MODE:'test',BLIZHNIY_PAYMENT_RECEIPT_VAT:'1'};
 assert.equal(readListingCheckoutConfig({},'https://site.example.invalid'),null);
 assert.equal(readListingCheckoutConfig({BLIZHNIY_LISTING_CHECKOUT:'disabled'},'https://site.example.invalid'),null);
 assert.deepEqual(readListingCheckoutConfig(env,'https://site.example.invalid'),{shopId:'fixture-shop',isTest:true,siteOrigin:'https://site.example.invalid',receiptVatCode:1});
 assert.equal(readListingCheckoutConfig({...env,BLIZHNIY_PAYMENT_RECEIPT_VAT:'none'},'https://site.example.invalid').receiptVatCode,null);
 for(const patch of [{BLIZHNIY_LISTING_CHECKOUT:'enabled'},{BLIZHNIY_PAYMENT_SHOP_ID:''},{BLIZHNIY_PAYMENT_MODE:'live'},{BLIZHNIY_PAYMENT_RECEIPT_VAT:undefined},{BLIZHNIY_PAYMENT_RECEIPT_VAT:'01'},{BLIZHNIY_PAYMENT_RECEIPT_VAT:'13'}])assert.throws(()=>readListingCheckoutConfig({...env,...patch},'https://site.example.invalid'));
});
