import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
const load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
const origin='https://admin.example.invalid',actor='22222222-2222-4222-8222-222222222222',token='a'.repeat(64),body={action:'list',expectedAdminId:actor,input:null};
const request=(value=body,headers={},method='POST')=>new Request(origin+'/api/admin/refunds',{method,headers:{host:'admin.example.invalid',origin,'content-type':'application/json','x-blizhniy-request':'1','x-real-ip':'127.0.0.1',cookie:'__Host-blizhniy_session='+token,...headers},...(method==='GET'?{}:{body:JSON.stringify(value)})});
test('public refund boundary rejects CSRF, wrong ingress/session, malformed commands and rate denial before IPC',async()=>{
 const {createAdminRefundHandler}=load('admin-refund-http');let calls=0,allowed=true;const events=[];
 const handler=createAdminRefundHandler({origin},()=>({limiter:{allowProduction:async()=>allowed},command:async()=>{calls++;return{items:[],nextAfter:null};}}),event=>events.push(event));
 for(const [req,status] of [[request(body,{origin:'https://foreign.invalid'}),403],[request(body,{'x-blizhniy-request':''}),403],[request(body,{'x-real-ip':'unknown'}),403],[request(body,{cookie:''}),401],[request({...body,sql:'select 1'}),422],[request(body,{},'GET'),405]])assert.equal((await handler(req)).status,status);
 allowed=false;assert.equal((await handler(request())).status,429);assert.equal(calls,0);
 const serialized=JSON.stringify(events);assert.equal(serialized.includes(token),false);assert.equal(serialized.includes(actor),false);assert.equal(serialized.includes('select 1'),false);
});
test('public refund boundary forwards canonical cookie/session and returns redacted non-cacheable results',async()=>{
 const {createAdminRefundHandler}=load('admin-refund-http');const calls=[],events=[];
 let fail=false;const handler=createAdminRefundHandler({origin},()=>({limiter:{allowProduction:async()=>true},command:async(...args)=>{calls.push(args);if(fail)throw Error('private SQL credential');return{items:[],nextAfter:null};}}),event=>events.push(event));
 const response=await handler(request());assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(await response.json(),{items:[],nextAfter:null});assert.deepEqual(calls[0].slice(0,2),[token,body]);
 fail=true;const error=await handler(request());assert.equal(error.status,503);assert.deepEqual(await error.json(),{error:{code:'REFUND_OPERATOR_UNAVAILABLE'}});assert.equal(JSON.stringify(events).includes('private'),false);
});
test('local refund view flag never enables an operator on production or accepts external origins',()=>{
 const {readLocalRefundAdminEnabled}=load('local-refund-admin-config');
 assert.equal(readLocalRefundAdminEnabled({}),false);
 const env={NODE_ENV:'production',BLIZHNIY_REFUND_ADMIN:'local-test',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://127.0.0.1:3045'};
 assert.equal(readLocalRefundAdminEnabled(env),true);
 for(const change of [{BLIZHNIY_REFUND_ADMIN:'enabled'},{BLIZHNIY_LOCAL_PRIMARY:undefined},{NODE_ENV:'test'},{BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai'},{BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://127.0.0.1:1000'}])assert.throws(()=>readLocalRefundAdminEnabled({...env,...change}));
});
