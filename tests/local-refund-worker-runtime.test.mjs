import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createLocalRefundWorkerRuntime} from '../scripts/local-refund-worker-runtime.mjs';
const env={NODE_ENV:'production',BLIZHNIY_REFUND_WORKER:'local-test',BLIZHNIY_PAYMENT_MODE:'test',
 BLIZHNIY_DB_HOST:'127.0.0.1',BLIZHNIY_DB_PORT:'5432',BLIZHNIY_DB_NAME:'blizhniy_test',BLIZHNIY_DB_USER:'blizhniy_refund_worker',
 BLIZHNIY_DB_PASSWORD:'synthetic-db',BLIZHNIY_DB_SSL_MODE:'verify-full',BLIZHNIY_DB_CA_FILE:'/unused/ca.crt',
 BLIZHNIY_PAYMENT_SHOP_ID:'synthetic',BLIZHNIY_PAYMENT_SECRET_KEY:'test_synthetic'};
function fixture(){
 const calls=[];let fail=false,enter,release,gate;
 const modules={readPostgresConfig:e=>({database:e.BLIZHNIY_DB_NAME,user:e.BLIZHNIY_DB_USER,ssl:{rejectUnauthorized:true}}),
  Pool:class{constructor(c){calls.push(['pool',c]);}},PostgresDatabase:class{async close(){calls.push(['close']);}},
  verifyRefundWorkerDatabase:async(_db,c)=>{calls.push(['database',c]);if(fail)throw Error('private detail');},
  createRefundMerchantPreflight:()=>async()=>{calls.push(['merchant']);if(gate){enter();await gate;}},
  createPlacementRefundWorker:(_db,c)=>({tick:async()=>{calls.push(['placement',c]);return{state:'idle'};}}),
  createApplicationCompensationWorker:()=>({sweep:async()=>{calls.push(['application']);return{processing:{state:'idle'}};}})};
 return{calls,modules,fail:()=>fail=true,hold:()=>{gate=new Promise(r=>release=r);return new Promise(r=>enter=r);},release:()=>release()};
}
test('local refund factory refuses remote/HTTP/admin databases, unsafe TLS, ambient PG and LIVE before loading modules',async()=>{
 let loaded=0;
 for(const change of [{NODE_ENV:'test'},{BLIZHNIY_REFUND_WORKER:undefined},{BLIZHNIY_DB_HOST:'17e86f80f26733d39ef4b84d.twc1.net'},
  {BLIZHNIY_DB_NAME:'blizhniy_prod'},{BLIZHNIY_DB_USER:'blizhniy_runtime'},{BLIZHNIY_DB_USER:'postgres'},
  {BLIZHNIY_DB_PORT:'not-a-port'},{BLIZHNIY_DB_PASSWORD:''},{BLIZHNIY_DB_SSL_MODE:'disable'},
  {BLIZHNIY_DB_CA_FILE:'relative'},{PGHOST:'foreign'},{NODE_TLS_REJECT_UNAUTHORIZED:'0'},
  {BLIZHNIY_PAYMENT_MODE:'live'},{BLIZHNIY_PAYMENT_SECRET_KEY:'live_synthetic'},{BLIZHNIY_PAYMENT_SHOP_ID:'bad:shop'}]){
  await assert.rejects(createLocalRefundWorkerRuntime({...env,...change},{loadModules:()=>{loaded++;throw Error();}}),{message:'Local refund runtime unavailable'});
 }assert.equal(loaded,0);await assert.rejects(createLocalRefundWorkerRuntime());
});
test('runtime gates claims, freezes TEST scope, checks DB around merchant admission and before work, and owns one close',async()=>{
 const f=fixture(),input={...env},runtime=await createLocalRefundWorkerRuntime(input,{loadModules:()=>f.modules});
 input.BLIZHNIY_PAYMENT_SHOP_ID='changed';await assert.rejects(runtime.placement.tick());assert.equal(f.calls.length,1);
 await runtime.preflight();assert.deepEqual(f.calls.slice(1).map(c=>c[0]),['database','merchant','database']);
 assert.deepEqual(await runtime.placement.tick(),{state:'idle'});assert.equal(f.calls.at(-1)[1].shopId,'synthetic');
 assert.equal(Object.isFrozen(f.calls.at(-1)[1]),true);assert.equal(f.calls[0][1].max,2);
 await runtime.application.sweep();assert.deepEqual(f.calls.slice(-4).map(c=>c[0]),['database','placement','database','application']);
 await runtime.close();await runtime.close();assert.equal(f.calls.filter(c=>c[0]==='close').length,1);
 await assert.rejects(runtime.preflight());await assert.rejects(runtime.placement.tick());
});
test('overlap refuses; closing during admission drains it and cannot allow a later claim',async()=>{
 const f=fixture(),runtime=await createLocalRefundWorkerRuntime(env,{loadModules:()=>f.modules});
 const entered=f.hold(),admitting=runtime.preflight();await entered;
 await assert.rejects(runtime.preflight());await assert.rejects(runtime.application.sweep());
 const closing=runtime.close();assert.equal(f.calls.some(c=>c[0]==='close'),false);f.release();
 await assert.rejects(admitting);await closing;await assert.rejects(runtime.placement.tick());
 assert.equal(f.calls.filter(c=>c[0]==='close').length,1);
});
test('failed DB admission revokes an earlier successful admission and cannot start work or leak credentials',async()=>{
 const f=fixture(),runtime=await createLocalRefundWorkerRuntime(env,{loadModules:()=>f.modules});
 await runtime.preflight();f.fail();
 await assert.rejects(runtime.placement.tick(),{message:'Local refund runtime unavailable'});
 await assert.rejects(runtime.application.sweep(),{message:'Local refund runtime unavailable'});
 assert.equal(f.calls.some(c=>c[0]==='placement'||c[0]==='application'),false);await runtime.close();
});
test('encoded processing uncertainty revokes admission for both consumer interfaces',async()=>{
 for(const kind of ['placement','application']){
  const f=fixture(),result={state:'deferred',code:'processing_unavailable'};
  f.modules.createPlacementRefundWorker=()=>({tick:async()=>result});
  f.modules.createApplicationCompensationWorker=()=>({sweep:async()=>({processing:result})});
  const runtime=await createLocalRefundWorkerRuntime(env,{loadModules:()=>f.modules});await runtime.preflight();
  if(kind==='placement')assert.deepEqual(await runtime.placement.tick(),result);
  else assert.deepEqual(await runtime.application.sweep(),{processing:result});
  await assert.rejects(runtime.placement.tick());await assert.rejects(runtime.application.sweep());await runtime.close();
 }
});
