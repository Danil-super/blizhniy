import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,symlinkSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {rootCertificates} from 'node:tls';

test('isolated worker artifact loads canonical compiled modules in plain Node without source TS, app aliases or operator code',async()=>{
 const {buildPaymentWorker}=await import('../scripts/build-payment-worker.mjs');
 const owned=mkdtempSync(join(tmpdir(),'blizhniy-worker-build-'));
 try {
  const destination=join(owned,'artifact');
  const manifest=buildPaymentWorker(destination);
  assert.ok(manifest.sources.includes('lib/payment-reconciliation-worker.js'));
  assert.ok(manifest.sources.includes('lib/postgres-listing-form.js'));
  assert.ok(manifest.sources.every(path=>path.startsWith('lib/')&&path.endsWith('.js')));
  assert.equal(existsSync(join(destination,'scripts/bootstrap-postgres.mjs')),false);
  assert.equal(existsSync(join(destination,'src')),false);
  symlinkSync(fileURLToPath(new URL('../node_modules',import.meta.url)),join(destination,'node_modules'),'dir');
  const script=`import {createRequire} from 'node:module';const require=createRequire(import.meta.url);const {PostgresDatabase}=require('./compiled/lib/postgres.js');const {createPaymentReconciliationWorker}=require('./compiled/lib/payment-reconciliation-worker.js');const {getBootstrapPlan}=await import('./scripts/postgres-migration-plan.mjs');const {verifyPaymentReconciliationDatabase}=await import('./scripts/payment-reconciliation-role.mjs');let attempts=0;const db={transaction:async()=>{attempts++;throw Error('synthetic');}};try{await createPaymentReconciliationWorker(db,{shopId:'synthetic',isTest:true,secretKey:'test_synthetic'}).tick();}catch{} console.log(JSON.stringify({postgres:typeof PostgresDatabase,preflight:typeof verifyPaymentReconciliationDatabase,journal:getBootstrapPlan({includePaymentReconciliationRole:true}).length,attempts}));`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:destination,env:{PATH:process.env.PATH},encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),{postgres:'function',preflight:'function',journal:24,attempts:1});
  const ca=join(owned,'root.crt');writeFileSync(ca,rootCertificates[0]);
  const factoryScript=`const {createPaymentWorkerRuntime}=await import('./scripts/payment-worker-runtime.mjs');const runtime=await createPaymentWorkerRuntime();await runtime.close();console.log(JSON.stringify({closed:true}));`;
  const factory=spawnSync(process.execPath,['--input-type=module','-e',factoryScript],{cwd:destination,env:{PATH:process.env.PATH,NODE_ENV:'production',
   BLIZHNIY_PAYMENT_WORKER:'queued-test',BLIZHNIY_PAYMENT_MODE:'test',BLIZHNIY_PAYMENT_SHOP_ID:'synthetic',BLIZHNIY_PAYMENT_SECRET_KEY:'test_synthetic',
   BLIZHNIY_DB_HOST:'17e86f80f26733d39ef4b84d.twc1.net',BLIZHNIY_DB_PORT:'5432',BLIZHNIY_DB_NAME:'blizhniy_prod',
   BLIZHNIY_DB_USER:'blizhniy_payment_reconciler',BLIZHNIY_DB_PASSWORD:'synthetic',BLIZHNIY_DB_SSL_MODE:'verify-full',BLIZHNIY_DB_CA_FILE:ca},encoding:'utf8',timeout:10000});
  assert.equal(factory.status,0,factory.stderr);assert.deepEqual(JSON.parse(factory.stdout),{closed:true});
  const alias=join(destination,'scripts/worker-alias.mjs');symlinkSync('payment-worker.mjs',alias);
  const aliased=spawnSync(process.execPath,['--preserve-symlinks-main',alias,'--check'],{env:{PATH:process.env.PATH},encoding:'utf8',timeout:10000});
  assert.equal(aliased.status,1,aliased.stderr);assert.equal(JSON.parse(aliased.stdout).failureStage,'configuration');
  const before=readFileSync(join(destination,'package.json'),'utf8');
  assert.throws(()=>buildPaymentWorker(destination),/destination|exists/i);
  assert.equal(readFileSync(join(destination,'package.json'),'utf8'),before);
  assert.throws(()=>buildPaymentWorker('.'),/destination|exists/i);
 }finally {rmSync(owned,{recursive:true,force:true});}
});
