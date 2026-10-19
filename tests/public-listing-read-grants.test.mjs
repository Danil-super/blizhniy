import assert from 'node:assert/strict';import {test} from 'node:test';import {getPublicListingReadGrantPlan,grantPublicListingMetadataRead} from '../scripts/grant-public-listing-read.mjs';
test('public listing metadata grant fixes exactly two read-only fields and reviewed migration history, without finance or counter writes',()=>{
 const plan=getPublicListingReadGrantPlan();assert.equal(plan.migrations.length,18);assert.equal(plan.table,'app.listings');assert.equal(plan.role,'blizhniy_runtime');assert.deepEqual(plan.columns,['created_at','view_count']);
});
test('public listing metadata grant refuses malformed or different target confirmation before SQL',async()=>{
 let calls=0;const client={connectionParameters:{host:'127.0.0.1',database:'owned'},query:async()=>{calls++;throw Error('Must not query');}};
 for(const target of [undefined,'wrong:owned','127.0.0.1:other',{},'127.0.0.1:owned\n'])await assert.rejects(grantPublicListingMetadataRead(client,target));assert.equal(calls,0);
});
