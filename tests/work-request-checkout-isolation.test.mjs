import test from 'node:test';
import assert from 'node:assert/strict';
import {loadLocalPrimaryModule} from '../scripts/local-primary-modules.cjs';
const {PostgresListingCheckoutStore}=loadLocalPrimaryModule('postgres-listing-checkout');
const {PostgresListingPaymentFulfillmentStore}=loadLocalPrimaryModule('postgres-listing-payment-fulfillment');
const keys=['BLIZHNIY_LISTING_WORKFLOW','BLIZHNIY_LOCAL_PRIMARY','BLIZHNIY_LOCAL_PRIMARY_ORIGIN'];
const config={shopId:'local-fixture-shop',isTest:true,siteOrigin:'https://site.example.invalid',receiptVatCode:1};
const db={query:()=>{throw Error('No database access authorized');},transaction:()=>{throw Error('No database access authorized');}};
function isolated(work){const old=Object.fromEntries(keys.map(key=>[key,process.env[key]]));try{for(const key of keys)delete process.env[key];work();}finally{for(const key of keys){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}}}
function local(){Object.assign(process.env,{BLIZHNIY_LISTING_WORKFLOW:'postmoderation',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://127.0.0.1:3045'});}
test('work request preparation and settlement are available only inside explicitly isolated TEST postmoderation',()=>isolated(()=>{
 local();
 assert.ok(new PostgresListingCheckoutStore(db,config,{targetType:'workRequest'}));
 assert.ok(new PostgresListingPaymentFulfillmentStore(db,config,{targetType:'workRequest'}));
}));
test('work request TEST workflow cannot enable default production, foreign origin, or LIVE',()=>isolated(()=>{
 for(const Store of [PostgresListingCheckoutStore,PostgresListingPaymentFulfillmentStore]){
  assert.throws(()=>new Store(db,config,{targetType:'workRequest'}));
  local();
  assert.throws(()=>new Store(db,{...config,isTest:false},{targetType:'workRequest'}));
  process.env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN='https://site.example.invalid';
  assert.throws(()=>new Store(db,config,{targetType:'workRequest'}));
  for(const key of keys)delete process.env[key];
 }
}));
