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
test('journal refund commands require the explicit local TEST configuration',()=>{
 const {readLocalRefundJournalConfig}=load('local-refund-admin-config');
 const env={NODE_ENV:'production',BLIZHNIY_REFUND_ADMIN:'journal-test',BLIZHNIY_LOCAL_PRIMARY:'enabled',
  BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://127.0.0.1:3045',BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_ADMIN_PAYMENT_JOURNAL:'test-v1',
  BLIZHNIY_PAYMENT_MODE:'test',BLIZHNIY_PAYMENT_SHOP_ID:'fixture',BLIZHNIY_REFUND_OPERATOR_SOCKET:'/tmp/refund-fixture.sock'};
 assert.equal(readLocalRefundJournalConfig({}),null);
 assert.equal(readLocalRefundJournalConfig({...env,BLIZHNIY_REFUND_ADMIN:'local-test'}),null);
 assert.deepEqual(readLocalRefundJournalConfig(env),{shopId:'fixture',socketPath:'/tmp/refund-fixture.sock'});
 for(const change of [{BLIZHNIY_ADMIN_PAYMENT_JOURNAL:undefined},{BLIZHNIY_PAYMENT_MODE:'live'},
  {BLIZHNIY_REFUND_OPERATOR_SOCKET:undefined},{BLIZHNIY_LOCAL_PRIMARY:undefined},{BLIZHNIY_PAYMENT_SHOP_ID:'other shop'}]){
  assert.throws(()=>readLocalRefundJournalConfig({...env,...change}));
 }
});
test('only an authenticated definite approval rejection becomes 409, without private diagnostics',async()=>{
 const {createAdminRefundHandler}=load('admin-refund-http'),{AdminRefundRejectedError}=load('admin-refund-contract');let calls=0;
 const handler=createAdminRefundHandler({origin},()=>({limiter:{allowProduction:async()=>true},command:async()=>{calls++;throw new AdminRefundRejectedError();}}),()=>{});
 const approval={action:'approve',expectedAdminId:actor,input:{id:actor,paymentIntentId:actor,reason:'Возврат.'}};
 const reply=await handler(request(approval));assert.equal(reply.status,409);assert.deepEqual(await reply.json(),{error:{code:'REFUND_NOT_LATEST'}});
 assert.equal((await handler(request())).status,503);assert.equal((await handler(request(approval,{cookie:''}))).status,401);assert.equal(calls,2);
});

test('hosted refund actions require the TEST journal and the fixed private operator socket',()=>{
 const {readLocalRefundAdminEnabled,readLocalRefundJournalConfig}=load('local-refund-admin-config');
 const env={NODE_ENV:'production',BLIZHNIY_REFUND_ADMIN:'hosted-test-v1',BLIZHNIY_AUTH_MODE:'postgres',
  BLIZHNIY_AUTH_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai',BLIZHNIY_ADMIN_PAYMENT_JOURNAL:'test-v1',
  BLIZHNIY_PAYMENT_MODE:'test',BLIZHNIY_PAYMENT_SHOP_ID:'fixture'};
 assert.equal(readLocalRefundAdminEnabled(env),false);
 assert.deepEqual(readLocalRefundJournalConfig(env),{hosted:true,shopId:'fixture',socketPath:'/run/blizhniy-refund-operator/operator.sock'});
 const protectedMode={...env,BLIZHNIY_REFUND_ADMIN:'hosted-passkey-test-v1',
  BLIZHNIY_ADMIN_PASSKEYS:'hosted-v1',BLIZHNIY_USER_ACCESS_OPERATOR:'hosted-passkey-v1'};
 assert.deepEqual(readLocalRefundJournalConfig(protectedMode),{hosted:true,passkey:true,shopId:'fixture',
  socketPath:'/run/blizhniy-refund-operator-passkey/operator.sock'});
 for(const configuration of [
  {...protectedMode,BLIZHNIY_ADMIN_PASSKEYS:undefined},{...protectedMode,BLIZHNIY_USER_ACCESS_OPERATOR:undefined},
  {...protectedMode,BLIZHNIY_REFUND_ADMIN:'hosted-test-v1'},
 ])assert.equal(readLocalRefundJournalConfig(configuration),null);
 for(const change of [{BLIZHNIY_AUTH_ORIGIN:'https://foreign.invalid'},{BLIZHNIY_AUTH_MODE:'local'},
  {BLIZHNIY_LOCAL_PRIMARY:'enabled'},{BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://127.0.0.1:3045'},
  {BLIZHNIY_REFUND_OPERATOR_SOCKET:'/tmp/other.sock'},{BLIZHNIY_ADMIN_PAYMENT_JOURNAL:undefined},
  {BLIZHNIY_PAYMENT_MODE:'live'},{BLIZHNIY_PAYMENT_SHOP_ID:undefined},{NODE_ENV:'test'}])
  assert.throws(()=>readLocalRefundJournalConfig({...env,...change}));
});
