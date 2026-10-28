import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
const {createListingOwnerRemovalClient}=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule('client-listing-owner-removal');
const owner='10000000-0000-4000-8000-000000000001',id='10000000-0000-4000-8000-000000000002';
test('client sends only stable intent with secure transport and separately verifies deletion',async()=>{
 const calls=[],client=createListingOwnerRemovalClient(async(path,options)=>{
  calls.push({path,options});const body=JSON.parse(options.body);return Response.json({id,revision:'7',removed:body.action==='remove'});
 });
 assert.equal((await client.remove(owner,id,'7')).removed,true);assert.equal((await client.read(owner,id,'7')).removed,false);
 for(const [index,action] of ['remove','read'].entries()){
  const {path,options}=calls[index];assert.equal(path,'/api/account/listing-removal');assert.equal(options.credentials,'same-origin');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');
  assert.deepEqual(JSON.parse(options.body),{action,expectedOwnerId:owner,listingId:id,expectedRevision:'7'});
 }
});
test('lost or ambiguous removal reply is UNKNOWN without any automatic retry',async()=>{
 for(const response of [()=>{throw Error('Network disconnected');},()=>Response.json({id,revision:'8',removed:true}),()=>Response.json({id,revision:'7',removed:false}),()=>Response.json({id:owner,revision:'7',removed:true}),()=>new Response('x'.repeat(4097))]){
  let calls=0;const client=createListingOwnerRemovalClient(async()=>{calls++;return response();});
  await assert.rejects(client.remove(owner,id,'7'),{code:'UNKNOWN'});assert.equal(calls,1);
 }
});
test('known failures retain codes only when HTTP status agrees and aborted intent does not send',async()=>{
 for(const [status,code] of [[404,'DRAFT_NOT_FOUND'],[409,'DRAFT_CHANGED'],[429,'RATE_LIMITED'],[401,'UNAUTHENTICATED']]){
  const client=createListingOwnerRemovalClient(async()=>Response.json({error:{code}},{status}));await assert.rejects(client.remove(owner,id,'7'),{code});
 }
 const bad=createListingOwnerRemovalClient(async()=>Response.json({error:{code:'DRAFT_CHANGED'}},{status:500}));await assert.rejects(bad.remove(owner,id,'7'),{code:'UNKNOWN'});
 let calls=0;const client=createListingOwnerRemovalClient(async()=>{calls++;return Response.json({id,revision:'7',removed:true});});
 await assert.rejects(client.remove(owner,id,'7',{signal:AbortSignal.abort()}),{code:'UNKNOWN'});assert.equal(calls,0);
});
