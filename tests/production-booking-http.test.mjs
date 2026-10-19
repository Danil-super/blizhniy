import assert from 'node:assert/strict';import {test} from 'node:test';import {createRequire} from 'node:module';
import * as http from '../src/lib/auth-http.ts';import * as cookie from '../src/lib/account-cookie.ts';import * as proxy from '../src/lib/trusted-proxy-ip.ts';
import * as contract from '../src/lib/booking-request-contract.ts';import {formModule} from './listing-form-module.mjs';import {loadAdminModule} from './admin-module.mjs';
const storage=formModule('postgres-bookings',{'./booking-request-contract.ts':contract,'./postgres-notification-inbox':{},'./listing-public-eligibility':formModule('listing-public-eligibility')});
const {createProductionBookingHandler}=formModule('production-booking-http',{'node:crypto':createRequire(import.meta.url)('node:crypto'),'./auth-http':http,'./account-cookie':cookie,'./trusted-proxy-ip':proxy,'./booking-request-contract.ts':contract,'./postgres-bookings':storage});
const origin='https://bookings.example.invalid',owner='10000000-0000-4000-8000-000000000001',id='10000000-0000-4000-8000-000000000002',token='b'.repeat(64);
const base={expectedOwnerId:owner},body={...base,action:'read',bookingId:id},input={listingId:id,creationKey:id,expectedListingRevision:'9007199254740993',mode:'stay',startDate:'2026-10-20',endDate:'2026-10-22',guests:2};
function fixture(error=null,allowed=true){let factories=0;const calls=[],events=[],handler=createProductionBookingHandler({origin},()=>{factories++;return{store:Object.fromEntries(['preview','read','readIntent','list','create','decide'].map(name=>[name,async(...args)=>{calls.push([name,...args]);if(error)throw error;return{name};}])),limiter:{allowProduction:async()=>allowed}};},event=>events.push(event));
 const request=(value=body,headers={},method='POST',query='')=>new Request(origin+'/api/account/bookings'+query,{method,headers:{host:'bookings.example.invalid',origin,'x-real-ip':'192.0.2.5','x-blizhniy-request':'1','content-type':'application/json',cookie:'__Host-blizhniy_session='+token,...headers},...(['GET','HEAD'].includes(method)?{}:{body:JSON.stringify(value)})});return{handler,request,calls,events,get factories(){return factories;}};
}
test('booking HTTP rejects foreign ingress, bearer-only authority, query overrides and oversized bodies before private runtime',async()=>{
 for(const [headers,method,query,status] of [[{},'GET','',405],[{origin:'https://foreign.invalid'},'POST','',403],[{host:'foreign.invalid'},'POST','',403],[{'x-blizhniy-request':''},'POST','',403],
  [{'x-real-ip':''},'POST','',403],[{cookie:'',authorization:'Bearer synthetic'},'POST','',401],[{},'POST','?guestId=other',400],[{'content-type':'text/plain'},'POST','',415],[{'content-length':'5000'},'PUT','',413]]){
  const f=fixture(),response=await f.handler(f.request(body,headers,method,query));assert.equal(response.status,status);assert.equal(f.factories,0);assert.deepEqual(f.calls,[]);
 }
});
test('booking HTTP requires exact independent preview/create/read/CAS envelopes and rejects all claimed money, guest and snapshot fields',async()=>{
 for(const [value,method] of [[{...body,extra:true},'POST'],[body,'PUT'],[{...base,action:'list',mode:'admin',after:null},'POST'],[{...base,action:'create',input:{...input,total:'0.01'}},'PUT'],
  [{...base,action:'create',input:{...input,guestId:owner}},'PUT'],[{...base,action:'preview',input:{...input,details_snapshot:{}}},'POST'],[{...base,action:'create',input:{...input,expectedListingRevision:1}},'PUT'],
  [{...base,action:'decide',bookingId:id,expectedRevision:'1',state:'pending'},'PUT'],[{...base,action:'decide',bookingId:id,expectedRevision:1,state:'accepted'},'PUT']]){
  const f=fixture(),response=await f.handler(f.request(value,{},method));assert.equal(response.status,422);assert.equal(f.factories,0);
 }
});
test('booking HTTP dispatch binds the canonical cookie and expected owner, preserves exact CAS, emits only safe audit metadata and no-store JSON',async()=>{
 const f=fixture();assert.equal((await f.handler(f.request({...base,action:'create',input},{},'PUT'))).status,200);assert.deepEqual(f.calls.at(-1),['create',token,owner,contract.parseBookingRequest(input)]);
 for(const [value,method,name] of [[{...base,action:'preview',input},'POST','preview'],[body,'POST','read'],[{...base,action:'intent',creationKey:id},'POST','readIntent'],[{...base,action:'list',mode:'host',after:null},'POST','list'],
  [{...base,action:'decide',bookingId:id,expectedRevision:'9007199254740993',state:'accepted'},'PUT','decide']]){const response=await f.handler(f.request(value,{},method));assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(f.calls.at(-1)[0],name);}
 assert.equal(f.calls.at(-1)[4],'9007199254740993');for(const secret of [token,owner,id,input.startDate])assert.equal(JSON.stringify(f.events).includes(secret),false);
});
test('booking HTTP maps access, capacity, busy, conflict, expiry and unknown results without duplicate execution or private error messages',async()=>{
 for(const [error,status,code] of [[new storage.BookingAccessError(),404,'BOOKING_NOT_FOUND'],[new storage.BookingAvailabilityError(),409,'BOOKING_UNAVAILABLE'],[new storage.BookingBusyError(),409,'BOOKING_BUSY'],[new storage.BookingConflictError(),409,'BOOKING_CHANGED'],
  [new contract.BookingQuoteError(),422,'BOOKING_INVALID'],[new (loadAdminModule('app-session-transaction').AppSessionAccessError)(),401,'UNAUTHENTICATED'],[Error('Private details /server/path'),503,'BOOKINGS_UNAVAILABLE']]){
  const f=fixture(error),response=await f.handler(f.request());assert.equal(response.status,status);assert.deepEqual(await response.json(),{error:{code}});assert.equal(f.calls.length,1);
 }
 const f=fixture(null,false),response=await f.handler(f.request());assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),'900');assert.deepEqual(f.calls,[]);
});
