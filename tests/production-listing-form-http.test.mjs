import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as boundary from '../src/lib/auth-http.ts';
import * as cookie from '../src/lib/account-cookie.ts';
import * as proxy from '../src/lib/trusted-proxy-ip.ts';
import {createRequire} from 'node:module';
import {formModule} from './listing-form-module.mjs';
const {createProductionListingFormHandler}=formModule('production-listing-form-http',{'node:crypto':createRequire(import.meta.url)('node:crypto'),'./auth-http':boundary,'./account-cookie':cookie,'./trusted-proxy-ip':proxy});
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',origin='https://form.example.invalid';
function request(body,method='POST',extra={}){return new Request(origin+'/api/account/listing-form',{method,headers:{host:'form.example.invalid',origin,'x-blizhniy-request':'1','x-real-ip':'192.0.2.4','content-type':'application/json',cookie:'__Host-blizhniy_session='+'a'.repeat(64),...extra},...(method!=='GET'?{body:JSON.stringify(body)}:{})});}
test('full form HTTP guards ingress, cookie authority and exact input before resource runtime',async()=>{
 let calls=0;const handle=createProductionListingFormHandler({origin},()=>{calls++;assert.fail('unexpected runtime');},()=>{});
 for(const [body,method,headers,status] of [[{},'GET',{},405],[{expectedOwnerId:owner,listingId:id},'POST',{origin:'https://bad.invalid'},403],
  [{expectedOwnerId:owner,listingId:id},'POST',{cookie:'',Authorization:'Bearer legacy'},401],
  [{expectedOwnerId:owner,listingId:id,expectedRevision:'1',form:{kind:'prodam',status:'published'}},'PUT',{},422]])assert.equal((await handle(request(body,method,headers))).status,status);
 assert.equal(calls,0);
});
test('full form HTTP uses exact CAS and cookie, shares rate budget and never exposes SQL/private errors',async()=>{
 let writes=0;const events=[];
 const handle=createProductionListingFormHandler({origin},()=>({limiter:{allowProduction:async()=>true},store:{read:async()=>({id}),update:async(token,expectedOwner,key,revision,form)=>{
  writes++;assert.equal(token,'a'.repeat(64));assert.equal(expectedOwner,owner);assert.equal(key,id);assert.equal(revision,'9007199254740993');assert.equal(form.contactPhone,'+79990000000');throw new Error('synthetic-secret-sql');
 }}}),event=>events.push(event));
 const response=await handle(request({expectedOwnerId:owner,listingId:id,expectedRevision:'9007199254740993',form:{kind:'prodam',contactPhone:'+79990000000'}},'PUT'));
 assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:{code:'FORM_UNAVAILABLE'}});assert.equal(writes,1);assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal(JSON.stringify(events).includes('7999'),false);assert.equal(JSON.stringify(events).includes('synthetic-secret'),false);
});
