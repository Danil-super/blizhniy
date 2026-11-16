import assert from 'node:assert/strict';
import {test} from 'node:test';
import {formModule} from './listing-form-module.mjs';
import * as boundary from '../src/lib/auth-http.ts';
import * as config from '../src/lib/listing-checkout-config.ts';
import * as dispatchConfig from '../src/lib/account-test-payment-config.ts';
import {createListingCheckoutHandler} from './listing-checkout-http-module.mjs';
const origin='https://xn----9sbphbgks4a4a.xn--p1ai',owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
test('work checkout routes are disabled in old mode and pin their server kind behind the unchanged cookie/CSRF boundary',async()=>{
 const env={BLIZHNIY_LISTING_CHECKOUT:'prepare-only',BLIZHNIY_PAYMENT_MODE:'test',BLIZHNIY_PAYMENT_SHOP_ID:'fixture-shop',BLIZHNIY_PAYMENT_RECEIPT_VAT:'1',BLIZHNIY_LISTING_PAYMENT:'account-publication-test',BLIZHNIY_PAYMENT_TEST_USER_ID:owner,YOOKASSA_SHOP_ID:'fixture-shop',YOOKASSA_SECRET_KEY:'test_synthetic_only',BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_ORIGIN:origin,BLIZHNIY_LISTING_WORKFLOW:'postmoderation',BLIZHNIY_LOCAL_PRIMARY:undefined};
 const saved=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));for(const [key,value] of Object.entries(env)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 const policies=[];let authCalls=0,dbCalls=0;
 const {handleWorkCheckoutRequest,handleListingCheckoutRequest}=formModule('listing-checkout-runtime',{
  './auth-http':boundary,'./listing-checkout-config.ts':config,'./account-test-payment-config.ts':dispatchConfig,
  './account-test-listing-payment':{createAccountTestListingPayment:()=>({})},
  './production-auth-config':{readProductionAuthConfig:()=>{authCalls++;return{origin};}},
  './production-auth-runtime':{getProductionAccountDatabase:async()=>{dbCalls++;return{db:{},limiter:{allowProduction:async()=>true}};}},
  './postgres-listing-checkout':{PostgresListingCheckoutStore:class{constructor(_db,_config,policy){policies.push(policy);}async preview(){return{kind:policies.at(-1).targetType};}async readOrder(_token,_owner,paymentId){return{paymentId};}async readIntent(_token,_owner,creationKey){return{creationKey};}}},
  './listing-checkout-http':{createListingCheckoutHandler:(a,b,_audit,policy)=>createListingCheckoutHandler(a,b,()=>{},policy)},
 });
 const request=(patch={},headers={},method='POST')=>new Request(origin+'/api/account/vacancy-checkout',{method,headers:{host:new URL(origin).host,origin,'x-blizhniy-request':'1','x-real-ip':'192.0.2.4','content-type':'application/json',cookie:'__Host-blizhniy_session='+'a'.repeat(64),...headers},...(method==='GET'?{}:{body:JSON.stringify({expectedOwnerId:owner,action:'preview',listingId:id,expectedRevision:'1',...patch})})});
 try{
  process.env.BLIZHNIY_LISTING_PAYMENT='account-test';
  for(const kind of ['vacancy','workRequest'])assert.equal((await handleWorkCheckoutRequest(request(),kind)).status,503);
  assert.equal(authCalls,2);assert.equal(dbCalls,0);process.env.BLIZHNIY_LISTING_PAYMENT='account-publication-test';
  for(const kind of ['vacancy','workRequest']){
   const response=await handleWorkCheckoutRequest(request(),kind);assert.equal(response.status,200);assert.deepEqual(await response.json(),{kind});assert.deepEqual(policies.at(-1),{postmoderation:true,testModeHistory:true,targetType:kind,publicationTestOwner:owner});
  }
  const before=dbCalls;
  for(const [r,status] of [[request({targetType:'listing'}),422],[request({}, {origin:'https://other.invalid'}),403],[request({}, {cookie:''}),401],[request({}, {},'GET'),405]])assert.equal((await handleWorkCheckoutRequest(r,'vacancy')).status,status);
  assert.equal(dbCalls,before);assert.equal((await handleWorkCheckoutRequest(request(),'application')).status,503);
  for(const mode of ['account-test','disabled']){
   process.env.BLIZHNIY_LISTING_PAYMENT=mode;
   for(const kind of ['vacancy','workRequest'])for(const action of ['order','intent']){
    const key=action==='order'?'paymentId':'creationKey';
    const r=new Request(origin+'/api/account/vacancy-checkout',{method:'POST',headers:request().headers,body:JSON.stringify({expectedOwnerId:owner,action,[key]:id})});
    const response=await handleWorkCheckoutRequest(r,kind);assert.equal(response.status,200);assert.deepEqual(await response.json(),{[key]:id});
    assert.deepEqual(policies.at(-1),{postmoderation:true,testModeHistory:true,targetType:kind});
   }
   const count=dbCalls;assert.equal((await handleWorkCheckoutRequest(request(),'vacancy')).status,503);assert.equal(dbCalls,count);
  }
  process.env.BLIZHNIY_LISTING_PAYMENT='disabled';
  const count=dbCalls;
  for(const method of ['POST','PUT'])assert.equal((await handleListingCheckoutRequest(request({}, {},method))).status,503);
  assert.equal(dbCalls,count,'disabled listing preparation must not allocate database resources');
  for(const action of ['order','intent']){
   const key=action==='order'?'paymentId':'creationKey';
   const response=await handleListingCheckoutRequest(new Request(origin+'/api/account/listing-checkout',{method:'POST',headers:request().headers,body:JSON.stringify({expectedOwnerId:owner,action,[key]:id})}));
   assert.equal(response.status,200);assert.deepEqual(await response.json(),{[key]:id});
  }
 }finally{for(const key of Object.keys(saved)){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}}
});
