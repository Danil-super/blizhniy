import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createListingCheckoutHandler} from './listing-checkout-http-module.mjs';
import {ListingCheckoutConflictError,ListingCheckoutUnavailableError} from '../src/lib/listing-checkout-contract.ts';
import {loadAdminModule} from './admin-module.mjs';
import {ListingDraftAccessError,ListingDraftConflictError} from './listing-draft-module.mjs';
const {AppSessionAccessError}=loadAdminModule('app-session-transaction');
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',key='33333333-3333-4333-8333-333333333333';
const origin='https://checkout.example.invalid',input={listingId:id,expectedRevision:'9007199254740993',creationKey:key,expectedTariffId:'listing-publication',expectedAmount:'199.99',expectedDurationDays:30};
const body={expectedOwnerId:owner,...input};
function request(data=body,method='PUT',extra={},query=''){
 return new Request(origin+'/api/account/listing-checkout'+query,{method,headers:{host:'checkout.example.invalid',origin,'x-blizhniy-request':'1','x-real-ip':'192.0.2.4','content-type':'application/json',cookie:'__Host-blizhniy_session='+'a'.repeat(64),...extra},...(method==='GET'?{}:{body:JSON.stringify(data)})});
}
test('checkout rejects CSRF, non-cookie authority, untrusted ingress and extra economic/role fields before store access',async()=>{
 let calls=0;const handle=createListingCheckoutHandler({origin},()=>{calls++;assert.fail('unexpected runtime');},()=>{});
 for(const [data,method,headers,status,query] of [
  [body,'GET',{},405],[body,'PUT',{origin:'https://foreign.invalid'},403],[body,'PUT',{'x-blizhniy-request':''},403],
  [body,'PUT',{cookie:'',authorization:'Bearer legacy'},401],[body,'PUT',{'x-real-ip':''},403],
  [{...body,status:'succeeded'},'PUT',{},422],[{...body,shopId:'other'},'PUT',{},422],[{...body,receipt:{}},'PUT',{},422],
  [{...body,role:'admin'},'PUT',{},422],[{...body,expectedRevision:1},'PUT',{},422],
  [{expectedOwnerId:owner,action:'intent',creationKey:key,extra:true},'POST',{},422],
  [body,'PUT',{},400,'?debug=1'],[body,'PUT',{'content-length':'5000'},413],
 ]){
  const response=await handle(request(data,method,headers,query));assert.equal(response.status,status);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get('referrer-policy'),'no-referrer');if(status===405)assert.equal(response.headers.get('allow'),'POST, PUT');
 }assert.equal(calls,0);
});
test('checkout routes exact owner-bound preview, prepare, intent recovery and status reads without automatic replay',async()=>{
 const calls=[],events=[],handle=createListingCheckoutHandler({origin},()=>({limiter:{allowProduction:async(scope,ip)=>{assert.equal(scope,'session');assert.equal(ip,'192.0.2.4');return true;}},store:Object.fromEntries(['preview','prepare','readIntent','readOrder'].map(method=>[method,async(...args)=>{calls.push({method,args});return method==='readIntent'?null:{synthetic:method};}]))}),event=>events.push(event));
 const operations=[['POST',{expectedOwnerId:owner,action:'preview',listingId:id,expectedRevision:input.expectedRevision},'preview',[id,input.expectedRevision]],
  ['PUT',body,'prepare',[input]],['POST',{expectedOwnerId:owner,action:'intent',creationKey:key},'readIntent',[key]],['POST',{expectedOwnerId:owner,action:'order',paymentId:id},'readOrder',[id]]];
 for(const [method,data,name,args] of operations){const response=await handle(request(data,method));assert.equal(response.status,200);assert.deepEqual(await response.json(),name==='readIntent'?null:{synthetic:name});assert.deepEqual(calls.at(-1),{method:name,args:['a'.repeat(64),owner,...args]});}
 assert.equal(calls.length,4);assert.equal(events.length,4);
 for(const secret of [owner,id,key,'a'.repeat(64),'199.99'])assert.equal(JSON.stringify(events).includes(secret),false);
});
test('checkout maps access/conflict failures and unknown COMMIT to generic no-store errors, never retries',async()=>{
 for(const [error,status,code] of [[new AppSessionAccessError(),401,'UNAUTHENTICATED'],[new ListingDraftAccessError(),404,'DRAFT_NOT_FOUND'],[new ListingDraftConflictError(),409,'DRAFT_CHANGED'],[new ListingCheckoutConflictError(),409,'CHECKOUT_CHANGED'],[new ListingCheckoutUnavailableError(),409,'CHECKOUT_NOT_READY'],[Error('private SQL body and payer'),503,'CHECKOUT_UNAVAILABLE']]){
  let calls=0;const handle=createListingCheckoutHandler({origin},()=>({limiter:{allowProduction:async()=>true},store:{prepare:async()=>{calls++;throw error;}}}),()=>{});
  const response=await handle(request());assert.equal(response.status,status);assert.deepEqual(await response.json(),{error:{code}});assert.equal(calls,1);
 }
 const handle=createListingCheckoutHandler({origin},()=>({limiter:{allowProduction:async()=>false},store:{prepare:async()=>assert.fail()}}),()=>{});
 const response=await handle(request());assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),'900');
});
test('account TEST actions require exact cookie input and remain disabled unless explicitly composed',async()=>{
 const base={store:{},limiter:{allowProduction:async()=>true}};
 const disabled=createListingCheckoutHandler({origin},()=>base,()=>{});
 assert.equal((await disabled(request({expectedOwnerId:owner,action:'dispatch',paymentId:id},'POST'))).status,503);
 let calls=0;const handle=createListingCheckoutHandler({origin},()=>({...base,payments:{dispatch:async(token,user,paymentId)=>{calls++;assert.equal(token,'a'.repeat(64));assert.equal(user,owner);assert.equal(paymentId,id);return{confirmationUrl:null,isTest:true};}}}),()=>{});
 assert.equal((await handle(request({expectedOwnerId:owner,action:'dispatch',paymentId:id,status:'succeeded'},'POST'))).status,422);assert.equal(calls,0);
 const response=await handle(request({expectedOwnerId:owner,action:'dispatch',paymentId:id},'POST'));assert.equal(response.status,200);assert.deepEqual(await response.json(),{confirmationUrl:null,isTest:true});assert.equal(calls,1);
});
