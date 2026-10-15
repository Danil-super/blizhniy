import assert from 'node:assert/strict';import {test} from 'node:test';
import {parseListingModerationState,listingModeration,ListingModerationClientError} from '../src/lib/client-listing-moderation.ts';
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',review='33333333-3333-4333-8333-333333333333',revision='9007199254740993';
test('moderation DTO binds current/outdated versions and denies malformed states, extra fields and rejection notes',()=>{
 const pending={id:review,revision,state:'pending',note:null};assert.deepEqual(parseListingModerationState(pending,revision),pending);
 assert.equal(parseListingModerationState({...pending,revision:'2',state:'outdated'},revision).state,'outdated');
 for(const row of [{...pending,revision:'2'},{...pending,state:'published'},{...pending,role:'admin'},{...pending,state:'rejected'},
  {...pending,state:'approved',note:'unexpected'},{id:null,revision:null,state:'approved',note:null},{...pending,state:'outdated'},{...pending,state:'rejected',note:'x'.repeat(1001)}])
  assert.throws(()=>parseListingModerationState(row,revision),ListingModerationClientError);
});
test('moderation sends only cookie owner/id/revision and never automatically retries an unknown write',async()=>{
 const original=globalThis.fetch;let calls=0;
 try{globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,'/api/account/listing-moderation');assert.equal(options.method,'PUT');assert.equal(options.credentials,'same-origin');
  assert.equal(options.headers.Authorization,undefined);assert.deepEqual(JSON.parse(options.body),{expectedOwnerId:owner,listingId:id,expectedRevision:revision});throw Error('private-transport');};
  await assert.rejects(listingModeration.submit(owner,id,revision),error=>error instanceof ListingModerationClientError&&!error.message.includes('private-transport'));assert.equal(calls,1);
 }finally{globalThis.fetch=original;}
});
test('moderation cancels an oversized reply stream and refuses it before rendering',async()=>{
 const original=globalThis.fetch;let cancelled=false;
 try{globalThis.fetch=async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(4097));},cancel(){cancelled=true;}}));
  await assert.rejects(listingModeration.read(owner,id,revision),ListingModerationClientError);assert.equal(cancelled,true);
 }finally{globalThis.fetch=original;}
});
