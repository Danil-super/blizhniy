import assert from 'node:assert/strict';import {test} from 'node:test';
import * as boundary from '../src/lib/auth-http.ts';import * as cookie from '../src/lib/account-cookie.ts';import * as proxy from '../src/lib/trusted-proxy-ip.ts';
import {formModule} from './listing-form-module.mjs';
const {createListingOwnerActionsHandler}=formModule('listing-owner-actions-http',{'./auth-http':boundary,'./account-cookie':cookie,'./trusted-proxy-ip':proxy});
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',origin='https://actions.example.invalid';
const input={expectedOwnerId:owner,listingId:id,expectedRevision:'9007199254740993',action:'withdraw'};
function request(body=input,headers={},method='POST'){return new Request(origin+'/api/account/listing-actions',{method,headers:{host:'actions.example.invalid',origin,'x-blizhniy-request':'1','x-real-ip':'192.0.2.4','content-type':'application/json',cookie:'__Host-blizhniy_session='+'a'.repeat(64),...headers},...(method==='POST'?{body:JSON.stringify(body)}:{})});}
test('owner action endpoint rejects forged financial input, foreign origin and missing cookie before runtime',async()=>{
 let calls=0;const handle=createListingOwnerActionsHandler({origin},async()=>{calls++;assert.fail('Unexpected runtime');});
 for(const [body,headers,method,status] of [[{...input,isPaid:true},{},'POST',422],[{...input,action:'pay'},{},'POST',422],[input,{origin:'https://foreign.invalid'},'POST',403],[input,{cookie:''},'POST',401],[input,{},'GET',405]])assert.equal((await handle(request(body,headers,method))).status,status);
 assert.equal(calls,0);
});
test('owner action preserves exact revision/cookie, no-store and hides internal failures',async()=>{
 let calls=0;const handle=createListingOwnerActionsHandler({origin},async()=>({limiter:{allowProduction:async()=>true},store:{change:async(token,actor,key,revision,action)=>{
  calls++;assert.equal(token,'a'.repeat(64));assert.equal(actor,owner);assert.equal(key,id);assert.equal(revision,'9007199254740993');assert.equal(action,'withdraw');throw Error('private-sql-error');
 }}}));
 const result=await handle(request());assert.equal(result.status,503);assert.deepEqual(await result.json(),{error:{code:'ACTION_UNAVAILABLE'}});assert.equal(result.headers.get('cache-control'),'no-store');assert.equal(calls,1);
});
