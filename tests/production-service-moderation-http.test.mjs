import assert from 'node:assert/strict';import {test} from 'node:test';import {createRequire} from 'node:module';
import * as http from '../src/lib/auth-http.ts';import * as cookie from '../src/lib/account-cookie.ts';import * as proxy from '../src/lib/trusted-proxy-ip.ts';
import * as contract from '../src/lib/service-publication-contract.ts';import * as drafts from '../src/lib/listing-draft-contract.ts';import * as decisions from '../src/lib/work-moderation-contract.ts';
import {workPublicationModule} from './work-publication-module.mjs';import {loadAdminModule} from './admin-module.mjs';
const storage=workPublicationModule('postgres-service-publications',{'./service-publication-contract.ts':contract}),admission={reads:0};
const {createProductionServiceModerationHandler}=workPublicationModule('production-service-moderation-http',{
 'node:crypto':createRequire(import.meta.url)('node:crypto'),'./auth-http':http,'./account-cookie':cookie,'./trusted-proxy-ip':proxy,
 './app-session-transaction':loadAdminModule('app-session-transaction'),'./admin-authorization':loadAdminModule('admin-authorization'),
 './postgres-service-publications':storage,'./listing-draft-contract.ts':drafts,'./work-moderation-contract':decisions,'./production-media-http':{productionMediaAdmission:admission}});
const origin='https://review.example.invalid',actor='10000000-0000-4000-8000-000000000001',id='10000000-0000-4000-8000-000000000002',file='10000000-0000-4000-8000-000000000003',token='b'.repeat(64);
function fixture(mode='admin',error=null){const calls=[],events=[];let factories=0;
 const handler=createProductionServiceModerationHandler({origin},mode,()=>{factories++;return{store:Object.fromEntries(['submit','read','list','inspect','decide','readPhoto'].map(name=>[name,async(...args)=>{calls.push([name,...args]);if(error)throw error;return name==='readPhoto'?{record:{id:file,mimeType:'image/webp',size:12},bytes:Buffer.alloc(12)}:{name};}])),limiter:{allowProduction:async()=>true}};},event=>events.push(event));
 const request=(value,method='POST',headers={})=>new Request(origin+'/api/'+(mode==='admin'?'admin':'account')+'/service-moderation',{method,headers:{host:'review.example.invalid',origin,'x-real-ip':'192.0.2.5','x-blizhniy-request':'1','content-type':'application/json',cookie:'__Host-blizhniy_session='+token,...headers},body:JSON.stringify(value)});
 return{handler,request,calls,events,get factories(){return factories;}};}
test('service review ingress refuses forged kinds, extra authority, cross-origin and bearer-only requests before private runtime',async()=>{
 const body={expectedAdminId:actor,kind:'specialist',action:'list',after:null};
 for(const [value,headers,status] of [[body,{origin:'https://foreign.invalid'},403],[body,{cookie:'',authorization:'Bearer synthetic'},401],[{...body,kind:'vacancy'},{},422],[{...body,paid:true},{},422]]){
  const f=fixture(),response=await f.handler(f.request(value,'POST',headers));assert.equal(response.status,status);assert.equal(f.factories,0);assert.deepEqual(f.calls,[]);
 }
});
test('service review actions bind the exact owner/admin kind, resource, revision and validated decision, without retry or private audit',async()=>{
 const owner=fixture('owner'),body={expectedOwnerId:actor,kind:'fair',publicationId:id,expectedRevision:'9007199254740993'};
 assert.equal((await owner.handler(owner.request(body,'PUT'))).status,200);assert.deepEqual(owner.calls,[['submit',token,actor,'fair',id,'9007199254740993']]);
 const admin=fixture();for(const [value,method,expected] of [[{expectedAdminId:actor,kind:'marquee',action:'list',after:null},'POST',['list',token,'marquee',null,actor]],
  [{expectedAdminId:actor,kind:'specialist',action:'inspect',requestId:id},'POST',['inspect',token,'specialist',id,actor]],
  [{expectedAdminId:actor,kind:'fair',requestId:id,state:'rejected',note:'Уточните материалы.'},'PUT',['decide',token,'fair',id,'rejected','Уточните материалы.',actor]]]){
  assert.equal((await admin.handler(admin.request(value,method))).status,200);assert.deepEqual(admin.calls.at(-1),expected);
 }
 const audit=JSON.stringify([...owner.events,...admin.events]);for(const value of [token,actor,id,'Уточните материалы.'])assert.equal(audit.includes(value),false);
});
test('service moderator photos share the existing four-read cap and return only bounded image bytes with no-store headers',async()=>{
 const body={expectedAdminId:actor,kind:'fair',action:'photo',requestId:id,fileId:file};admission.reads=4;
 try{const f=fixture(),response=await f.handler(f.request(body));assert.equal(response.status,503);assert.equal(response.headers.get('retry-after'),'1');assert.deepEqual(f.calls,[]);assert.equal(admission.reads,4);}
 finally{admission.reads=0;}
 const f=fixture(),response=await f.handler(f.request(body));assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/webp');assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.arrayBuffer()).byteLength,12);assert.equal(admission.reads,0);
 const failed=fixture('admin',Error('private path'));assert.equal((await failed.handler(failed.request(body))).status,503);assert.equal(admission.reads,0);
});
