import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PostgresApplicationCompensationQueue} from '../src/lib/postgres-application-compensation-queue.ts';
import {createApplicationCompensationWorker} from '../src/lib/application-compensation-worker.ts';
import {createApplicationCompensationRefundProcessor} from '../src/lib/primary-application-compensation-refund.ts';

const merchant={shopId:'native-queue',isTest:true,secretKey:'test_synthetic_queue'};
const id='10000000-0000-4000-8000-000000000001',token='10000000-0000-4000-8000-000000000002';
test('queue and worker validate TEST scope and inputs before SQL or provider access',async()=>{
 let sql=0,http=0;const db={transaction(){sql++;throw Error('Unexpected SQL');}},fetcher=async()=>{http++;throw Error('Unexpected HTTP');};
 for(const invalid of [{...merchant,isTest:false},{...merchant,shopId:'../shop'},{...merchant,secretKey:'live_synthetic'}])assert.throws(()=>createApplicationCompensationWorker(db,invalid,fetcher));
 const queue=new PostgresApplicationCompensationQueue(db,merchant);
 for(const limit of [null,'1',0,101,1.5,Infinity])await assert.rejects(queue.enqueueBatch(limit));
 for(const claim of [null,{}, {paymentIntentId:id,claimId:token,attempts:13},{paymentIntentId:id+'\n',claimId:token,attempts:1}]){
  await assert.rejects(queue.owns(claim));await assert.rejects(queue.finish(claim,'retry','processing_unavailable'));
 }
 await assert.rejects(queue.finish({paymentIntentId:id,claimId:token,attempts:1},'completed','provider_pending'));
 assert.equal(sql,0);assert.equal(http,0);
});
test('the optional processor lease gate is validated and runs before source or provider work',async()=>{
 let queries=0,http=0;const db={transaction:async work=>work({query(){queries++;throw Error('Unexpected source query');}})};
 const processor=createApplicationCompensationRefundProcessor(db,merchant,async()=>{http++;throw Error('Unexpected HTTP');});
 await assert.rejects(processor.process(id,123));
 await assert.rejects(processor.process(id,async()=>{throw Object.assign(Error('Lease expired'),{code:'PBQ01'});}),{code:'PBQ01'});
 assert.equal(queries,0);assert.equal(http,0);
});
