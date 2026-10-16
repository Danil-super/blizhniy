import assert from 'node:assert/strict';import {test} from 'node:test';
import {createAdminListingModerationHandler} from './admin-listing-moderation-http-module.mjs';
import {productionMediaAdmission} from '../src/lib/production-media-http.ts';
import {loadAdminModule} from './admin-module.mjs';
const origin='https://moderation.example.invalid',admin='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
function request(body,method='POST',extra={}){return new Request(origin+'/api/admin/listing-moderation',{method,headers:{host:'moderation.example.invalid',origin,'x-blizhniy-request':'1','x-real-ip':'192.0.2.4','content-type':'application/json',cookie:'__Host-blizhniy_session='+'a'.repeat(64),...extra},body:JSON.stringify({expectedAdminId:admin,...body})});}
test('admin moderation requires strict cookie-bound actions, not client roles, prices or publication status',async()=>{
 let calls=0;const handle=createAdminListingModerationHandler({origin},()=>{calls++;assert.fail();},()=>{});
 for(const [body,method,headers,status] of [[{action:'list',after:null,role:'admin'},'POST',{},422],[{requestId:id,state:'published',note:null},'PUT',{},422],
  [{action:'inspect',requestId:id},'POST',{origin:'https://bad.invalid'},403],[{action:'list',after:null},'POST',{cookie:'',authorization:'Bearer legacy'},401]])
  assert.equal((await handle(request(body,method,headers))).status,status);
 assert.equal(calls,0);
});
test('admin actions pass the expected account and exact request into guarded repositories without retry or sensitive audit',async()=>{
 const calls=[],events=[];const handle=createAdminListingModerationHandler({origin},()=>({limiter:{allowProduction:async()=>true},identity:{resolveSession:async()=>({id:admin,role:'admin'})},store:{
  list:async(...args)=>{calls.push(args);return{items:[],nextCursor:null};},inspect:async()=>{throw new (loadAdminModule('admin-authorization').AdminAccessError)();},
  decide:async(...args)=>{calls.push(args);throw Error('private-contact-password');},
 }}),event=>events.push(event));
 assert.equal((await handle(request({action:'list',after:null}))).status,200);assert.deepEqual(calls[0],['a'.repeat(64),null,admin]);
 assert.equal((await handle(request({action:'inspect',requestId:id}))).status,403);
 const failed=await handle(request({requestId:id,state:'approved',note:null},'PUT'));assert.equal(failed.status,503);assert.equal(calls.length,2);
 assert.deepEqual(calls[1],['a'.repeat(64),id,'approved',null,admin]);
 for(const value of [admin,id,'a'.repeat(64),'private-contact'])assert.equal(JSON.stringify(events).includes(value),false);
});
test('moderator image bytes share the existing four-read admission cap and never return hashes or paths',async()=>{
 let reads=0;const handle=createAdminListingModerationHandler({origin},()=>({limiter:{allowProduction:async()=>true},identity:{resolveSession:async()=>({id:admin,role:'admin'})},store:{
  readPhoto:async(...args)=>{reads++;assert.deepEqual(args,['a'.repeat(64),id,id,admin]);return{record:{mimeType:'image/webp',size:12,sha256:'private-hash'},bytes:Buffer.alloc(12)};},
 }}),()=>{});
 productionMediaAdmission.reads=4;
 try{const denied=await handle(request({action:'photo',requestId:id,fileId:id}));assert.equal(denied.status,503);assert.equal(reads,0);}
 finally{productionMediaAdmission.reads=0;}
 const response=await handle(request({action:'photo',requestId:id,fileId:id}));assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/webp');assert.equal(response.headers.get('cache-control'),'no-store');
 assert.match(response.headers.get('content-security-policy'),/default-src 'none'/);assert.equal((await response.arrayBuffer()).byteLength,12);assert.equal(productionMediaAdmission.reads,0);
});
