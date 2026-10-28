import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
const load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
const {createListingOwnerRemovalHandler}=load('listing-owner-removal-http');
const {ListingDraftAccessError,ListingDraftConflictError}=load('postgres-listing-drafts');
const origin='https://example.invalid',owner='10000000-0000-4000-8000-000000000001',id='10000000-0000-4000-8000-000000000002';
const body={action:'remove',expectedOwnerId:owner,listingId:id,expectedRevision:'7'};
function request(input=body,headers={},method='POST'){
 return new Request(origin+'/api/account/listing-removal',{method,headers:{host:new URL(origin).host,origin,'content-type':'application/json','x-blizhniy-request':'1','x-real-ip':'127.0.0.1','sec-fetch-site':'same-origin',cookie:'__Host-blizhniy_session='+'a'.repeat(64),...headers},body:method==='POST'?JSON.stringify(input):undefined});
}
function fixture({error,allowed=true}={}){
 const calls=[];
 const store=Object.fromEntries(['read','remove'].map(action=>[action,async(...args)=>{calls.push({action,args});if(error)throw error;return{id,revision:'7',removed:action==='remove'};} ]));
 return{calls,handle:createListingOwnerRemovalHandler({origin},async()=>({store,limiter:{allowProduction:async()=>allowed}}))};
}
test('owner removal and readback share strict owner/revision contract and never cache responses',async()=>{
 const value=fixture();for(const action of ['read','remove']){
  const result=await value.handle(request({...body,action}));assert.equal(result.status,200);assert.match(result.headers.get('cache-control'),/no-store/);
  assert.deepEqual(await result.json(),{id,revision:'7',removed:action==='remove'});
 }
 assert.deepEqual(value.calls.map(call=>call.action),['read','remove']);
 assert.deepEqual(value.calls[1].args,['a'.repeat(64),owner,id,'7']);
});
test('CSRF, absent cookie, malformed input, untrusted ingress and throttled requests never reach removal',async()=>{
 for(const [input,headers,options,expected] of [
  [body,{origin:'https://other.invalid'},{},403],[body,{cookie:''},{},401],
  [{...body,status:'published'},{},{},422],[body,{'x-real-ip':''},{},403],[body,{}, {allowed:false},429],
 ]){const value=fixture(options),response=await value.handle(request(input,headers));assert.equal(response.status,expected);assert.equal(value.calls.length,0);}
 const value=fixture();assert.equal((await value.handle(request(body,{},'GET'))).status,405);assert.equal(value.calls.length,0);
});
test('denials and stale removal revisions have stable generic error statuses',async()=>{
 for(const [error,status,code] of [[new ListingDraftAccessError(),404,'DRAFT_NOT_FOUND'],[new ListingDraftConflictError(),409,'DRAFT_CHANGED'],[Error('private database detail'),503,'REMOVAL_UNAVAILABLE']]){
  const response=await fixture({error}).handle(request());assert.equal(response.status,status);assert.deepEqual(await response.json(),{error:{code}});
 }
});
