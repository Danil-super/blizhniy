import assert from 'node:assert/strict';import {test} from 'node:test';import {createRequire} from 'node:module';
import * as http from '../src/lib/auth-http.ts';import * as cookie from '../src/lib/account-cookie.ts';import * as proxy from '../src/lib/trusted-proxy-ip.ts';
import * as drafts from '../src/lib/listing-draft-contract.ts';import {workPublicationModule} from './work-publication-module.mjs';import {loadAdminModule} from './admin-module.mjs';
const {createProductionNotificationInboxHandler}=workPublicationModule('production-notification-inbox-http',{
 'node:crypto':createRequire(import.meta.url)('node:crypto'),'./auth-http':http,'./account-cookie':cookie,'./trusted-proxy-ip':proxy,
 './app-session-transaction':loadAdminModule('app-session-transaction'),'./listing-draft-contract.ts':drafts});
const origin='https://inbox.example.invalid',owner='10000000-0000-4000-8000-000000000001',id='10000000-0000-4000-8000-000000000002',token='a'.repeat(64),body={action:'list',expectedOwnerId:owner,after:null};
function fixture(error=null,allowed=true){const calls=[],events=[];let factories=0;
 const handler=createProductionNotificationInboxHandler({origin},()=>{factories++;return{store:{list:async(...args)=>{calls.push(['list',...args]);if(error)throw error;return{items:[],nextCursor:null};},mark:async(...args)=>{calls.push(['mark',...args]);if(error)throw error;}},limiter:{allowProduction:async()=>allowed}};},event=>events.push(event));
 const request=(value=body,headers={},method='POST',query='')=>new Request(origin+'/api/account/notifications'+query,{method,headers:{host:'inbox.example.invalid',origin,'x-real-ip':'192.0.2.5','x-blizhniy-request':'1','content-type':'application/json',cookie:'__Host-blizhniy_session='+token,...headers},...(['GET','HEAD'].includes(method)?{}:{body:JSON.stringify(value)})});
 return{handler,request,calls,events,get factories(){return factories;}};}
test('inbox HTTP requires safe same-origin cookie ingress before private runtime construction',async()=>{
 for(const [headers,method,query,status] of [[{},'GET','',405],[{},'DELETE','',405],[{origin:'https://foreign.invalid'},'POST','',403],[{host:'foreign.invalid'},'POST','',403],
  [{'x-blizhniy-request':''},'POST','',403],[{'x-real-ip':''},'POST','',403],[{cookie:'',authorization:'Bearer synthetic'},'POST','',401],[{},'POST','?userId=other',400],[{'content-type':'text/plain'},'POST','',415]]){
  const f=fixture(),response=await f.handler(f.request(body,headers,method,query));assert.equal(response.status,status);assert.equal(f.factories,0);assert.deepEqual(f.calls,[]);
 }
});
test('inbox HTTP permits no arbitrary message creation, recipient override, malformed cursor or unbounded mutation',async()=>{
 for(const [value,method] of [[{...body,userId:owner},'POST'],[{...body,action:'create'},'PUT'],[body,'PUT'],[{...body,after:{id,updatedAt:'2026-10-18T12:00:00.123Z'}},'POST'],
  [{action:'read',expectedOwnerId:owner,ids:[]},'PUT'],[{action:'read',expectedOwnerId:owner,ids:Array(21).fill(id)},'PUT'],[{action:'read',expectedOwnerId:owner,ids:[id,id]},'PUT'],
  [{action:'dismiss',expectedOwnerId:owner,ids:['invalid']},'PUT'],[{action:'dismiss',expectedOwnerId:owner,ids:[id],title:'Injected'},'PUT']]){
  const f=fixture(),response=await f.handler(f.request(value,{},method));assert.equal(response.status,422);assert.equal(f.factories,0);
 }
});
test('inbox HTTP forwards exact expected owner and seen IDs, returns no-store, and audits no private values',async()=>{
 const f=fixture();const response=await f.handler(f.request());assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 assert.deepEqual(await response.json(),{items:[],nextCursor:null});assert.deepEqual(f.calls[0],['list',token,owner,null]);
 for(const action of ['read','dismiss']){
  const changed=await f.handler(f.request({action,expectedOwnerId:owner,ids:[id]}, {},'PUT'));
  assert.equal(changed.status,200);assert.deepEqual(await changed.json(),{ok:true});assert.deepEqual(f.calls.at(-1),['mark',token,owner,action,[id]]);
 }
 for(const privateValue of [token,owner,id])assert.equal(JSON.stringify(f.events).includes(privateValue),false);
});
test('inbox HTTP denies exhausted budgets and maps session or infrastructure failure without retry or leaks',async()=>{
 const limited=fixture(null,false),response=await limited.handler(limited.request());assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),'900');assert.deepEqual(limited.calls,[]);
 for(const [error,status,code] of [[new (loadAdminModule('app-session-transaction').AppSessionAccessError)(),401,'UNAUTHENTICATED'],[Error('secret /private/path'),503,'NOTIFICATIONS_UNAVAILABLE']]){
  const f=fixture(error),result=await f.handler(f.request());assert.equal(result.status,status);assert.deepEqual(await result.json(),{error:{code}});assert.equal(f.calls.length,1);
 }
});
