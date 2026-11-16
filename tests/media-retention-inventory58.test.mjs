import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {readMediaRetentionInventory} from '../scripts/media-retention-inventory.mjs';
const id='11111111-1111-4111-8111-111111111111',ownerId='22222222-2222-4222-8222-222222222222';
const observedAt='2026-11-15T00:00:00.000Z';
function fixture(change={}){
 const calls=[],responses=[
  [{isolation:'repeatable read',readOnly:'on',observedAt,journalEvents:3}],
  ['listing_photos.media_id','media_reference_events.media_id','media_retirement_requests.media_id','media_write_attempts.media_id','service_publication_photos.media_id','work_publication_photos.media_id'].map(source=>({source:'app.'+source})),
  [{bytes:'0'}],
  [{id,ownerId,state:'pending',size:128,hasWriteAttempt:true,references:[],retirementRequested:true,retirementCompleted:true,lastObservedAt:observedAt}],
  [{chargedBytes:'0',chargedObjects:0}],
 ];for(const [index,rows] of Object.entries(change))responses[Number(index)]=rows;
 return{calls,tx:{query:async sql=>{calls.push(sql);assert.match(sql.trim(),/^(select|with)\b/i);assert.ok(responses.length);return{rows:responses.shift()};}}};
}
test('local58 inventory excludes completed tombstones from charged quota without granting cleanup',async()=>{
 const f=fixture(),r=await readMediaRetentionInventory(f.tx,{retention:true});
 assert.equal(r.version,2);assert.equal(r.cleanupAuthorized,false);assert.equal(r.filesystem,'not-inspected');assert.equal(r.summary.objects,1);assert.equal(r.summary.bytes,128);
 assert.equal(r.summary.chargedObjects,0);assert.equal(r.summary.chargedBytes,0);assert.equal(r.summary.completedRetirements,1);assert.equal(r.summary.pendingRetirements,0);assert.equal(r.summary.journalEvents,3);assert.deepEqual(r.owners,[]);
 assert.equal(r.media[0].retirementCompleted,true);assert.equal(r.media[0].lastObservedAt,observedAt);assert.equal(r.media[0].unlinkedSince,null);assert.equal(r.media[0].action,'retain');assert.equal(f.calls.length,5);
});
test('local58 pending retirement stays charged and historical captures remain visible',async()=>{
 const f=fixture({3:[{id,ownerId,state:'pending',size:128,hasWriteAttempt:true,references:['retained_history'],retirementRequested:false,retirementCompleted:false,lastObservedAt:observedAt}],4:[{chargedBytes:'128',chargedObjects:1}]});
 const r=await readMediaRetentionInventory(f.tx,{retention:true});assert.equal(r.summary.chargedObjects,1);assert.equal(r.summary.chargedBytes,128);assert.equal(r.summary.linked,1);assert.deepEqual(r.media[0].references,['retained_history']);assert.equal(r.referenceCoverage.historicalVersions,'journal58-with-legacy-holds');assert.equal(r.owners[0].objects,1);
 const pending=fixture({3:[{id,ownerId,state:'pending',size:128,hasWriteAttempt:true,references:[],retirementRequested:true,retirementCompleted:false,lastObservedAt:observedAt}],4:[{chargedBytes:'128',chargedObjects:1}]});
 assert.equal((await readMediaRetentionInventory(pending.tx,{retention:true})).summary.pendingRetirements,1);
});
test('local58 rejects invalid history, impossible terminal state and incorrect active accounting',async()=>{
 for(const change of [{0:[{isolation:'repeatable read',readOnly:'on',observedAt,journalEvents:1000001}]},{3:[{id,ownerId,state:'pending',size:128,hasWriteAttempt:true,references:[],retirementRequested:false,retirementCompleted:true,lastObservedAt:observedAt}]},{3:[{id,ownerId,state:'ready',size:128,hasWriteAttempt:true,references:[],retirementRequested:true,retirementCompleted:true,lastObservedAt:null}]},{4:[{chargedBytes:'128',chargedObjects:1}]}])await assert.rejects(readMediaRetentionInventory(fixture(change).tx,{retention:true}),{message:'MEDIA_INVENTORY_UNAVAILABLE'});
});
test('an unsupported inventory mode is rejected before database access',async()=>{
 const f=fixture();await assert.rejects(readMediaRetentionInventory(f.tx,{retention:'true'}),{message:'MEDIA_INVENTORY_UNAVAILABLE'});assert.equal(f.calls.length,0);
});

test('file inspection flags cannot enable production or accept arbitrary modes',async()=>{
 for(const args of [['--files'],['--files=../outside'],['--apply']])await assert.rejects(promisify(execFile)(process.execPath,['--experimental-strip-types','scripts/check-local-media-retention.mjs',...args],{env:{PATH:'/unavailable',NODE_ENV:'production'},timeout:5000}),error=>{assert.equal(error.code,1);assert.equal(error.stdout,'');assert.match(error.stderr,/'?"phase":"arguments"/);return true;});
});
