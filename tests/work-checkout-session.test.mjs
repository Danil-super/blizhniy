import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {createAccountSessionState} from '../src/lib/account-session-state.ts';
import {productionAccount} from '../src/lib/local-account.ts';
import * as config from '../src/lib/account-test-payment-config.ts';

const load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
const owner='10000000-0000-4000-8000-000000000001',peer='20000000-0000-4000-8000-000000000002';
const origin='https://xn----9sbphbgks4a4a.xn--p1ai';
const env={BLIZHNIY_LISTING_PAYMENT:'account-publication-test',BLIZHNIY_LISTING_CHECKOUT:'prepare-only',
  BLIZHNIY_LISTING_WORKFLOW:'postmoderation',BLIZHNIY_PAYMENT_MODE:'test',BLIZHNIY_PAYMENT_SHOP_ID:'123456',YOOKASSA_SHOP_ID:'123456',
  BLIZHNIY_PAYMENT_RECEIPT_VAT:'1',BLIZHNIY_PAYMENT_TEST_USER_ID:owner,YOOKASSA_SECRET_KEY:'test_synthetic',BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_ORIGIN:origin};

test('work checkout display uses the existing publication merchant and enrolled account',()=>{
  assert.equal(config.canShowWorkPublicationTest(owner,env),true);
  assert.equal(config.canShowWorkPublicationTest(peer,env),false);
  for(const change of [{BLIZHNIY_LISTING_PAYMENT:'account-test'},{BLIZHNIY_LISTING_PAYMENT:'disabled'},
    {YOOKASSA_SHOP_ID:'2'},{BLIZHNIY_LISTING_CHECKOUT:'disabled'},{BLIZHNIY_PAYMENT_MODE:'live'},{BLIZHNIY_LOCAL_PRIMARY:'enabled'}]){
    assert.equal(config.canShowWorkPublicationTest(owner,{...env,...change}),false);
  }
});

test('production session transports the work capability privately and clears it on revocation or account switch',async t=>{
  const {createProductionAccountHandler}=load('production-account-http');
  let user={id:owner,role:'user',email:'fixture@example.invalid',isBlocked:false},paymentEnv={...env};
  const handle=createProductionAccountHandler({origin,rateSecret:'s'.repeat(64)},()=>({
    identity:{resolveSession:async()=>user},limiter:{allowProduction:async()=>true}
  }),()=>{},undefined,id=>config.canShowWorkPublicationTest(id,paymentEnv));
  t.mock.method(globalThis,'fetch',async(path,init)=>{
    const headers=new Headers(init.headers);
    for(const [key,value] of Object.entries({origin,host:new URL(origin).host,'x-real-ip':'192.0.2.2',cookie:'__Host-blizhniy_session='+'a'.repeat(64)}))headers.set(key,value);
    const response=await handle(new Request(new URL(path,origin),{...init,headers}),'session');
    assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'no-store');
    return response;
  });
  const state=createAccountSessionState(productionAccount.session);
  await state.refresh();
  assert.deepEqual(state.read(),{state:'signed-in',userId:owner,workPublicationTest:true});
  paymentEnv={...env,BLIZHNIY_LISTING_PAYMENT:'disabled'};
  await state.refresh(true);
  assert.deepEqual(state.read(),{state:'signed-in',userId:owner});
  paymentEnv=env;await state.refresh(true);
  state.beginChange();assert.equal(state.read().workPublicationTest,undefined);
  user={...user,id:peer};await state.endChange();
  assert.deepEqual(state.read(),{state:'signed-in',userId:peer});
  user=null;await state.refresh(true);
  assert.deepEqual(state.read(),{state:'signed-out',userId:null});
});
