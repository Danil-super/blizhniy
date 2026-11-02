import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import * as boundary from '../src/lib/auth-http.ts';
import * as cookie from '../src/lib/account-cookie.ts';
import * as proxy from '../src/lib/trusted-proxy-ip.ts';
import * as drafts from '../src/lib/listing-draft-contract.ts';
import * as work from '../src/lib/work-publication-contract.ts';
import * as service from '../src/lib/service-publication-contract.ts';
import * as decisions from '../src/lib/work-moderation-contract.ts';
import {createWorkPublicationClient,parseWorkPublicationSnapshot} from '../src/lib/client-work-publications.ts';
import {createWorkModerationClient} from '../src/lib/client-work-moderation.ts';
import {createServicePublicationClient,createServiceModerationClient,parseServicePublicationSnapshot} from '../src/lib/client-service-publications.ts';
import {loadAdminModule} from './admin-module.mjs';
import {workPublicationModule} from './work-publication-module.mjs';

const session=loadAdminModule('app-session-transaction'),admin=loadAdminModule('admin-authorization');
const workStorage=workPublicationModule('postgres-work-publications');
const serviceStorage=workPublicationModule('postgres-service-publications',{'./service-publication-contract.ts':service});
const deps={'node:crypto':createRequire(import.meta.url)('node:crypto'),'./auth-http':boundary,'./account-cookie':cookie,'./trusted-proxy-ip':proxy,
 './app-session-transaction':session,'./admin-authorization':admin,'./postgres-work-publications':workStorage,'./postgres-service-publications':serviceStorage,
 './work-publication-contract':work,'./service-publication-contract.ts':service,'./listing-draft-contract':drafts,'./listing-draft-contract.ts':drafts,
 './work-moderation-contract':decisions,'./production-media-http':{productionMediaAdmission:{reads:0}}};
const modules={
 workPublication:workPublicationModule('production-work-publication-http',deps).createProductionWorkPublicationHandler,
 servicePublication:workPublicationModule('production-service-publication-http',deps).createProductionServicePublicationHandler,
 workModeration:workPublicationModule('production-work-moderation-http',deps).createProductionWorkModerationHandler,
 serviceModeration:workPublicationModule('production-service-moderation-http',deps).createProductionServiceModerationHandler,
};
const origin='https://wire.example.invalid',owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
const professionId='33333333-3333-4333-8333-333333333333',reviewId='44444444-4444-4444-8444-444444444444',token='a'.repeat(64),stamp='2026-10-30T00:00:00.123456Z';
const capability='x-blizhniy-profession-refs';
function snapshot(kind){return{id,kind,professionId,form:(kind==='specialist'?service.parseServicePublicationForm:work.parseWorkPublicationForm)(kind,
 {title:'Синтетический материал',professionName:'Синтетический мастер',professionId}),photos:[],revision:'7',status:'draft',paid:false,
 createdAt:stamp,updatedAt:stamp,publishedAt:null,expiresAt:null};}
function withoutReferences(row){const {professionId:reference,form,...other}=row;const {professionId:formReference,...legacyForm}=form;
 assert.equal(reference,professionId);assert.equal(formReference,professionId);return{...other,form:legacyForm};}
function fixture(name,{error}={}){
 const moderation=name.endsWith('Moderation'),kind=name.startsWith('service')?'specialist':'workRequest',row=snapshot(kind);
 const detail={request:{id:reviewId,revision:'7',state:'pending',note:null},snapshot:row,issues:[]};
 const calls=[];let factories=0;
 const store=Object.fromEntries(['read','inspect'].map(method=>[method,async(...args)=>{calls.push([method,args]);if(error)throw error;return moderation?detail:row;}]));
 const runtime=()=>{factories++;return{store,limiter:{allowProduction:async()=>true}};};
 const handle=moderation?modules[name]({origin},'admin',runtime,()=>{}):modules[name]({origin},runtime,()=>{});
 const body=moderation?{expectedAdminId:owner,action:'inspect',requestId:reviewId,...(kind==='specialist'?{kind}:{})}:
  {expectedOwnerId:owner,action:'read',publicationId:id,kind};
 const request=(headers={})=>new Request(origin+'/api/synthetic-wire',{method:'POST',headers:{host:'wire.example.invalid',origin,
  'x-real-ip':'192.0.2.5','x-blizhniy-request':'1','content-type':'application/json',cookie:'__Host-blizhniy_session='+token,...headers},body:JSON.stringify(body)});
 return{kind,row,detail,moderation,handle,request,calls,get factories(){return factories;}};
}

for(const name of Object.keys(modules)){
 test(`${name}: actual HTTP serializer negotiates both snapshot and form UUID fields, retaining legacy shape`,async()=>{
  for(const header of [undefined,'true','1']){
   const f=fixture(name),reply=await f.handle(f.request(header===undefined?{}:{[capability]:header}));assert.equal(reply.status,200);
   const expected=header==='1'?f.row:withoutReferences(f.row);
   assert.deepEqual(await reply.json(),f.moderation?{...f.detail,snapshot:expected}:expected);
   assert.equal(reply.headers.get('cache-control'),'no-store');assert.equal(f.factories,1);assert.equal(f.calls.length,1);
   assert.deepEqual(f.calls[0],f.moderation?['inspect',f.kind==='specialist'?[token,f.kind,reviewId,owner]:[token,reviewId,owner]]:['read',[token,owner,f.kind,id]]);
   assert.equal(f.row.professionId,professionId);assert.equal(f.row.form.professionId,professionId);
  }
 });
 test(`${name}: capability cannot replace a cookie, same-origin request or current store authorization`,async()=>{
  for(const [headers,status] of [[{cookie:'',authorization:'Bearer synthetic'},401],[{origin:'https://foreign.example.invalid'},403],[{'x-blizhniy-request':''},403]]){
   const f=fixture(name),reply=await f.handle(f.request({[capability]:'1',...headers}));assert.equal(reply.status,status);
   assert.equal(f.factories,0);assert.deepEqual(f.calls,[]);assert.deepEqual(Object.keys(await reply.json()),['error']);
  }
  const f=fixture(name,{error:new session.AppSessionAccessError()}),reply=await f.handle(f.request({[capability]:'1'}));
  assert.equal(reply.status,401);assert.deepEqual(await reply.json(),{error:{code:'UNAUTHENTICATED'}});assert.equal(f.calls.length,1);
 });
 test(`${name}: updated client advertises capability and parses modern and legacy HTTP replies`,async()=>{
  for(const legacy of [false,true]){
   const f=fixture(name),calls=[];
   const transport=async(path,init)=>{
    calls.push({path,init});const headers=new Headers(init.headers);assert.equal(headers.get(capability),'1');
    assert.equal(headers.get('authorization'),null);assert.equal(init.credentials,'same-origin');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');
    if(legacy)headers.delete(capability);
    headers.set('host','wire.example.invalid');headers.set('origin',origin);headers.set('x-real-ip','192.0.2.5');headers.set('cookie','__Host-blizhniy_session='+token);
    return f.handle(new Request(origin+path,{...init,headers}));
   };
   let result;
   if(f.moderation){
    const item={id:reviewId,publicationId:id,kind:f.kind,revision:'7',title:f.row.form.title,updatedAt:stamp};
    result=name==='workModeration'?await createWorkModerationClient(transport).adminInspect(owner,item):await createServiceModerationClient(transport).adminInspect(owner,f.kind,item);
   }else result=name==='workPublication'?await createWorkPublicationClient(transport).read(owner,f.kind,id):await createServicePublicationClient(transport).read(owner,f.kind,id);
   const expected=legacy?withoutReferences(f.row):f.row;
   assert.deepEqual(result,f.moderation?{...f.detail,snapshot:expected}:expected);assert.equal(calls.length,1);
   assert.equal(calls[0].path,'/api/'+(f.moderation?'admin/':'account/')+(name.startsWith('work')?'work-':'service-')+(f.moderation?'moderation':'publications'));
  }
 });
}

test('updated snapshot parsers refuse mismatched selected UUIDs and unknown reference fields',()=>{
 for(const [kind,parse] of [['workRequest',parseWorkPublicationSnapshot],['specialist',parseServicePublicationSnapshot]]){
  const row=snapshot(kind);assert.deepEqual(parse(row,kind,id),row);
  for(const bad of [{...row,professionId:owner},{...row,professionId:null},{...row,professionId:'invalid'},
   {...row,professionAuthority:'synthetic'},{...row,form:{...row.form,professionAuthority:'synthetic'}}])assert.throws(()=>parse(bad,kind,id));
 }
});
