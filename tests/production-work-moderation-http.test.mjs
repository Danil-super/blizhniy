import assert from 'node:assert/strict';import {test} from 'node:test';import {createRequire} from 'node:module';
import * as boundary from '../src/lib/auth-http.ts';import * as cookie from '../src/lib/account-cookie.ts';import * as proxy from '../src/lib/trusted-proxy-ip.ts';
import * as draft from '../src/lib/listing-draft-contract.ts';import * as decisions from '../src/lib/work-moderation-contract.ts';
import {loadAdminModule} from './admin-module.mjs';import {workPublicationModule} from './work-publication-module.mjs';
import {productionMediaAdmission} from '../src/lib/production-media-http.ts';
const storage=workPublicationModule('postgres-work-publications'),session=loadAdminModule('app-session-transaction'),admin=loadAdminModule('admin-authorization');
const {createProductionWorkModerationHandler}=workPublicationModule('production-work-moderation-http',{
 'node:crypto':createRequire(import.meta.url)('node:crypto'),'./auth-http':boundary,'./account-cookie':cookie,'./trusted-proxy-ip':proxy,
 './app-session-transaction':session,'./admin-authorization':admin,'./postgres-work-publications':storage,'./listing-draft-contract.ts':draft,'./work-moderation-contract':decisions,
 './production-media-http':{productionMediaAdmission},
});
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',token='a'.repeat(64),origin='https://synthetic.invalid';
const body={expectedOwnerId:owner,kind:'vacancy',publicationId:id,expectedRevision:'9007199254740993'};
function fixture(mode='owner',error=null){const calls=[],events=[];let factories=0;
 const store=Object.fromEntries(['read','submit','list','inspect','decide','readPhoto'].map(name=>[name,async(...args)=>{calls.push([name,args]);if(error)throw error;return {id,revision:body.expectedRevision,state:'pending',note:null};}]));
 const handle=createProductionWorkModerationHandler({origin},mode,()=>{factories++;return{store,limiter:{allowProduction:async()=>true}};},event=>events.push(event));
 const request=(value=body,method='POST',headers={})=>new Request(origin+'/api/'+(mode==='admin'?'admin':'account')+'/work-moderation',{method,
  headers:{host:'synthetic.invalid',origin,'x-blizhniy-request':'1','x-real-ip':'192.0.2.1','content-type':'application/json',cookie:'__Host-blizhniy_session='+token,...headers},body:JSON.stringify(value)});
 return{calls,events,handle,request,get factories(){return factories;}};}
test('work moderation owner boundary binds cookie owner, kind and exact revision for read and submit',async()=>{
 const f=fixture();for(const method of ['POST','PUT']){const response=await f.handle(f.request(body,method));assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');}
 assert.deepEqual(f.calls,[['read',[token,owner,'vacancy',id,body.expectedRevision]],['submit',[token,owner,'vacancy',id,body.expectedRevision]]]);
 for(const bad of [{...body,kind:'listing'},{...body,expectedRevision:1},{...body,role:'admin'},{action:'list',expectedAdminId:owner,after:null}]){
  const before=f.factories,response=await f.handle(f.request(bad));assert.equal(response.status,422);assert.equal(f.factories,before);}
});
test('work moderation admin actions validate exact claims and call independently authorized storage',async()=>{
 const f=fixture('admin');
 for(const [value,method,name,args] of [[{expectedAdminId:owner,action:'list',after:null},'POST','list',[token,null,owner]],
  [{expectedAdminId:owner,action:'inspect',requestId:id},'POST','inspect',[token,id,owner]],
  [{expectedAdminId:owner,requestId:id,state:'rejected',note:'Уточните описание.'},'PUT','decide',[token,id,'rejected','Уточните описание.',owner]]]){
  assert.equal((await f.handle(f.request(value,method))).status,200);assert.deepEqual(f.calls.at(-1),[name,args]);}
 for(const value of [{expectedAdminId:owner,action:'list',after:1},{expectedAdminId:owner,action:'inspect',requestId:id,role:'admin'},body])assert.equal((await f.handle(f.request(value))).status,422);
});
test('work moderation rejects CSRF, spoofed proxy and bearer-only before any runtime is created',async()=>{
 for(const headers of [{origin:'https://bad.invalid'},{'x-real-ip':''},{cookie:'',authorization:'Bearer '+token}]){const f=fixture(),response=await f.handle(f.request(body,'PUT',headers));assert.ok([401,403].includes(response.status));assert.equal(f.factories,0);}
});
test('work moderation typed failures remain generic, audited without input and never retried',async()=>{
 for(const [error,status,code] of [[new session.AppSessionAccessError(),401,'UNAUTHENTICATED'],[new admin.AdminAccessError(),403,'ADMIN_REQUIRED'],
  [new storage.WorkPublicationAccessError(),404,'PUBLICATION_NOT_FOUND'],[new storage.WorkPublicationConflictError(),409,'PUBLICATION_CHANGED'],
  [new decisions.WorkModerationInputError(),422,'INVALID_INPUT'],[new Error('SQL synthetic-secret@example.invalid'),503,'WORK_MODERATION_UNAVAILABLE']]){
  const f=fixture('owner',error),response=await f.handle(f.request(body,'PUT'));assert.equal(response.status,status);assert.deepEqual(await response.json(),{error:{code}});assert.equal(f.calls.length,1);
  const audit=JSON.stringify(f.events);for(const value of [owner,id,token,'SQL','synthetic-secret@example.invalid'])assert.equal(audit.includes(value),false);}
});
test('work moderation private photos share the existing site-wide read cap and release capacity on malformed bytes',async()=>{
 let reads=0,malformed=false;
 const f=fixture('admin'),handle=createProductionWorkModerationHandler({origin},'admin',()=>({limiter:{allowProduction:async()=>true},store:{
  readPhoto:async(...args)=>{reads++;assert.deepEqual(args,[token,id,id,owner]);return{record:{mimeType:'image/webp',size:12,sha256:'synthetic-private-hash'},bytes:Buffer.alloc(malformed?13:12)};},
 }}),()=>{}),body={expectedAdminId:owner,action:'photo',requestId:id,fileId:id};
 productionMediaAdmission.reads=4;
 try{const response=await handle(f.request(body));assert.equal(response.status,503);assert.equal(reads,0);assert.equal(response.headers.get('retry-after'),'1');}
 finally{productionMediaAdmission.reads=0;}
 const response=await handle(f.request(body));assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/webp');assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.arrayBuffer()).byteLength,12);
 assert.equal(productionMediaAdmission.reads,0);malformed=true;assert.equal((await handle(f.request(body))).status,503);assert.equal(productionMediaAdmission.reads,0);
});
