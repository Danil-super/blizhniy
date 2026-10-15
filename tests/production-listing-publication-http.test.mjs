import assert from 'node:assert/strict';import {test} from 'node:test';import {createRequire} from 'node:module';
import * as boundary from '../src/lib/auth-http.ts';import * as cookie from '../src/lib/account-cookie.ts';import * as proxy from '../src/lib/trusted-proxy-ip.ts';
import {formModule} from './listing-form-module.mjs';
const {createProductionListingPublicationHandler}=formModule('production-listing-publication-http',{'node:crypto':createRequire(import.meta.url)('node:crypto'),'./auth-http':boundary,'./account-cookie':cookie,'./trusted-proxy-ip':proxy});
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',origin='https://check.example.invalid',input={expectedOwnerId:owner,listingId:id,expectedRevision:'9007199254740993'};
function request(body=input,method='POST',extra={}){return new Request(origin+'/api/account/listing-publication',{method,headers:{host:'check.example.invalid',origin,'x-blizhniy-request':'1','x-real-ip':'192.0.2.4','content-type':'application/json',cookie:'__Host-blizhniy_session='+'a'.repeat(64),...extra},...(method!=='GET'?{body:JSON.stringify(body)}:{})});}
test('publication inspection rejects forged prices/status, bad origin, bearer-only authority and unsupported methods before runtime',async()=>{
 let calls=0;const handle=createProductionListingPublicationHandler({origin},()=>{calls++;assert.fail('unexpected runtime');},()=>{});
 for(const [body,method,headers,status] of [[input,'GET',{},405],[input,'POST',{origin:'https://bad.invalid'},403],[input,'POST',{cookie:'',authorization:'Bearer legacy'},401],
  [{...input,price:'0.01'},'POST',{},422],[{...input,status:'published'},'POST',{},422],[{...input,expectedRevision:1},'POST',{},422]]){
  const response=await handle(request(body,method,headers));assert.equal(response.status,status);assert.equal(response.headers.get('cache-control'),'no-store');
 }
 assert.equal(calls,0);
});
test('publication inspection uses shared SQL rate budget, exact owner/revision and safe errors without form/PII auditing',async()=>{
 let calls=0;const events=[],handle=createProductionListingPublicationHandler({origin},()=>({limiter:{allowProduction:async(operation,ip)=>{assert.equal(operation,'session');assert.equal(ip,'192.0.2.4');return true;}},store:{checkPublication:async(token,user,key,revision)=>{
  calls++;assert.equal(token,'a'.repeat(64));assert.equal(user,owner);assert.equal(key,id);assert.equal(revision,input.expectedRevision);throw Error('private-sql-password');
 }}}),event=>events.push(event));
 const response=await handle(request());assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:{code:'PUBLICATION_CHECK_UNAVAILABLE'}});assert.equal(calls,1);assert.equal(JSON.stringify(events).includes('private-sql'),false);
 const limited=createProductionListingPublicationHandler({origin},()=>({limiter:{allowProduction:async()=>false},store:{checkPublication:async()=>assert.fail()}}),()=>{});
 const denied=await limited(request());assert.equal(denied.status,429);assert.equal(denied.headers.get('retry-after'),'900');
});
