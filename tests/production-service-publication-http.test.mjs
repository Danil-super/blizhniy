import assert from 'node:assert/strict';import {test} from 'node:test';import {createRequire} from 'node:module';
import * as http from '../src/lib/auth-http.ts';import * as cookie from '../src/lib/account-cookie.ts';import * as proxy from '../src/lib/trusted-proxy-ip.ts';
import * as contract from '../src/lib/service-publication-contract.ts';import * as drafts from '../src/lib/listing-draft-contract.ts';
import {workPublicationModule} from './work-publication-module.mjs';import {loadAdminModule} from './admin-module.mjs';
const storage=workPublicationModule('postgres-service-publications',{'./service-publication-contract.ts':contract});
const {createProductionServicePublicationHandler}=workPublicationModule('production-service-publication-http',{
 'node:crypto':createRequire(import.meta.url)('node:crypto'),'./auth-http':http,'./account-cookie':cookie,'./trusted-proxy-ip':proxy,
 './app-session-transaction':loadAdminModule('app-session-transaction'),'./postgres-service-publications':storage,'./service-publication-contract.ts':contract,'./listing-draft-contract.ts':drafts});
const origin='https://service.example.invalid',owner='10000000-0000-4000-8000-000000000001',id='10000000-0000-4000-8000-000000000002',key='10000000-0000-4000-8000-000000000003',token='a'.repeat(64);
const body={action:'read',kind:'specialist',expectedOwnerId:owner,publicationId:id};
function fixture(error=null){const calls=[],events=[];let factories=0;
 const handler=createProductionServicePublicationHandler({origin},()=>{factories++;return{store:Object.fromEntries(['create','read','readIntent','list','update'].map(name=>[name,async(...args)=>{calls.push([name,...args]);if(error)throw error;return{name};}])),limiter:{allowProduction:async()=>true}};},event=>events.push(event));
 const request=(value=body,headers={},method='POST',query='')=>new Request(origin+'/api/account/service-publications'+query,{method,headers:{host:'service.example.invalid',origin,'x-real-ip':'192.0.2.5','x-blizhniy-request':'1','content-type':'application/json',cookie:'__Host-blizhniy_session='+token,...headers},...(['GET','HEAD'].includes(method)?{}:{body:JSON.stringify(value)})});
 return{handler,request,calls,events,get factories(){return factories;}};}
test('service HTTP rejects unsafe ingress and bearer-only authority before constructing private runtime',async()=>{
 for(const [headers,method,query,status] of [[{},'GET','',405],[{origin:'https://foreign.invalid'},'POST','',403],[{host:'foreign.invalid'},'POST','',403],
  [{'x-blizhniy-request':''},'POST','',403],[{'x-real-ip':''},'POST','',403],[{cookie:'',authorization:'Bearer synthetic'},'POST','',401],[{},'POST','?owner=bad',400],[{'content-type':'text/plain'},'POST','',415]]){
  const f=fixture(),response=await f.handler(f.request(body,headers,method,query));assert.equal(response.status,status);assert.equal(f.factories,0);assert.deepEqual(f.calls,[]);
 }
});
test('service HTTP requires exact distinct forms, decimal revision strings and strict read/write envelopes before SQL',async()=>{
 for(const [value,method] of [[{...body,kind:'vacancy'},'POST'],[{...body,extra:true},'POST'],[body,'PUT'],[{action:'create',kind:'specialist',expectedOwnerId:owner,creationKey:key,form:{paid:true}},'PUT'],
  [{action:'create',kind:'marquee',expectedOwnerId:owner,creationKey:key,form:{photoIds:[id]}},'PUT'],[{action:'update',kind:'fair',expectedOwnerId:owner,publicationId:id,expectedRevision:1,form:{}},'PUT']]){
  const f=fixture(),response=await f.handler(f.request(value,{},method));assert.equal(response.status,422);assert.equal(f.factories,0);
 }
});
test('service HTTP dispatch uses only cookie authority, exact owner/CAS/intent and no retry or private audit fields',async()=>{
 const f=fixture();
 for(const kind of ['specialist','fair','marquee']){
  const value={action:'create',kind,expectedOwnerId:owner,creationKey:key,form:{title:'Синтетическое сохранение'}};
  assert.equal((await f.handler(f.request(value,{authorization:'Bearer ignored'},'PUT'))).status,200);
  assert.deepEqual(f.calls.at(-1),['create',token,owner,kind,key,contract.parseServicePublicationForm(kind,value.form)]);
 }
 const update={action:'update',kind:'specialist',expectedOwnerId:owner,publicationId:id,expectedRevision:'9007199254740993',form:{}};
 assert.equal((await f.handler(f.request(update,{},'PUT'))).status,200);assert.equal(f.calls.at(-1)[5],'9007199254740993');
 const intent={action:'intent',kind:'fair',expectedOwnerId:owner,creationKey:key};assert.equal((await f.handler(f.request(intent))).status,200);assert.equal(f.calls.at(-1)[0],'readIntent');
 assert.equal(f.calls.length,5);const audit=JSON.stringify(f.events);for(const privateValue of [token,owner,id,key,'Синтетическое сохранение'])assert.equal(audit.includes(privateValue),false);
});
test('service HTTP maps foreign, conflict, invalid-session and infrastructure failures without leaking details or retrying',async()=>{
 for(const [error,status,code] of [[new storage.ServicePublicationAccessError(),404,'PUBLICATION_NOT_FOUND'],[new storage.ServicePublicationConflictError(),409,'PUBLICATION_CHANGED'],
  [new contract.ServicePublicationInputError(),422,'INVALID_INPUT'],[new (loadAdminModule('app-session-transaction').AppSessionAccessError)(),401,'UNAUTHENTICATED'],[Error('secret /private/path'),503,'SERVICE_PUBLICATIONS_UNAVAILABLE']]){
  const f=fixture(error),response=await f.handler(f.request());assert.equal(response.status,status);assert.deepEqual(await response.json(),{error:{code}});assert.equal(f.calls.length,1);
 }
});
