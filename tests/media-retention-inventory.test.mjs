import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readMediaRetentionInventory} from '../scripts/media-retention-inventory.mjs';
const id='11111111-1111-4111-8111-111111111111',owner='22222222-2222-4222-8222-222222222222';
function fixture(change={}){
 const calls=[],responses=[
  [{isolation:'repeatable read',readOnly:'on',observedAt:'2026-11-14T00:00:00.000Z'}],
  ['listing_photos.media_id','media_write_attempts.media_id','service_publication_photos.media_id','work_publication_photos.media_id'].map(source=>({source:'app.'+source})),
  [{bytes:'0'}],
  [{id,ownerId:owner,state:'ready',size:128,hasWriteAttempt:true,references:[]}],
  [{chargedBytes:'128',chargedObjects:1}],
 ];for(const [index,rows] of Object.entries(change))responses[Number(index)]=rows;
 return{calls,tx:{query:async(sql,values)=>{calls.push({sql,values});assert.match(sql.trim(),/^(select|with)\b/i);assert.ok(responses.length);return{rows:responses.shift()};}}};
}
test('SQL inventory reconciles reservations but never authorizes deleting an old unlinked file',async()=>{
 const f=fixture(),report=await readMediaRetentionInventory(f.tx);
 assert.equal(report.policy.retentionDays,7);assert.equal(report.cleanupAuthorized,false);assert.equal(report.filesystem,'not-inspected');
 assert.equal(report.referenceCoverage.externalDocuments,'not-inspected');assert.equal(report.referenceCoverage.historicalVersions,'unavailable');
 assert.equal(report.summary.objects,1);assert.equal(report.summary.unlinked,1);assert.equal(report.summary.bytes,128);
 assert.equal(report.media[0].unlinkedSince,null);assert.equal(report.media[0].action,'retain');assert.equal(report.media[0].hasWriteAttempt,true);
 assert.equal(report.owners[0].overQuota,false);assert.equal(f.calls.length,5);
});
test('photo references and document references retain media, with pending attempts distinguished',async()=>{
 const f=fixture({3:[{id,ownerId:owner,state:'pending',size:128,hasWriteAttempt:true,references:['work_photos','application_snapshot']}]});
 const report=await readMediaRetentionInventory(f.tx);assert.equal(report.summary.linked,1);assert.equal(report.summary.pendingWithAttempt,1);assert.equal(report.summary.pendingWithoutAttempt,0);assert.deepEqual(report.media[0].references,['work_photos','application_snapshot']);
});
test('inventory refuses weak isolation, unknown foreign references and excessive document bytes',async()=>{
 for(const change of [{0:[{isolation:'read committed',readOnly:'on'}]},{0:[{isolation:'repeatable read',readOnly:'off'}]},{1:[{source:'other.unknown.media_id'}]},{2:[{bytes:String(32*1024*1024+1)}]}]){
  const f=fixture(change);await assert.rejects(readMediaRetentionInventory(f.tx),error=>error.message==='MEDIA_INVENTORY_UNAVAILABLE');assert.ok(f.calls.length<5);
 }
});
test('mismatched accounting or malformed/oversized media cannot yield a successful report',async()=>{
 for(const change of [{4:[{chargedBytes:'127',chargedObjects:1}]},{3:[{id,ownerId:owner,state:'ready',size:NaN,references:[],hasWriteAttempt:false}]},{3:Array(10001).fill({id,ownerId:owner,state:'ready',size:128,references:[],hasWriteAttempt:false})}]){
  await assert.rejects(readMediaRetentionInventory(fixture(change).tx),error=>error.message==='MEDIA_INVENTORY_UNAVAILABLE');
 }
});
test('metadata errors discard raw database details',async()=>{
 await assert.rejects(readMediaRetentionInventory({query:async()=>{throw Error('private contact and connection data');}}),error=>error.message==='MEDIA_INVENTORY_UNAVAILABLE'&&!error.cause);
});
test('owner quota totals include pending rows and diagnostics expose only selected metadata',async()=>{
 const rows=Array.from({length:501},(_,i)=>({id:`33333333-3333-4333-8333-${String(i).padStart(12,'0')}`,ownerId:owner,state:'pending',size:128,hasWriteAttempt:false,references:[],privatePayload:'private-contact'}));
 const report=await readMediaRetentionInventory(fixture({3:rows,4:[{chargedBytes:String(501*128),chargedObjects:501}]}).tx);
 assert.equal(report.owners[0].overQuota,true);assert.equal(report.summary.pendingWithoutAttempt,501);assert.equal(JSON.stringify(report).includes('private-contact'),false);
});
test('the local command rejects an apply flag before accessing Docker or a database',async()=>{
 await assert.rejects(promisify(execFile)(process.execPath,['--experimental-strip-types','scripts/check-local-media-retention.mjs','--apply'],{env:{PATH:'/unavailable'},timeout:5000}),error=>{
  assert.equal(error.code,1);assert.equal(error.stdout,'');assert.match(error.stderr,/"code":"LOCAL_MEDIA_INVENTORY_UNAVAILABLE","phase":"arguments"/);return true;
 });
});
