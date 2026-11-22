const assert=require('node:assert/strict');
const {test}=require('node:test');
const {loadLocalPrimaryModule:load}=require('../scripts/local-primary-modules.cjs');
const {createApplicationCheckoutHandler}=load('application-checkout-http');
const {createAccountSessionState}=load('account-session-state');
const {readApplicationAccountTest}=load('application-test-config');
const owner='00000000-0000-4000-8000-000000000001';
const origin='https://xn----9sbphbgks4a4a.xn--p1ai';

test('hosted response payments need their own switch, matching numeric TEST merchant, and fiscal receipt',()=>{
 const env={BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_ORIGIN:origin,BLIZHNIY_LISTING_WORKFLOW:'postmoderation',BLIZHNIY_APPLICATION_PAYMENT:'account-response-test',
  BLIZHNIY_LISTING_PAYMENT:'account-publication-test',BLIZHNIY_LISTING_CHECKOUT:'prepare-only',BLIZHNIY_PAYMENT_MODE:'test',BLIZHNIY_PAYMENT_TEST_USER_ID:owner,
  BLIZHNIY_PAYMENT_SHOP_ID:'123456',YOOKASSA_SHOP_ID:'123456',BLIZHNIY_PAYMENT_RECEIPT_VAT:'2',YOOKASSA_SECRET_KEY:'test_synthetic_only'};
 assert.equal(readApplicationAccountTest(env).merchant.ownerId,owner);
 for(const mode of [undefined,'disabled','live'])assert.equal(readApplicationAccountTest({...env,BLIZHNIY_APPLICATION_PAYMENT:mode}),null);
 assert.equal(readApplicationAccountTest({...env,BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://127.0.0.1:3045'}),null);
 assert.equal(readApplicationAccountTest({...env,YOOKASSA_SHOP_ID:'abc',BLIZHNIY_PAYMENT_SHOP_ID:'abc'}),null);
 for(const patch of [{BLIZHNIY_PAYMENT_MODE:'live'},{BLIZHNIY_PAYMENT_RECEIPT_VAT:'none'},{YOOKASSA_SHOP_ID:'654321'}])assert.throws(()=>readApplicationAccountTest({...env,...patch}));
});

test('unauthenticated or cross-origin response checkout does not initialize the financial runtime',async()=>{
 let starts=0;
 const handle=createApplicationCheckoutHandler(origin,async()=>{starts++;throw Error('unexpected initialization')});
 const payload={expectedOwnerId:owner,action:'order',paymentId:owner};
 for(const [source,status] of [[origin,401],['https://example.invalid',403]]){
  const req=new Request(origin+'/api/account/application-checkout',{method:'POST',headers:{host:new URL(origin).host,origin:source,'Content-Type':'application/json','X-Blizhniy-Request':'1','X-Real-IP':'127.0.0.1'},body:JSON.stringify(payload)});
  assert.equal((await handle(req)).status,status);
 }
 assert.equal(starts,0);
});

test('removing the response entitlement updates the same signed-in account',async()=>{
 let user={id:owner,email:'user@example.invalid',role:'user',isBlocked:false,applicationTest:true};
 const state=createAccountSessionState(async()=>user);
 await state.refresh();assert.equal(state.read().applicationTest,true);
 const {applicationTest,...ordinary}=user;assert.equal(applicationTest,true);user=ordinary;
 await state.refresh(true);assert.equal(state.read().userId,owner);assert.equal(state.read().applicationTest,undefined);
});
