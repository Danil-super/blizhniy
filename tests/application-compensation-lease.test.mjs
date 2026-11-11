import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PostgresApplicationCompensationQueue} from '../src/lib/postgres-application-compensation-queue.ts';
const claim={paymentIntentId:'10000000-0000-4000-8000-000000000001',claimId:'10000000-0000-4000-8000-000000000002',attempts:1};
test('compensation lease time is accepted only as a positive bounded integer from the locked SQL source',async()=>{
 const queue=new PostgresApplicationCompensationQueue({transaction:async()=>{throw Error('Unexpected separate transaction');}},{shopId:'lease-fixture',isTest:true});
 let calls=0;const tx=value=>({query:async()=>{calls++;return{rows:[{remaining:value}]};}});
 assert.equal(await queue.remaining(claim,tx(250)),250);
 for(const invalid of [undefined,null,'250',0,-1,1.5,Infinity,300001])await assert.rejects(queue.remaining(claim,tx(invalid)));
 const before=calls;await assert.rejects(queue.remaining({...claim,attempts:13},tx(250)));assert.equal(calls,before);
});
