import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import * as boundary from '../src/lib/auth-http.ts';
import * as cookie from '../src/lib/account-cookie.ts';
import * as proxy from '../src/lib/trusted-proxy-ip.ts';
import * as contract from '../src/lib/work-publication-contract.ts';
import * as drafts from '../src/lib/listing-draft-contract.ts';
import {workPublicationModule} from './work-publication-module.mjs';
import {loadAdminModule} from './admin-module.mjs';

const session=loadAdminModule('app-session-transaction');
const storage=workPublicationModule('postgres-work-publications');
const {createProductionWorkPublicationHandler}=workPublicationModule('production-work-publication-http',{
 'node:crypto':createRequire(import.meta.url)('node:crypto'),'./auth-http':boundary,'./account-cookie':cookie,
 './trusted-proxy-ip':proxy,'./app-session-transaction':session,'./postgres-work-publications':storage,
 './work-publication-contract':contract,'./listing-draft-contract':drafts,
});
const origin='https://work.example.invalid',owner='11111111-1111-4111-8111-111111111111';
const other='33333333-3333-4333-8333-333333333333',id='22222222-2222-4222-8222-222222222222';
const creationKey='44444444-4444-4444-8444-444444444444',token='a'.repeat(64),revision='9007199254740993';
const readBody={action:'read',kind:'vacancy',expectedOwnerId:owner,publicationId:id};
const createBody={action:'create',kind:'vacancy',expectedOwnerId:owner,creationKey,
 form:{kind:'vacancy',title:'Synthetic private vacancy',contactPerson:'Synthetic contact',email:'owner@example.invalid',contactPhone:'+79990000000',salary:'12.1'}};
const updateBody={action:'update',kind:'vacancy',expectedOwnerId:owner,publicationId:id,expectedRevision:revision,form:createBody.form};
function fixture(options={}){
 const calls={factories:0,operations:[],limits:[],events:[]};
 const snapshot={id,kind:'vacancy',revision:'9007199254740994',status:'draft',paid:false,
  form:contract.parseWorkPublicationForm('vacancy',createBody.form),photos:[],createdAt:'2026-10-18T00:00:00.000001Z',
  updatedAt:'2026-10-18T00:00:00.000002Z',publishedAt:null,expiresAt:null};
 const result={list:{items:[],nextCursor:null},read:snapshot,create:snapshot,update:snapshot,
  readIntent:Object.hasOwn(options,'intent')?options.intent:snapshot};
 const perform=async(name,args)=>{calls.operations.push([name,args]);if(options.error)throw options.error;
  if(options.deniedOwner&&args[1]!==owner)throw new storage.WorkPublicationAccessError();return result[name];};
 const handle=createProductionWorkPublicationHandler({origin},()=>{
  calls.factories++;if(options.outage)throw new Error('Synthetic private runtime SQL failure');
  return {store:Object.fromEntries(['create','read','readIntent','list','update'].map(name=>[name,(...args)=>perform(name,args)])),
   limiter:{allowProduction:async(...args)=>{calls.limits.push(args);if(options.rateOutage)throw new Error('Synthetic private limiter failure');return !options.limited;}}};
 },event=>calls.events.push(event));
 const request=(body=readBody,headers={},method='POST',query='')=>new Request(origin+'/api/account/work-publications'+query,{
  method,headers:{host:new URL(origin).host,origin,'x-blizhniy-request':'1','x-real-ip':'192.0.2.4','content-type':'application/json',
   cookie:'__Host-blizhniy_session='+token,...headers},...(['GET','HEAD'].includes(method)?{}:{body:JSON.stringify(body)}),
 });
 return {handle,request,calls,result};
}

test('work publication ingress rejects wrong methods, CSRF, queries, proxy spoofing and Bearer authority before runtime',async()=>{
 for(const [headers,method,query,status,code] of [
  [{},'GET','',405,'METHOD_NOT_ALLOWED'],[{},'HEAD','',405,'METHOD_NOT_ALLOWED'],[{},'DELETE','',405,'METHOD_NOT_ALLOWED'],
  [{origin:'https://attacker.invalid'},'POST','',403,'FORBIDDEN_ORIGIN'],[{origin:''},'POST','',403,'FORBIDDEN_ORIGIN'],
  [{host:'attacker.invalid'},'POST','',403,'FORBIDDEN_TARGET'],[{'x-blizhniy-request':''},'POST','',403,'FORBIDDEN_ORIGIN'],
  [{'sec-fetch-site':'cross-site'},'POST','',403,'FORBIDDEN_ORIGIN'],[{},'POST','?owner='+owner,400,'QUERY_NOT_ALLOWED'],
  [{'content-type':'text/plain'},'POST','',415,'JSON_REQUIRED'],
  [{'x-real-ip':'','x-forwarded-for':'192.0.2.4','cf-connecting-ip':'192.0.2.4'},'POST','',403,'UNTRUSTED_INGRESS'],
  [{'x-real-ip':'192.0.2.4, 192.0.2.5'},'POST','',403,'UNTRUSTED_INGRESS'],
  [{cookie:'',authorization:'Bearer '+token},'POST','',401,'UNAUTHENTICATED'],
  [{cookie:'__Host-blizhniy_session=malformed'},'POST','',401,'UNAUTHENTICATED'],
  [{cookie:'__Host-blizhniy_session='+token+'; __Host-blizhniy_session='+token},'POST','',401,'UNAUTHENTICATED'],
 ]){
  const f=fixture(),response=await f.handle(f.request(readBody,headers,method,query));
  assert.equal(response.status,status);assert.deepEqual(await response.json(),{error:{code}});assert.equal(f.calls.factories,0);
  assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('referrer-policy'),'no-referrer');
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.match(response.headers.get('x-request-id'),/^[a-f0-9-]{36}$/);
  if(status===405)assert.equal(response.headers.get('allow'),'POST, PUT');
 }
});

test('work publication exact action envelopes reject missing, unknown, privileged and inexact claims before runtime',async()=>{
 const list={action:'list',kind:'workRequest',expectedOwnerId:owner,after:null};
 const intent={action:'intent',kind:'vacancy',expectedOwnerId:owner,creationKey};
 const cases=[[null,'POST'],[[],'POST'],[{},'POST'],[{...readBody,ownerId:other},'POST'],
  [{...readBody,expectedOwnerId:'bad'},'POST'],[{...readBody,publicationId:'bad'},'POST'],
  [{...readBody,kind:'listing'},'POST'],[{...readBody,kind:'work_request'},'POST'],
  [{...readBody,kind:['vacancy']},'POST'],[{...readBody,kind:{toString:'vacancy'}},'POST'],
  [{...readBody,action:'create'},'POST'],[{...createBody,action:'list'},'PUT'],[readBody,'PUT'],[createBody,'POST'],
  [{action:'list',kind:'vacancy',expectedOwnerId:owner},'POST'],[{...list,cursor:null},'POST'],
  [{...list,after:{id,updatedAt:'2026-10-18T00:00:00.123Z'}},'POST'],[{...list,after:{id,updatedAt:'2026-10-18T00:00:00.123456Z',ownerId:other}},'POST'],
  [{...intent,creationKey:'bad'},'POST'],[{...intent,form:{}},'POST'],[{...createBody,creationKey:'bad'},'PUT'],
  [{...updateBody,form:{kind:'workRequest'}},'PUT'],[{...createBody,form:[]},'PUT'],
  ...['ownerId','author_id','userId','status','paid','is_paid','role','moderatedAt','expiresAt'].map(key=>[{...createBody,form:{...createBody.form,[key]:key==='paid'?true:other}},'PUT']),
  ...['status','paid','authorId','sessionToken'].map(key=>[{...updateBody,[key]:other},'PUT']),
  ...[undefined,null,1,9007199254740992,'0','01','1.0','9223372036854775808'].map(value=>[{...updateBody,expectedRevision:value},'PUT']),
 ];
 for(const [body,method] of cases){
  const f=fixture(),response=await f.handle(f.request(body,{},method));
  assert.equal(response.status,422);assert.deepEqual(await response.json(),{error:{code:'INVALID_INPUT'}});
  assert.equal(f.calls.factories,0);assert.deepEqual(f.calls.operations,[]);
 }
});

test('work publication body boundaries enforce 4 KiB reads, 64 KiB writes, valid UTF-8 and JSON before runtime',async()=>{
 for(const [body,headers,method,status] of [
  [readBody,{'content-length':'4097'},'POST',413],[{...readBody,extra:'x'.repeat(5000)},{},'POST',413],
  [updateBody,{'content-length':'65537'},'PUT',413],[{...updateBody,form:{description:'x'.repeat(66000)}},{},'PUT',413],
 ]){
  const f=fixture(),response=await f.handle(f.request(body,headers,method));
  assert.equal(response.status,status);assert.deepEqual(await response.json(),{error:{code:'BODY_TOO_LARGE'}});assert.equal(f.calls.factories,0);
 }
 for(const bytes of ['{',new Uint8Array([0xff])]){
  const f=fixture(),template=f.request();
  const response=await f.handle(new Request(template.url,{method:'POST',headers:template.headers,body:bytes}));
  assert.equal(response.status,400);assert.deepEqual(await response.json(),{error:{code:'INVALID_JSON'}});assert.equal(f.calls.factories,0);
 }
 const f=fixture(),large={...createBody,form:{...createBody.form,description:'x'.repeat(3000),requirements:'y'.repeat(3000)}};
 assert.ok(Buffer.byteLength(JSON.stringify(large))>4096);
 const response=await f.handle(f.request(large,{},'PUT'));
 assert.equal(response.status,200);assert.equal(f.calls.operations[0][0],'create');
 assert.equal(f.calls.operations[0][1][4].description,large.form.description);
 assert.equal(f.calls.operations[0][1][4].requirements,large.form.requirements);
});

test('work publication request body deadline cancels a stalled stream after two seconds without constructing runtime',async()=>{
 const f=fixture(),template=f.request();let cancelled=false;
 const stream=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{'));},cancel(){cancelled=true;}});
 const started=Date.now();
 const response=await f.handle(new Request(template.url,{method:'POST',headers:template.headers,body:stream,duplex:'half'}));
 assert.equal(response.status,408);assert.deepEqual(await response.json(),{error:{code:'BODY_TIMEOUT'}});
 assert.equal(cancelled,true);assert.equal(f.calls.factories,0);assert.ok(Date.now()-started<5000,'body deadline remains bounded');
});

test('work publication dispatch preserves exact CAS, microsecond cursor, canonical cookie authority and shared session rate scope',async()=>{
 const f=fixture(),cursor={id,updatedAt:'2026-10-18T00:00:00.123456Z'};
 for(const [body,method,name,args] of [
  [{action:'list',kind:'vacancy',expectedOwnerId:owner,after:null},'POST','list',[token,owner,'vacancy',null]],
  [{action:'list',kind:'workRequest',expectedOwnerId:owner,after:cursor},'POST','list',[token,owner,'workRequest',cursor]],
  [readBody,'POST','read',[token,owner,'vacancy',id]],
  [{action:'intent',kind:'workRequest',expectedOwnerId:owner,creationKey},'POST','readIntent',[token,owner,'workRequest',creationKey]],
  [createBody,'PUT','create',[token,owner,'vacancy',creationKey,contract.parseWorkPublicationForm('vacancy',createBody.form)]],
  [updateBody,'PUT','update',[token,owner,'vacancy',id,revision,contract.parseWorkPublicationForm('vacancy',updateBody.form)]],
  [{...createBody,kind:'workRequest',form:{kind:'workRequest',title:'Synthetic request',budget:'0.1'}},'PUT','create',
   [token,owner,'workRequest',creationKey,contract.parseWorkPublicationForm('workRequest',{kind:'workRequest',title:'Synthetic request',budget:'0.1'})]],
 ]){
  const response=await f.handle(f.request(body,{authorization:'Bearer synthetic-ignored-authority','x-request-id':'synthetic-untrusted-request-id'},method));
  assert.equal(response.status,200);assert.deepEqual(await response.json(),f.result[name]);
  assert.deepEqual(f.calls.operations.at(-1),[name,args]);assert.deepEqual(f.calls.limits.at(-1),['session','192.0.2.4']);
  assert.match(response.headers.get('x-request-id'),/^[a-f0-9-]{36}$/);
 }
 assert.equal(f.calls.operations.length,7);assert.equal(f.calls.factories,7);assert.equal(f.calls.events.length,7);
 const audit=JSON.stringify(f.calls.events);
 for(const value of [token,owner,id,creationKey,revision,'owner@example.invalid','+79990000000','Synthetic private vacancy','synthetic-untrusted-request-id','192.0.2.4']){
  assert.equal(audit.includes(value),false,'audit contains operation metadata, never private publication or authentication fields');
 }
 for(const event of f.calls.events){assert.equal(event.status,200);assert.equal(typeof event.durationMs,'number');assert.match(event.requestId,/^[a-f0-9-]{36}$/);}
});

test('work publication intent recovery is a read-only lookup including null, never a fallback create or update',async()=>{
 for(const intent of [null,{id,revision:'1',status:'draft'}]){
  const f=fixture({intent}),response=await f.handle(f.request({action:'intent',kind:'vacancy',expectedOwnerId:owner,creationKey}));
  assert.equal(response.status,200);assert.deepEqual(await response.json(),intent);
  assert.deepEqual(f.calls.operations,[['readIntent',[token,owner,'vacancy',creationKey]]]);
  assert.equal(f.calls.factories,1);assert.deepEqual(f.calls.limits,[['session','192.0.2.4']]);
 }
});

test('work publication owner claims do not substitute for the real cookie-owned store authorization',async()=>{
 const f=fixture({deniedOwner:true}),response=await f.handle(f.request({...updateBody,expectedOwnerId:other},{},'PUT'));
 assert.equal(response.status,404);assert.deepEqual(await response.json(),{error:{code:'PUBLICATION_NOT_FOUND'}});
 assert.equal(f.calls.operations.length,1);assert.equal(f.calls.operations[0][1][0],token);assert.equal(f.calls.operations[0][1][1],other);
 assert.equal(JSON.stringify(f.calls.events).includes(other),false);
});

test('work publication handler uses real AppSession guards: absent, blocked, unverified and revoked sessions cannot reach resource SQL',async()=>{
 for(const principal of [null,{id:owner,role:'user',isBlocked:true,verified:true,authVersion:'1'},
  {id:owner,role:'user',isBlocked:false,verified:false,authVersion:'1'},
  {id:owner,role:'user',isBlocked:false,verified:true,authVersion:'1'}]){
  const sql=[];
  const db={transaction:async work=>work({query:async text=>{
   sql.push(text);
   if(text.includes('select u.id,u.role'))return {rows:principal?[principal]:[],rowCount:principal?1:0};
   if(text.includes('select token_hash from app.sessions'))return {rows:[],rowCount:0};
   assert.fail('an invalid app session must not reach publication SQL');
  }})};
  const store=new storage.PostgresWorkPublicationStore(db);
  const handle=createProductionWorkPublicationHandler({origin},()=>({store,limiter:{allowProduction:async()=>true}}),()=>{});
  const response=await handle(fixture().request());
  assert.equal(response.status,401);assert.deepEqual(await response.json(),{error:{code:'UNAUTHENTICATED'}});
  assert.equal(sql.some(text=>text.includes('app.work_publications')),false);
 }
});

test('work publication typed errors map precisely, are generic and perform no automatic retry',async()=>{
 for(const [error,status,code] of [[new session.AppSessionAccessError(),401,'UNAUTHENTICATED'],
  [new storage.WorkPublicationAccessError(),404,'PUBLICATION_NOT_FOUND'],[new storage.WorkPublicationConflictError(),409,'PUBLICATION_CHANGED'],
  [new contract.WorkPublicationInputError(),422,'INVALID_INPUT'],[new drafts.ListingDraftInputError(),422,'INVALID_INPUT'],
  [new Error('Synthetic private SQL password=synthetic-secret owner@example.invalid'),503,'WORK_PUBLICATIONS_UNAVAILABLE']]){
  const f=fixture({error}),response=await f.handle(f.request(updateBody,{},'PUT'));
  assert.equal(response.status,status);assert.deepEqual(await response.json(),{error:{code}});
  assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('referrer-policy'),'no-referrer');
  assert.equal(f.calls.operations.length,1);assert.equal(f.calls.factories,1);assert.equal(f.calls.events.length,1);
  for(const value of ['synthetic-secret','SQL','password=','owner@example.invalid',token,owner,id])assert.equal(JSON.stringify(f.calls.events).includes(value),false);
 }
});

test('work publication shared rate denial and runtime outages fail closed without touching resources or retrying',async()=>{
 for(const options of [{limited:true},{outage:true},{rateOutage:true}]){
  const f=fixture(options),response=await f.handle(f.request(updateBody,{},'PUT'));
  assert.equal(response.status,options.limited?429:503);
  assert.deepEqual(await response.json(),{error:{code:options.limited?'RATE_LIMITED':'WORK_PUBLICATIONS_UNAVAILABLE'}});
  if(options.limited)assert.equal(response.headers.get('retry-after'),'900');
  assert.equal(f.calls.factories,1);assert.deepEqual(f.calls.operations,[]);assert.equal(f.calls.events.length,1);
  assert.equal(JSON.stringify(f.calls.events).includes('private'),false);
 }
});

test('work publication rejected action metadata cannot copy attacker-controlled private strings into audit or error output',async()=>{
 const f=fixture(),privateAction='synthetic-private-owner@example.invalid';
 const response=await f.handle(f.request({...readBody,action:privateAction}));
 assert.equal(response.status,422);assert.deepEqual(await response.json(),{error:{code:'INVALID_INPUT'}});
 assert.equal(f.calls.factories,0);assert.deepEqual(f.calls.operations,[]);assert.equal(f.calls.events.length,1);
 assert.equal(JSON.stringify(f.calls.events).includes(privateAction),false);
});
