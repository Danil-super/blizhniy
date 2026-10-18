import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createListingFormModeration} from '../src/lib/listing-form-moderation.ts';
import {ListingModerationClientError} from '../src/lib/client-listing-moderation.ts';
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',revision='9007199254740993';
const pending={id:'33333333-3333-4333-8333-333333333333',revision,state:'pending',note:null};
test('initial moderation uses only the confirmed owner/listing/revision and never submits twice after success',async()=>{
 let writes=0;const intent=createListingFormModeration(owner,{id,revision},{submit:async(...args)=>{writes++;assert.deepEqual(args.slice(0,3),[owner,id,revision]);return pending;},read:async()=>assert.fail()});
 await intent.submit();await intent.submit();assert.equal(intent.completed,true);assert.equal(writes,1);
});
test('lost moderation acknowledgement blocks another write; readback confirms without resubmitting',async()=>{
 let writes=0,reads=0;const intent=createListingFormModeration(owner,{id,revision},{submit:async()=>{writes++;throw new ListingModerationClientError('UNKNOWN');},read:async()=>{reads++;return pending;}});
 await assert.rejects(intent.submit());assert.equal(intent.uncertain,true);await assert.rejects(intent.submit());
 await intent.readback();assert.equal(intent.completed,true);assert.equal(writes,1);assert.equal(reads,1);
});
test('readback of an uncommitted submission only unlocks an explicit new click',async()=>{
 let writes=0;const intent=createListingFormModeration(owner,{id,revision},{submit:async()=>{if(++writes===1)throw Error('lost reply');return pending;},read:async()=>({id:null,revision:null,state:'not_submitted',note:null})});
 await assert.rejects(intent.submit());await intent.readback();assert.equal(intent.completed,false);assert.equal(intent.uncertain,false);assert.equal(writes,1);
 await intent.submit();assert.equal(writes,2);assert.equal(intent.completed,true);
});
test('known validation rejection stays retryable, without claiming completion',async()=>{
 const intent=createListingFormModeration(owner,{id,revision},{submit:async()=>{throw new ListingModerationClientError('INVALID_INPUT');},read:async()=>assert.fail()});
 await assert.rejects(intent.submit());assert.equal(intent.uncertain,false);assert.equal(intent.completed,false);
});
test('a failed readback remains uncertain and cannot trigger an automatic write',async()=>{
 let writes=0;const intent=createListingFormModeration(owner,{id,revision},{submit:async()=>{writes++;throw Error('lost');},read:async()=>{throw Error('offline');}});
 await assert.rejects(intent.submit());await assert.rejects(intent.readback());await assert.rejects(intent.submit());assert.equal(writes,1);assert.equal(intent.uncertain,true);
});
