import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import * as boundary from '../src/lib/auth-http.ts';
import * as cookie from '../src/lib/account-cookie.ts';
import * as proxy from '../src/lib/trusted-proxy-ip.ts';
import * as cardContract from '../src/lib/work-cabinet-contract.ts';
import {workPublicationModule} from './work-publication-module.mjs';
import {loadAdminModule} from './admin-module.mjs';
const session=loadAdminModule('app-session-transaction'),storage=workPublicationModule('postgres-work-publications');
const {createWorkCabinetHandler}=workPublicationModule('work-cabinet-http',{
 'node:crypto':createRequire(import.meta.url)('node:crypto'),'./auth-http':boundary,'./account-cookie':cookie,
 './trusted-proxy-ip':proxy,'./app-session-transaction':session,'./postgres-work-publications':storage,
});
const origin='https://cabinet.example.invalid',owner='11111111-1111-4111-8111-111111111111',token='a'.repeat(64);
const input={kind:'vacancy',expectedOwnerId:owner,after:null};
function fixture({error,limited=false}={}){
 const calls=[],events=[];
 const handle=createWorkCabinetHandler({origin},()=>({store:{list:async(...args)=>{calls.push(args);if(error)throw error;return{items:[],nextCursor:null};}},limiter:{allowProduction:async()=>!limited}}),event=>events.push(event));
 const request=(body=input,headers={},method='POST',query='')=>new Request(origin+'/api/account/work-cabinet'+query,{method,
  headers:{host:new URL(origin).host,origin,'x-blizhniy-request':'1','x-real-ip':'192.0.2.4','content-type':'application/json',cookie:'__Host-blizhniy_session='+token,...headers},
  ...(['GET','HEAD'].includes(method)?{}:{body:JSON.stringify(body)})});
 return{handle,request,calls,events};
}
test('work cabinet ingress is read-only and rejects forged origins, query authority, missing cookies and untrusted proxy addresses',async()=>{
 for(const [headers,method,query,status] of [[{},'GET','',405],[{},'PUT','',405],[{origin:'https://attacker.invalid'},'POST','',403],
  [{'x-blizhniy-request':''},'POST','',403],[{},'POST','?owner='+owner,400],[{cookie:'',authorization:'Bearer '+token},'POST','',401],
  [{'x-real-ip':'','x-forwarded-for':'192.0.2.4'},'POST','',403]]){
  const f=fixture(),reply=await f.handle(f.request(input,headers,method,query));assert.equal(reply.status,status);assert.equal(f.calls.length,0);
  assert.equal(reply.headers.get('cache-control'),'no-store');assert.equal(reply.headers.get('referrer-policy'),'no-referrer');
  assert.match(reply.headers.get('x-request-id'),/^[a-f0-9-]{36}$/);if(status===405)assert.equal(reply.headers.get('allow'),'POST');
 }
});
test('work cabinet rejects unknown/missing/privileged envelopes and bad cursor microseconds',async()=>{
 for(const body of [null,[],{}, {...input,action:'list'},{...input,role:'admin'},{...input,expectedOwnerId:'bad'},
  {...input,kind:'listing'},{kind:'vacancy',expectedOwnerId:owner},{...input,after:{id:owner,updatedAt:'2026-10-21T00:00:00.123Z'}}]){
  const f=fixture(),reply=await f.handle(f.request(body));assert.equal(reply.status,422);assert.deepEqual(await reply.json(),{error:{code:'INVALID_INPUT'}});assert.equal(f.calls.length,0);
 }
});
test('work cabinet delegates exact cookie scope/cursor and maps access failures without leaking internal errors',async()=>{
 const f=fixture(),cursor={id:owner,updatedAt:'2026-10-21T00:00:00.123456Z'};
 const reply=await f.handle(f.request({...input,after:cursor}));assert.equal(reply.status,200);assert.deepEqual(f.calls,[[token,owner,'vacancy',cursor]]);
 for(const [error,status,code] of [[new session.AppSessionAccessError(),401,'UNAUTHENTICATED'],[new storage.WorkPublicationAccessError(),404,'PUBLICATION_NOT_FOUND'],[Error('Private SQL'),503,'WORK_PUBLICATIONS_UNAVAILABLE']]){
  const failed=fixture({error}),response=await failed.handle(failed.request());assert.equal(response.status,status);assert.deepEqual(await response.json(),{error:{code}});
  assert.equal(JSON.stringify(failed.events).includes('Private SQL'),false);assert.equal(JSON.stringify(failed.events).includes(token),false);
 }
 const limited=fixture({limited:true}),response=await limited.handle(limited.request());assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),'900');assert.equal(limited.calls.length,0);
});
test('work cabinet storage enforces current owner before the bounded projection and preserves cursor precision',async()=>{
 const calls=[],actor={id:owner};
 const {PostgresWorkCabinetStore}=workPublicationModule('postgres-work-cabinet',{'./work-cabinet-contract.ts':cardContract,
  './postgres-work-publications':storage,'./app-session-transaction':{withAppSessionTransaction:async(_db,_token,work)=>work({query:async(sql,values)=>{calls.push({sql,values});return{rows:[]};}},actor)},
 });
 const store=new PostgresWorkCabinetStore({transaction(){throw Error('Unexpected path');}}),cursor={id:owner,updatedAt:'2026-10-21T00:00:00.123456Z'};
 assert.deepEqual(await store.list(token,owner,'vacancy',cursor),{items:[],nextCursor:null});assert.equal(calls.length,1);
 assert.deepEqual(calls[0].values,[owner,'vacancy',cursor.updatedAt,owner]);
 assert.match(calls[0].sql,/w\.author_id=\$1 and w\.kind=\$2 and w\.deleted_at is null/);assert.match(calls[0].sql,/limit 21/);
 assert.match(calls[0].sql,/m\.owner_id=w\.author_id and m\.state='ready'/);assert.doesNotMatch(calls[0].sql,/\b(?:insert|update|delete)\b/i);
 actor.id='22222222-2222-4222-8222-222222222222';await assert.rejects(()=>store.list(token,owner,'vacancy',null),storage.WorkPublicationAccessError);assert.equal(calls.length,1);
});
