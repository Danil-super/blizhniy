import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
const load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
test('an expired placement lease stops before reading approval, reserving or sending',async()=>{
 const {createApprovedPlacementRefundProcessor}=load('primary-approved-placement-refund');let sql=0,http=0;
 const db={transaction:work=>work({query:async()=>{sql++;throw Error('Unexpected SQL');}})};
 const processor=createApprovedPlacementRefundProcessor(db,{shopId:'queue-fixture',isTest:true,secretKey:'test_synthetic_queue'},async()=>{http++;throw Error('Unexpected provider');});
 await assert.rejects(processor.process('11111111-1111-4111-8111-111111111111',async()=>{throw Error('Synthetic placement lease unavailable');}),/Synthetic placement lease unavailable/);
 assert.equal(sql,0);assert.equal(http,0);
});
test('placement queue and worker reject non-TEST configuration without SQL or provider calls',()=>{
 const {createPlacementRefundWorker}=load('placement-refund-worker');let sql=0,http=0;
 const db={transaction:async()=>{sql++;throw Error('Unexpected SQL');}},fetcher=async()=>{http++;throw Error('Unexpected provider');};
 for(const config of [{shopId:'fixture',isTest:false,secretKey:'live_invalid'},{shopId:'fixture',isTest:true,secretKey:''}])assert.throws(()=>createPlacementRefundWorker(db,config,fetcher));
 assert.equal(sql,0);assert.equal(http,0);
});
