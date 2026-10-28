import test from 'node:test';
import assert from 'node:assert/strict';
import {loadLocalPrimaryModule} from '../scripts/local-primary-modules.cjs';
const {PostgresListingCheckoutStore}=loadLocalPrimaryModule('postgres-listing-checkout');
const {PostgresListingPaymentFulfillmentStore}=loadLocalPrimaryModule('postgres-listing-payment-fulfillment');
const {PostgresPublicWorkStore}=loadLocalPrimaryModule('postgres-public-work');
const keys=['BLIZHNIY_LISTING_WORKFLOW','BLIZHNIY_LOCAL_PRIMARY','BLIZHNIY_LOCAL_PRIMARY_ORIGIN'];
const old=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
const config={shopId:'local-fixture-shop',isTest:true,siteOrigin:'https://site.example.invalid',receiptVatCode:1};
const db={query:()=>{throw Error('No database access authorized');},transaction:()=>{throw Error('No database access authorized');}};
test('vacancy checkout/fulfillment/public policy are impossible without validated local mode; LIVE remains impossible locally',()=>{
 try{
  for(const key of keys)delete process.env[key];
  assert.throws(()=>new PostgresListingCheckoutStore(db,config,{targetType:'vacancy'}));
  assert.throws(()=>new PostgresListingPaymentFulfillmentStore(db,config,{targetType:'vacancy'}));
  assert.throws(()=>new PostgresPublicWorkStore(db,{vacancyPostmoderation:true}));
  Object.assign(process.env,{BLIZHNIY_LISTING_WORKFLOW:'postmoderation',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://127.0.0.1:3045'});
  assert.ok(new PostgresListingCheckoutStore(db,config,{targetType:'vacancy'}));
  assert.ok(new PostgresListingPaymentFulfillmentStore(db,config,{targetType:'vacancy'}));
  assert.ok(new PostgresPublicWorkStore(db,{vacancyPostmoderation:true}));
  assert.throws(()=>new PostgresListingCheckoutStore(db,{...config,isTest:false},{targetType:'vacancy'}));
  assert.throws(()=>new PostgresListingPaymentFulfillmentStore(db,{...config,isTest:false},{targetType:'vacancy'}));
  process.env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN='https://site.example.invalid';
  assert.throws(()=>new PostgresListingCheckoutStore(db,config,{targetType:'vacancy'}));
 }finally{for(const key of keys){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}}
});
