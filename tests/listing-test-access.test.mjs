import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as config from '../src/lib/account-test-payment-config.ts';
import * as session from '../src/lib/account-session-state.ts';

const owner='10000000-0000-4000-8000-000000000001', peer='20000000-0000-4000-8000-000000000002';
const env={BLIZHNIY_LISTING_PAYMENT:'account-test',BLIZHNIY_LISTING_CHECKOUT:'prepare-only',BLIZHNIY_PAYMENT_MODE:'test',
  BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai',BLIZHNIY_LISTING_WORKFLOW:'postmoderation',
  BLIZHNIY_PAYMENT_TEST_USER_ID:owner,BLIZHNIY_PAYMENT_RECEIPT_VAT:'1',BLIZHNIY_PAYMENT_SHOP_ID:'123456',YOOKASSA_SHOP_ID:'123456',YOOKASSA_SECRET_KEY:'test_fixture'};

test('verification-only listing checkout requires the matching TEST merchant and never grants work publication',()=>{
  assert.equal(config.canShowListingVerificationTest(owner,env),true);
  assert.equal(config.canShowWorkPublicationTest(owner,env),false);
  assert.equal(config.canShowListingVerificationTest(peer,env),false);
  for(const change of [{BLIZHNIY_LISTING_PAYMENT:'account-publication-test'},{BLIZHNIY_LISTING_CHECKOUT:'disabled'},
    {BLIZHNIY_LISTING_PAYMENT:'disabled'},{YOOKASSA_SHOP_ID:'other'},{YOOKASSA_SECRET_KEY:'live_fixture'}]){
    assert.equal(config.canShowListingVerificationTest(owner,{...env,...change}),false);
  }
});

test('listing checkout uses only the verified editor owner and expires on a session change',async()=>{
  let user={id:owner,email:'fixture@example.invalid',isBlocked:false,role:'user',listingVerificationTest:true};
  const state=session.createAccountSessionState(async()=>user);
  await state.refresh();
  assert.equal(session.canStartListingTest(state.read(),owner),true);
  assert.equal(session.canStartListingTest(state.read(),peer),false);
  state.beginChange();
  assert.equal(session.canStartListingTest(state.read(),owner),false);
  user={...user,id:peer,listingVerificationTest:undefined};
  await state.endChange();
  assert.equal(session.canStartListingTest(state.read(),peer),false);
  user={...user,workPublicationTest:true};
  await state.refresh(true);
  assert.equal(session.canStartListingTest(state.read(),peer),true);
});
