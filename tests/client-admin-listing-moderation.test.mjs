import assert from 'node:assert/strict';import {test} from 'node:test';
import {adminListingModeration,parseModerationQueue,parseModerationDetail,AdminModerationClientError} from '../src/lib/client-admin-listing-moderation.ts';
const actor='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
test('admin queue rejects unbounded entries, identities, duplicate requests and exposed fields',()=>{
 const item={id,listingId:actor,revision:'9007199254740993',title:'Проверка'};
 assert.deepEqual(parseModerationQueue({items:[item],nextCursor:null}),{items:[item],nextCursor:null});
 for(const value of [{items:Array(21).fill(item),nextCursor:null},{items:[item,item],nextCursor:null},{items:[{...item,owner:actor}],nextCursor:null},{items:[{...item,revision:1}],nextCursor:null}])assert.throws(()=>parseModerationQueue(value),AdminModerationClientError);
 assert.throws(()=>parseModerationDetail({request:{id,revision:'1',state:'pending',note:null},snapshot:{},check:{}},id),AdminModerationClientError);
});
test('admin decision is cookie-only, expected-account bound and never retried after unknown outcome',async()=>{
 const original=globalThis.fetch;let calls=0;
 try{globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,'/api/admin/listing-moderation');assert.equal(options.method,'PUT');assert.equal(options.credentials,'same-origin');
  assert.equal(options.headers.Authorization,undefined);assert.deepEqual(JSON.parse(options.body),{expectedAdminId:actor,requestId:id,state:'rejected',note:'Исправьте описание'});throw Error('private upstream');};
  await assert.rejects(adminListingModeration.decide(actor,id,'9007199254740993','rejected','Исправьте описание'),AdminModerationClientError);assert.equal(calls,1);
 }finally{globalThis.fetch=original;}
});
test('moderator image transport refuses foreign content types and releases oversized streams',async()=>{
 const original=globalThis.fetch;let cancelled=false;
 try{globalThis.fetch=async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(2097153));},cancel(){cancelled=true;}}),{headers:{'Content-Type':'image/webp'}});
  await assert.rejects(adminListingModeration.photo(actor,id,id),AdminModerationClientError);assert.equal(cancelled,true);
  globalThis.fetch=async()=>new Response('<html>private</html>',{headers:{'Content-Type':'text/html'}});
  await assert.rejects(adminListingModeration.photo(actor,id,id),AdminModerationClientError);
 }finally{globalThis.fetch=original;}
});
