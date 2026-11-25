import assert from 'node:assert/strict';import {test} from 'node:test';
import * as boundary from '../src/lib/auth-http.ts';import * as config from '../src/lib/listing-checkout-config.ts';import {formModule} from './listing-form-module.mjs';
import {createListingCheckoutHandler} from './listing-checkout-http-module.mjs';
import * as dispatchConfig from '../src/lib/account-test-payment-config.ts';
test('disabled checkout never loads auth/database; explicit preparation uses only account store and fails closed',async()=>{
 const names=['BLIZHNIY_LISTING_CHECKOUT','BLIZHNIY_PAYMENT_SHOP_ID','BLIZHNIY_PAYMENT_MODE','BLIZHNIY_PAYMENT_RECEIPT_VAT'],before=Object.fromEntries(names.map(name=>[name,process.env[name]]));
 let authCalls=0,dbCalls=0;const calls=[];
 const {handleListingCheckoutRequest}=formModule('listing-checkout-runtime',{
  './auth-http':boundary,'./listing-checkout-config.ts':config,
  './account-test-payment-config.ts':dispatchConfig,'./account-test-listing-payment':{createAccountTestListingPayment:()=>assert.fail('dispatch must be disabled')},
  './production-auth-config':{readProductionAuthConfig:()=>{authCalls++;return{origin:'https://site.example.invalid'};}},
  './production-auth-runtime':{getProductionAccountDatabase:async()=>{dbCalls++;throw Error('private startup failure');}},
  './postgres-listing-checkout':{PostgresListingCheckoutStore:class{constructor(){assert.fail('database verification must finish first');}}},
  './listing-checkout-http':{createListingCheckoutHandler:(...args)=>{calls.push('handler');return createListingCheckoutHandler(...args,()=>{});}},
 });
 try{
  delete process.env.BLIZHNIY_LISTING_CHECKOUT;let response=await handleListingCheckoutRequest(new Request('https://site.example.invalid'));assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:{code:'CHECKOUT_DISABLED'}});assert.equal(authCalls,0);assert.equal(dbCalls,0);
  process.env.BLIZHNIY_LISTING_CHECKOUT='prepare-only';process.env.BLIZHNIY_PAYMENT_SHOP_ID='fixture-shop';process.env.BLIZHNIY_PAYMENT_MODE='live';process.env.BLIZHNIY_PAYMENT_RECEIPT_VAT='1';
  response=await handleListingCheckoutRequest(new Request('https://site.example.invalid'));assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:{code:'CHECKOUT_UNAVAILABLE'}});assert.equal(dbCalls,0);assert.deepEqual(calls,[]);
  process.env.BLIZHNIY_PAYMENT_MODE='test';
  const request=new Request('https://site.example.invalid/api/account/listing-checkout',{method:'POST',headers:{host:'site.example.invalid',origin:'https://site.example.invalid','x-blizhniy-request':'1','x-real-ip':'192.0.2.4','content-type':'application/json',cookie:'__Host-blizhniy_session='+'a'.repeat(64)},body:JSON.stringify({expectedOwnerId:'11111111-1111-4111-8111-111111111111',action:'order',paymentId:'22222222-2222-4222-8222-222222222222'})});
  response=await handleListingCheckoutRequest(request);assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:{code:'CHECKOUT_UNAVAILABLE'}});assert.equal(dbCalls,1);assert.deepEqual(calls,['handler']);
 }finally{for(const name of names){if(before[name]===undefined)delete process.env[name];else process.env[name]=before[name];}}
});

test('hosted renewal routes require the reconciler capability and keep specialist checkout separate',async()=>{
 const owner='10000000-0000-4000-8000-000000000001',origin='https://xn----9sbphbgks4a4a.xn--p1ai';
 const flags={BLIZHNIY_PLACEMENT_RENEWALS:'account-publication-test',BLIZHNIY_LISTING_PAYMENT:'account-publication-test',
  BLIZHNIY_LISTING_CHECKOUT:'prepare-only',BLIZHNIY_LISTING_WORKFLOW:'postmoderation',BLIZHNIY_AUTH_MODE:'postgres',
  BLIZHNIY_AUTH_ORIGIN:origin,BLIZHNIY_PAYMENT_MODE:'test',BLIZHNIY_PAYMENT_RECEIPT_VAT:'1',BLIZHNIY_PAYMENT_TEST_USER_ID:owner,
  BLIZHNIY_PAYMENT_SHOP_ID:'900000001',YOOKASSA_SHOP_ID:'900000001',YOOKASSA_SECRET_KEY:'test_synthetic_only'};
 const before=Object.fromEntries(Object.keys(flags).map(name=>[name,process.env[name]]));
 let ready=false,checks=0;
 const policies=[];
 const routes=formModule('listing-checkout-runtime',{
  './auth-http':boundary,'./listing-checkout-config.ts':config,'./account-test-payment-config.ts':dispatchConfig,
  './specialist-checkout-config':{readSpecialistAccountTest:()=>({checkout:config.readListingCheckoutConfig(process.env,origin),
   merchant:{shopId:'900000001',ownerId:owner,isTest:true,publication:true}})},
  './production-auth-config':{readProductionAuthConfig:()=>({origin})},
  './production-auth-runtime':{getProductionAccountDatabase:async()=>({db:{query:async sql=>{
   assert.match(sql,/apply_hosted_placement_renewal/);checks++;return{rows:[{ready}]};
  }},limiter:{}})},
  './postgres-listing-checkout':{PostgresListingCheckoutStore:class{constructor(_db,_config,policy){policies.push(policy);}}},
  './account-test-listing-payment':{createAccountTestListingPayment:()=>({})},
  './listing-checkout-http':{createListingCheckoutHandler:(_auth,factory)=>async()=>{await factory();return Response.json({ready:true});}},
 });
 try{
  Object.assign(process.env,flags);
  const request=new Request(origin+'/api/account/listing-checkout');
  assert.equal((await routes.handleListingCheckoutRequest(request)).status,503);
  assert.deepEqual(policies,[]);
  ready=true;
  assert.equal((await routes.handleListingCheckoutRequest(request)).status,200);
  for(const kind of ['vacancy','workRequest'])assert.equal((await routes.handleWorkCheckoutRequest(request,kind)).status,200);
  assert.deepEqual(policies.map(policy=>[policy.targetType??'listing',policy.renewals,policy.publicationTestOwner]),
   [['listing',true,owner],['vacancy',true,owner],['workRequest',true,owner]]);
  assert.equal((await routes.handleSpecialistCheckoutRequest(request)).status,200);
  assert.equal(policies.at(-1).renewals,undefined);
  assert.equal(checks,4);
 }finally{for(const [name,value] of Object.entries(before)){if(value===undefined)delete process.env[name];else process.env[name]=value;}}
});
