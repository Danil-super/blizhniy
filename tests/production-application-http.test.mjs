import assert from 'node:assert/strict';import {test} from 'node:test';import {createRequire} from 'node:module';
import * as http from '../src/lib/auth-http.ts';import * as cookie from '../src/lib/account-cookie.ts';import * as proxy from '../src/lib/trusted-proxy-ip.ts';import * as drafts from '../src/lib/listing-draft-contract.ts';
import * as contract from '../src/lib/application-contract.ts';import {workPublicationModule} from './work-publication-module.mjs';import {loadAdminModule} from './admin-module.mjs';
const {ApplicationAccessError,ApplicationConflictError,ApplicationEligibilityError,ApplicationBusyError}=workPublicationModule('postgres-applications',{
 './application-contract.ts':contract,'./service-publication-contract.ts':{},'./postgres-notification-inbox':{},'./postgres-public-work':{},'./postgres-public-service':{}});
const {createProductionApplicationHandler}=workPublicationModule('production-application-http',{
 'node:crypto':createRequire(import.meta.url)('node:crypto'),'./auth-http':http,'./account-cookie':cookie,'./trusted-proxy-ip':proxy,'./app-session-transaction':loadAdminModule('app-session-transaction'),
 './listing-draft-contract.ts':drafts,'./application-contract.ts':contract,'./postgres-applications':{ApplicationAccessError,ApplicationConflictError,ApplicationEligibilityError,ApplicationBusyError}});
const origin='https://applications.example.invalid',owner='10000000-0000-4000-8000-000000000001',id='10000000-0000-4000-8000-000000000002',token='a'.repeat(64);
const base={expectedOwnerId:owner},body={...base,action:'read',applicationId:id},create={kind:'vacancy',targetId:id,creationKey:id,specialistId:id,expectedTargetRevision:'9007199254740993',expectedSpecialistRevision:'1',message:'Технический отклик'};
function fixture(error=null,allowed=true){let factories=0;const calls=[],events=[];
 const handler=createProductionApplicationHandler({origin},()=>{factories++;return{store:Object.fromEntries(['preview','read','readIntent','list','create','update','decide'].map(name=>[name,async(...args)=>{calls.push([name,...args]);if(error)throw error;return{name};}])),limiter:{allowProduction:async()=>allowed}};},event=>events.push(event));
 const request=(value=body,headers={},method='POST',query='')=>new Request(origin+'/api/account/applications'+query,{method,headers:{host:'applications.example.invalid',origin,'x-real-ip':'192.0.2.5','x-blizhniy-request':'1','content-type':'application/json',cookie:'__Host-blizhniy_session='+token,...headers},...(['GET','HEAD'].includes(method)?{}:{body:JSON.stringify(value)})});
 return{handler,request,calls,events,get factories(){return factories;}};
}
test('application HTTP rejects unsafe ingress, alternate authority and unbounded request bodies before private runtime',async()=>{
 for(const [headers,method,query,status] of [[{},'GET','',405],[{origin:'https://foreign.invalid'},'POST','',403],[{host:'foreign.invalid'},'POST','',403],
  [{'x-blizhniy-request':''},'POST','',403],[{'x-real-ip':''},'POST','',403],[{cookie:'',authorization:'Bearer synthetic'},'POST','',401],[{},'POST','?userId=other',400],
  [{'content-type':'text/plain'},'POST','',415],[{'content-length':'17000'},'PUT','',413]]){
  const f=fixture(),response=await f.handler(f.request(body,headers,method,query));assert.equal(response.status,status);assert.equal(f.factories,0);assert.deepEqual(f.calls,[]);
 }
});
test('application HTTP validates exact independent read/write envelopes, string revisions and allows no claimed snapshot or financial status',async()=>{
 for(const [value,method] of [[{...body,extra:true},'POST'],[body,'PUT'],[{...base,action:'list',mode:'admin',after:null},'POST'],[{...base,action:'create',input:{...create,snapshot:{name:'Forged'}}},'PUT'],
  [{...base,action:'create',input:{...create,is_paid:true}},'PUT'],[{...base,action:'create',input:{...create,expectedTargetRevision:1}},'PUT'],[{...base,action:'decide',applicationId:id,expectedRevision:'1',state:'paid'},'PUT'],
  [{...base,action:'preview',kind:'fair',targetId:id},'POST'],[{...base,action:'update',input:create},'PUT']]){
  const f=fixture(),response=await f.handler(f.request(value,{},method));assert.equal(response.status,422);assert.equal(f.factories,0);
 }
});
test('application HTTP dispatch binds cookie, expected owner, canonical input, exact CAS and readback without private audit fields',async()=>{
 const f=fixture();assert.equal((await f.handler(f.request({...base,action:'create',input:create},{},'PUT'))).status,200);assert.deepEqual(f.calls.at(-1),['create',token,owner,contract.parseApplicationCreate(create)]);
 for(const [value,method,name] of [[{...base,action:'preview',kind:'workRequest',targetId:id},'POST','preview'],[{...base,action:'intent',creationKey:id},'POST','readIntent'],
  [{...base,action:'list',mode:'recipient',after:null},'POST','list'],[{...base,action:'decide',applicationId:id,expectedRevision:'9007199254740993',state:'selected'},'PUT','decide']]){
  assert.equal((await f.handler(f.request(value,{},method))).status,200);assert.equal(f.calls.at(-1)[0],name);
 }
 assert.equal(f.calls.at(-1)[4],'9007199254740993');for(const secret of [token,owner,id,create.message])assert.equal(JSON.stringify(f.events).includes(secret),false);
});
test('application HTTP maps access, eligibility, busy, conflict and unknown infrastructure outcomes without retry or detail leaks',async()=>{
 for(const [error,status,code] of [[new ApplicationAccessError(),404,'APPLICATION_NOT_FOUND'],[new ApplicationConflictError(),409,'APPLICATION_CHANGED'],[new ApplicationEligibilityError(),409,'SPECIALIST_REQUIRED'],[new ApplicationBusyError(),409,'APPLICATION_BUSY'],
  [new (loadAdminModule('app-session-transaction').AppSessionAccessError)(),401,'UNAUTHENTICATED'],[Error('secret /private/path'),503,'APPLICATIONS_UNAVAILABLE']]){
  const f=fixture(error),result=await f.handler(f.request());assert.equal(result.status,status);assert.deepEqual(await result.json(),{error:{code}});assert.equal(f.calls.length,1);
 }
 const f=fixture(null,false),result=await f.handler(f.request());assert.equal(result.status,429);assert.equal(result.headers.get('retry-after'),'900');assert.deepEqual(f.calls,[]);
});
