import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {createLocalRefundOperatorRuntime} from '../scripts/local-refund-operator-runtime.mjs';
const load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
const env={NODE_ENV:'production',BLIZHNIY_REFUND_OPERATOR:'local-test',BLIZHNIY_PAYMENT_MODE:'test',
 BLIZHNIY_DB_HOST:'127.0.0.1',BLIZHNIY_DB_PORT:'5432',BLIZHNIY_DB_NAME:'blizhniy_test',BLIZHNIY_DB_USER:'blizhniy_refund_operator',
 BLIZHNIY_DB_PASSWORD:'synthetic-db',BLIZHNIY_DB_SSL_MODE:'verify-full',BLIZHNIY_DB_CA_FILE:'/unused/ca.crt',
 BLIZHNIY_PAYMENT_SHOP_ID:'synthetic',BLIZHNIY_PAYMENT_SECRET_KEY:'test_synthetic'};
const token='a'.repeat(64),actor='22222222-2222-4222-8222-222222222222',input={id:'33333333-3333-4333-8333-333333333333',paymentIntentId:'44444444-4444-4444-8444-444444444444',reason:'Возврат по обращению владельца.'};
function fixture(){
 const calls=[];let failDb=false,failAction=false,gate,enter,release;
 const modules={...load('identity'),...load('listing-draft-contract'),...load('placement-refund-approval'),...load('primary-refund-recovery'),
  readPostgresConfig:e=>({database:e.BLIZHNIY_DB_NAME,user:e.BLIZHNIY_DB_USER}),
  Pool:class{constructor(config){calls.push(['pool',config]);}},PostgresDatabase:class{async close(){calls.push(['close']);}},
  verifyRefundOperatorDatabase:async()=>{calls.push(['database']);if(failDb)throw Error('private database detail');},
  createRefundMerchantPreflight:()=>async()=>{calls.push(['merchant']);if(gate){enter();await gate;}},
  PostgresAdminRefundJournal:class{async list(...args){calls.push(['list',args]);return{items:[],nextAfter:null};}},
  PostgresRefundApprovalStore:class{constructor(_db,scope){calls.push(['store',scope]);}
   async approve(...args){calls.push(['approve',args]);if(failAction){failAction=false;throw Error('private uncertain COMMIT');}return{id:args[2].id};}
   async readForAdmin(...args){calls.push(['read',args]);return{id:args[2]};}},
  createPrimaryRefundRecovery:()=>({prepare:async()=>{calls.push(['prepare']);return null;},recover:async(...args)=>{calls.push(['recover',args]);return{state:'applied'};}})};
 return{calls,modules,fail:()=>failDb=true,failAction:()=>failAction=true,
  hold:()=>{gate=new Promise(r=>release=r);return new Promise(r=>enter=r);},release:()=>{gate=undefined;release();}};
}
test('operator factory rejects implicit, remote, wrong-role, unsafe-TLS and LIVE configuration before module loading',async()=>{
 let loaded=0;
 for(const change of [{NODE_ENV:'test'},{BLIZHNIY_REFUND_OPERATOR:undefined},{BLIZHNIY_DB_HOST:'17e86f80f26733d39ef4b84d.twc1.net'},
  {BLIZHNIY_DB_NAME:'blizhniy_prod'},{BLIZHNIY_DB_USER:'blizhniy_runtime'},{BLIZHNIY_DB_USER:'blizhniy_refund_worker'},
  {BLIZHNIY_DB_PORT:'70000'},{BLIZHNIY_DB_PASSWORD:''},{BLIZHNIY_DB_SSL_MODE:'disable'},{BLIZHNIY_DB_CA_FILE:'relative'},
  {PGHOST:'foreign'},{NODE_TLS_REJECT_UNAUTHORIZED:'0'},{BLIZHNIY_PAYMENT_MODE:'live'},{BLIZHNIY_PAYMENT_SECRET_KEY:'live_synthetic'}])
  await assert.rejects(createLocalRefundOperatorRuntime({...env,...change},{loadModules:()=>{loaded++;throw Error();}}),{message:'Local refund operator unavailable'});
 assert.equal(loaded,0);await assert.rejects(createLocalRefundOperatorRuntime());
});
test('operator freshly checks DB for every action, checks TEST merchant for new work and owns one close',async()=>{
 const f=fixture(),config={...env},runtime=await createLocalRefundOperatorRuntime(config,{loadModules:()=>f.modules});config.BLIZHNIY_PAYMENT_SHOP_ID='changed';
 assert.deepEqual(f.calls.map(c=>c[0]),['pool','store']);assert.equal(Object.isFrozen(f.calls[1][1]),true);assert.equal(f.calls[1][1].shopId,'synthetic');
 assert.deepEqual(Object.keys(runtime).sort(),['approve','close','listForAdmin','preflight','readForAdmin','recover']);assert.equal(f.calls[0][1].max,2);
 await runtime.preflight();assert.deepEqual(f.calls.slice(-3).map(c=>c[0]),['database','merchant','database']);
 await runtime.approve(token,actor,input);assert.deepEqual(f.calls.slice(-4).map(c=>c[0]),['database','merchant','database','approve']);
 await runtime.listForAdmin(token,actor,null);assert.deepEqual(f.calls.slice(-2).map(c=>c[0]),['database','list']);
 await runtime.readForAdmin(token,actor,input.id);assert.deepEqual(f.calls.slice(-2).map(c=>c[0]),['database','read']);
 await runtime.recover(token,actor,{id:input.id,operationId:input.id,providerRefundId:input.paymentIntentId,reason:input.reason});assert.deepEqual(f.calls.slice(-5).map(c=>c[0]),['database','prepare','merchant','database','recover']);
 await runtime.close();await runtime.close();assert.equal(f.calls.filter(c=>c[0]==='close').length,1);await assert.rejects(runtime.preflight());
});
test('canonical input is captured before asynchronous admission; malformed input starts no DB/HTTP work',async()=>{
 const f=fixture(),runtime=await createLocalRefundOperatorRuntime(env,{loadModules:()=>f.modules});
 for(const args of [['invalid',actor,input],[token,'invalid',input],[token,actor,{...input,amount:'1.00'}]])await assert.rejects(runtime.approve(...args));
 assert.deepEqual(f.calls.map(c=>c[0]),['pool','store']);
 const value={...input},entered=f.hold(),work=runtime.approve(token,actor,value);await entered;value.id=input.paymentIntentId;value.reason='Изменённая причина.';f.release();
 assert.deepEqual(await work,{id:input.id});assert.deepEqual(f.calls.at(-1)[1],[token,actor,input]);await runtime.close();
});
test('overlap refuses and close during admission drains without starting an approval',async()=>{
 const f=fixture(),runtime=await createLocalRefundOperatorRuntime(env,{loadModules:()=>f.modules}),entered=f.hold();
 const work=runtime.approve(token,actor,input);await entered;await assert.rejects(runtime.readForAdmin(token,actor,input.id));
 const closing=runtime.close();assert.equal(f.calls.some(c=>c[0]==='close'),false);f.release();await assert.rejects(work);await closing;
 assert.equal(f.calls.some(c=>c[0]==='approve'),false);assert.equal(f.calls.filter(c=>c[0]==='close').length,1);
});
test('DB failure prevents work and uncertain action errors are redacted without automatic retry or replacement IDs',async()=>{
 const f=fixture(),runtime=await createLocalRefundOperatorRuntime(env,{loadModules:()=>f.modules});f.failAction();
 await assert.rejects(runtime.approve(token,actor,input),{message:'Local refund operator unavailable'});assert.equal(f.calls.filter(c=>c[0]==='approve').length,1);
 assert.deepEqual(await runtime.approve(token,actor,input),{id:input.id});assert.equal(f.calls.filter(c=>c[0]==='approve').length,2);
 f.fail();await assert.rejects(runtime.readForAdmin(token,actor,input.id),{message:'Local refund operator unavailable'});assert.equal(f.calls.some(c=>c[0]==='read'),false);await runtime.close();
});
test('operator transport rejects POST before fetch and partial construction failure closes its pool',async()=>{
 const aborted=new AbortController();aborted.abort(Error('private expired request'));
 for(const init of [{method:'POST'},{method:'GET',signal:aborted.signal}]){
  const f=fixture();let sent=0;
  f.modules.createPrimaryRefundRecovery=(_db,_scope,fetcher)=>({prepare:async()=>null,recover:()=>fetcher('https://api.yookassa.ru/v3/refunds',init)});
  const runtime=await createLocalRefundOperatorRuntime(env,{loadModules:()=>f.modules,fetcher:async()=>{sent++;throw Error('Unexpected request');}});
  await assert.rejects(runtime.recover(token,actor,{id:input.id,operationId:input.id,providerRefundId:input.paymentIntentId,reason:input.reason}),{message:'Local refund operator unavailable'});assert.equal(sent,0);await runtime.close();
 }
 const broken=fixture();broken.modules.PostgresRefundApprovalStore=class{constructor(){throw Error('private constructor detail');}};
 await assert.rejects(createLocalRefundOperatorRuntime(env,{loadModules:()=>broken.modules}),{message:'Local refund operator unavailable'});assert.equal(broken.calls.filter(c=>c[0]==='close').length,1);
});
test('closing an already running command drains it, reports an unknown result and cannot start a later command',async()=>{
 const f=fixture();let enter,release;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r);
 f.modules.PostgresRefundApprovalStore=class{async approve(){enter();await gate;return{id:input.id};}};
 const runtime=await createLocalRefundOperatorRuntime(env,{loadModules:()=>f.modules}),work=runtime.approve(token,actor,input);await entered;
 const closing=runtime.close();assert.equal(f.calls.some(c=>c[0]==='close'),false);release();
 await assert.rejects(work,{message:'Local refund operator unavailable'});await closing;assert.equal(f.calls.filter(c=>c[0]==='close').length,1);
 await assert.rejects(runtime.approve(token,actor,input));
});
test('shutdown rejection is redacted, cached and never reopens the runtime or repeats pool shutdown',async()=>{
 const f=fixture();f.modules.PostgresDatabase=class{async close(){f.calls.push(['close']);throw Error('private driver shutdown detail');}};
 const runtime=await createLocalRefundOperatorRuntime(env,{loadModules:()=>f.modules});
 await assert.rejects(runtime.close(),{message:'Local refund operator unavailable'});await assert.rejects(runtime.close(),{message:'Local refund operator unavailable'});
 assert.equal(f.calls.filter(c=>c[0]==='close').length,1);await assert.rejects(runtime.approve(token,actor,input));
});
test('local approval reads and completed recovery remain available during provider admission outage',async()=>{
 const f=fixture();f.modules.createRefundMerchantPreflight=()=>async()=>{throw Error('Synthetic provider outage');};
 f.modules.createPrimaryRefundRecovery=()=>({prepare:async()=>({state:'applied'}),recover:async()=>{throw Error('Terminal recovery should be read locally');}});
 const runtime=await createLocalRefundOperatorRuntime(env,{loadModules:()=>f.modules,fetcher:async()=>{throw Error('Unexpected provider request');}});
 assert.deepEqual(await runtime.readForAdmin(token,actor,input.id),{id:input.id});
 assert.deepEqual(await runtime.recover(token,actor,{id:input.id,operationId:input.id,providerRefundId:input.paymentIntentId,reason:input.reason}),{state:'applied'});
 await runtime.close();
});
