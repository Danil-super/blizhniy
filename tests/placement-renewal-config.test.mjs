import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {test} from 'node:test';
const load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
const {readPlacementRenewalsEnabled}=load('placement-renewal-config');
test('renewal rollout defaults off and accepts only the inspected local postmoderation deployment',()=>{
 assert.equal(readPlacementRenewalsEnabled({}),false);assert.equal(readPlacementRenewalsEnabled({BLIZHNIY_PLACEMENT_RENEWALS:'disabled'}),false);
 const env={BLIZHNIY_PLACEMENT_RENEWALS:'local-v1',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://127.0.0.1:3045',BLIZHNIY_LISTING_WORKFLOW:'postmoderation'};
 assert.equal(readPlacementRenewalsEnabled(env),true);
 for(const patch of [{BLIZHNIY_PLACEMENT_RENEWALS:'true'},{BLIZHNIY_LOCAL_PRIMARY:undefined},{BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://example.com'},{BLIZHNIY_LISTING_WORKFLOW:'pre-moderation'}])assert.throws(()=>readPlacementRenewalsEnabled({...env,...patch}));
});

test('hosted renewal only enables ordinary placements for the configured publication TEST owner',()=>{
 const {readHostedPlacementRenewalOwner}=load('placement-renewal-config');
 const owner='10000000-0000-4000-8000-000000000001';
 const env={BLIZHNIY_PLACEMENT_RENEWALS:'account-publication-test',BLIZHNIY_LISTING_PAYMENT:'account-publication-test',
  BLIZHNIY_LISTING_CHECKOUT:'prepare-only',BLIZHNIY_LISTING_WORKFLOW:'postmoderation',
  BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai',
  BLIZHNIY_PAYMENT_TEST_USER_ID:owner,BLIZHNIY_PAYMENT_MODE:'test',BLIZHNIY_PAYMENT_SHOP_ID:'900000001',
  BLIZHNIY_PAYMENT_RECEIPT_VAT:'1',YOOKASSA_SHOP_ID:'900000001',YOOKASSA_SECRET_KEY:'test_synthetic_only'};
 assert.equal(readHostedPlacementRenewalOwner(env),owner);
 assert.equal(readPlacementRenewalsEnabled(env),true);
 for(const patch of [{BLIZHNIY_LISTING_PAYMENT:'account-test'},{BLIZHNIY_LOCAL_PRIMARY:'enabled'},
  {BLIZHNIY_PAYMENT_MODE:'live'},{BLIZHNIY_LISTING_CHECKOUT:'disabled'},{BLIZHNIY_PAYMENT_SHOP_ID:'local-fixture-shop',YOOKASSA_SHOP_ID:'local-fixture-shop'},
  {BLIZHNIY_AUTH_ORIGIN:'https://example.invalid'},{YOOKASSA_SHOP_ID:'900000002'}]){
  assert.throws(()=>readHostedPlacementRenewalOwner({...env,...patch}));
 }
 assert.equal(readHostedPlacementRenewalOwner({...env,BLIZHNIY_PLACEMENT_RENEWALS:'disabled'}),undefined);
});
