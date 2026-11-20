import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {createAccountSessionState} from '../src/lib/account-session-state.ts';

const load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
const origin='https://xn----9sbphbgks4a4a.xn--p1ai',owner='10000000-0000-4000-8000-000000000001';
test('hosted specialist checkout requires one TEST merchant, account, receipt, and canonical site',()=>{
 const {readSpecialistAccountTest}=load('specialist-checkout-config');
 const env={BLIZHNIY_SPECIALIST_PAYMENT:'account-publication-test',BLIZHNIY_LISTING_PAYMENT:'account-publication-test',BLIZHNIY_LISTING_CHECKOUT:'prepare-only',
  BLIZHNIY_LISTING_WORKFLOW:'postmoderation',BLIZHNIY_PAYMENT_MODE:'test',BLIZHNIY_PAYMENT_SHOP_ID:'900000001',YOOKASSA_SHOP_ID:'900000001',
  BLIZHNIY_PAYMENT_RECEIPT_VAT:'1',BLIZHNIY_PAYMENT_TEST_USER_ID:owner,YOOKASSA_SECRET_KEY:'test_synthetic',BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_ORIGIN:origin};
 assert.equal(readSpecialistAccountTest(env).merchant.ownerId,owner);
 assert.equal(readSpecialistAccountTest({...env,BLIZHNIY_SPECIALIST_PAYMENT:undefined}),null);
 for(const change of [{BLIZHNIY_PAYMENT_MODE:'live'},{YOOKASSA_SECRET_KEY:'live_synthetic'},{YOOKASSA_SHOP_ID:'123'},
  {BLIZHNIY_PAYMENT_TEST_USER_ID:'all'},{BLIZHNIY_PAYMENT_RECEIPT_VAT:'none'},{BLIZHNIY_AUTH_ORIGIN:'https://example.invalid'},{BLIZHNIY_SPECIALIST_CHECKOUT:'local-v1'}])
  assert.throws(()=>readSpecialistAccountTest({...env,...change}));
});
test('session header is private to the enrolled owner and is removed from the client on revocation or account change',async()=>{
 const {createProductionAccountHandler}=load('production-account-http');
 const user={id:owner,email:'private@example.invalid',role:'user',isBlocked:false};
 let signedIn=user;
 const handle=createProductionAccountHandler({origin,rateSecret:'s'.repeat(64)},()=>({
  identity:{resolveSession:async()=>signedIn},limiter:{allowProduction:async()=>true},
 }),()=>{},id=>id===owner);
 async function session(){
  const result=await handle(new Request(origin+'/api/account/session',{method:'POST',body:'{}',headers:{origin,host:new URL(origin).host,
   'x-real-ip':'192.0.2.2','content-type':'application/json','x-blizhniy-request':'1',cookie:'__Host-blizhniy_session='+'a'.repeat(64)}}),'session');
  assert.equal(result.headers.get('cache-control'),'no-store');
  const cap=result.headers.get('x-blizhniy-specialist-test');
  if(!signedIn){assert.equal(result.status,401);assert.equal(cap,null);return null;}
  assert.equal(result.status,200);assert.equal(cap,signedIn.id===owner?'1':null);
  assert.deepEqual((await result.json()).user,signedIn);
  return {...signedIn,...(cap?{specialistTest:true}:{})};
 }
 const state=createAccountSessionState(session);
 await state.refresh();assert.equal(state.read().specialistTest,true);
 state.beginChange();assert.equal(state.read().specialistTest,undefined);
 signedIn={...user,id:'20000000-0000-4000-8000-000000000002'};await state.endChange();
 assert.deepEqual(state.read(),{state:'signed-in',userId:signedIn.id});
 signedIn=null;await state.refresh(true);assert.deepEqual(state.read(),{state:'signed-out',userId:null});
});
