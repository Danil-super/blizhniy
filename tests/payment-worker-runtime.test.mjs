import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {rootCertificates} from 'node:tls';
import {test} from 'node:test';
import {readPostgresConfig} from '../src/lib/postgres.ts';

const valid={NODE_ENV:'production',BLIZHNIY_PAYMENT_WORKER:'queued-test',BLIZHNIY_PAYMENT_MODE:'test',
 BLIZHNIY_PAYMENT_SHOP_ID:'synthetic-shop',BLIZHNIY_PAYMENT_SECRET_KEY:'test_synthetic-key',
 BLIZHNIY_DB_HOST:'17e86f80f26733d39ef4b84d.twc1.net',BLIZHNIY_DB_PORT:'5432',BLIZHNIY_DB_NAME:'blizhniy_prod',
 BLIZHNIY_DB_USER:'blizhniy_payment_reconciler',BLIZHNIY_DB_PASSWORD:'synthetic-db-key',BLIZHNIY_DB_SSL_MODE:'verify-full',BLIZHNIY_DB_CA_FILE:'/unused/root.crt'};

test('TEST worker rejects disabled, LIVE, wrong role/host/database, ambient PG and unsafe TLS before loading modules or allocating a pool',async()=>{
 const {createPaymentWorkerRuntime}=await import('../scripts/payment-worker-runtime.mjs');
 let loads=0;const loadModules=()=>{loads++;assert.fail('must validate before module load');};
 for(const change of [{BLIZHNIY_PAYMENT_WORKER:undefined},{BLIZHNIY_PAYMENT_WORKER:'live'},{NODE_ENV:'test'},
  {BLIZHNIY_PAYMENT_MODE:'live'},{BLIZHNIY_PAYMENT_SECRET_KEY:'live_synthetic'},{BLIZHNIY_PAYMENT_SECRET_KEY:'test_has space'},
  {BLIZHNIY_PAYMENT_SHOP_ID:''},{BLIZHNIY_PAYMENT_SHOP_ID:'bad:shop'},
  {BLIZHNIY_DB_USER:'blizhniy_runtime'},{BLIZHNIY_DB_USER:'gen_user'},{BLIZHNIY_DB_HOST:'127.0.0.1'},
  {BLIZHNIY_DB_NAME:'default_db'},{BLIZHNIY_DB_PORT:'5433'},{BLIZHNIY_DB_SSL_MODE:'disable'},
  {BLIZHNIY_DB_PASSWORD:''},{BLIZHNIY_DB_CA_FILE:'relative'},{PGHOST:'foreign.invalid'},{NODE_TLS_REJECT_UNAUTHORIZED:'0'}]){
  await assert.rejects(createPaymentWorkerRuntime({...valid,...change},{loadModules}),{message:'Payment worker configuration unavailable'});
 }assert.equal(loads,0);
});

test('factory uses verified canonical DB config, private max-two pool, immutable TEST merchant, read-only preflight and owned shutdown',async()=>{
 const {createPaymentWorkerRuntime}=await import('../scripts/payment-worker-runtime.mjs');
 const owned=mkdtempSync(join(tmpdir(),'blizhniy-payment-runtime-'));
 const ca=join(owned,'root.crt');writeFileSync(ca,rootCertificates[0]);
 const env={...valid,BLIZHNIY_DB_CA_FILE:ca};
 let poolConfig,merchant,closed=0,reads=0,ticks=0,failWorker=false;
 const loadModules=()=>({readPostgresConfig,Pool:class{constructor(config){poolConfig=config;}async end(){closed++;}},
  PostgresDatabase:class{constructor(pool){this.pool=pool;}async close(){await this.pool.end();}
   async transaction(work,options){reads++;assert.deepEqual(options,{readOnly:true});await work({query:async()=>{throw Error('synthetic SQL detail');}});}},
  createPaymentReconciliationWorker:(_db,config)=>{if(failWorker)throw Error('synthetic secret');merchant=config;return{tick:async()=>{ticks++;return{state:'idle'};}};},
 });
 try {
  const runtime=await createPaymentWorkerRuntime(env,{loadModules});
  env.BLIZHNIY_PAYMENT_SHOP_ID='changed';env.BLIZHNIY_DB_USER='gen_user';
  assert.equal(merchant.shopId,'synthetic-shop');assert.equal(merchant.isTest,true);assert.equal(Object.isFrozen(merchant),true);
  assert.equal(poolConfig.user,'blizhniy_payment_reconciler');assert.equal(poolConfig.max,2);
  assert.equal(poolConfig.ssl.rejectUnauthorized,true);assert.equal(poolConfig.connectionTimeoutMillis,3000);assert.equal(poolConfig.statement_timeout,8000);
  assert.equal(reads,0);assert.equal(ticks,0);
  await assert.rejects(runtime.preflight(),{message:'Payment reconciliation database preflight failed'});assert.equal(reads,1);assert.equal(ticks,0);
  assert.deepEqual(await runtime.worker.tick(),{state:'idle'});assert.equal(ticks,1);
  await runtime.close();await runtime.close();assert.equal(closed,1);
  failWorker=true;
  await assert.rejects(createPaymentWorkerRuntime({...valid,BLIZHNIY_DB_CA_FILE:ca},{loadModules}),{message:'Payment worker configuration unavailable'});
  assert.equal(closed,2);
 }finally {rmSync(owned,{recursive:true,force:true});}
});
test('account TEST mode requires one owner and selects only the GET verifier, never the fulfillment worker',async()=>{
 const {createPaymentWorkerRuntime}=await import('../scripts/payment-worker-runtime.mjs');
 let configured,closed=0;
 const owner='11111111-1111-4111-8111-111111111111';
 const modules={readPostgresConfig:()=>({database:'blizhniy_prod'}),Pool:class{},PostgresDatabase:class{async close(){closed++;}},
  createPaymentReconciliationWorker:()=>assert.fail('Account TEST cannot select a publication worker'),
  createAccountTestPaymentVerifier:(_db,config)=>{configured=config;return{tick:async()=>({state:'idle'})};}};
 await assert.rejects(createPaymentWorkerRuntime({...valid,BLIZHNIY_PAYMENT_WORKER:'account-test'},{loadModules:()=>assert.fail('Owner required before module loading')}));
 const runtime=await createPaymentWorkerRuntime({...valid,BLIZHNIY_PAYMENT_WORKER:'account-test',BLIZHNIY_PAYMENT_TEST_USER_ID:owner},{loadModules:()=>modules});
 assert.equal(configured.ownerId,owner);assert.equal(configured.isTest,true);assert.equal(Object.isFrozen(configured),true);
 assert.deepEqual(await runtime.worker.tick(),{state:'idle'});await runtime.close();assert.equal(closed,1);
});
