import assert from 'node:assert/strict';import {test} from 'node:test';
import {createProductionListingModerationHandler} from './listing-moderation-http-module.mjs';
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',origin='https://moderation.example.invalid',input={expectedOwnerId:owner,listingId:id,expectedRevision:'9007199254740993'};
function request(body=input,method='POST',extra={}){return new Request(origin+'/api/account/listing-moderation',{method,headers:{host:'moderation.example.invalid',origin,'x-blizhniy-request':'1','x-real-ip':'192.0.2.4','content-type':'application/json',cookie:'__Host-blizhniy_session='+'a'.repeat(64),...extra},...(method!=='GET'?{body:JSON.stringify(body)}:{})});}
test('moderation rejects role/status/price fields, CSRF, bearer authority and unsupported methods before runtime',async()=>{
 let calls=0;const handle=createProductionListingModerationHandler({origin},()=>{calls++;assert.fail('unexpected runtime');},()=>{});
 for(const [body,method,headers,status] of [[input,'GET',{},405],[input,'POST',{origin:'https://bad.invalid'},403],[input,'PUT',{cookie:'',authorization:'Bearer legacy'},401],
  [{...input,role:'admin'},'PUT',{},422],[{...input,status:'approved'},'PUT',{},422],[{...input,price:'0.01'},'PUT',{},422],[{...input,expectedRevision:1},'POST',{},422]]){
  const response=await handle(request(body,method,headers));assert.equal(response.status,status);assert.equal(response.headers.get('cache-control'),'no-store');
 }assert.equal(calls,0);
});
test('read and submit share SQL limiter and exact identity/revision; unavailable writes are generic and never retried',async()=>{
 let reads=0,writes=0;const events=[],handle=createProductionListingModerationHandler({origin},()=>({limiter:{allowProduction:async()=>true},store:{
  read:async(token,user,key,revision)=>{assert.equal(token,'a'.repeat(64));assert.equal(user,owner);assert.equal(key,id);assert.equal(revision,input.expectedRevision);reads++;return{id:null,revision:null,state:'not_submitted',note:null};},
  submit:async()=>{writes++;throw Error('private-sql-password');},
 }}),event=>events.push(event));
 assert.equal((await handle(request())).status,200);const response=await handle(request(input,'PUT'));
 assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:{code:'MODERATION_UNAVAILABLE'}});assert.equal(reads,1);assert.equal(writes,1);
 for(const secret of ['private-sql',owner,id,'a'.repeat(64)])assert.equal(JSON.stringify(events).includes(secret),false);
 const limited=createProductionListingModerationHandler({origin},()=>({limiter:{allowProduction:async()=>false},store:{read:async()=>assert.fail()}}),()=>{});
 const denied=await limited(request());assert.equal(denied.status,429);assert.equal(denied.headers.get('retry-after'),'900');
});
