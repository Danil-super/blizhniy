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
