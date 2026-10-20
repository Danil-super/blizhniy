import {isAbsolute} from 'node:path';
import {createRequire} from 'node:module';
import {verifyPaymentReconciliationDatabase} from './payment-reconciliation-role.mjs';

const require=createRequire(import.meta.url);
function loadCompiledModules(){
 return{...require('../compiled/lib/postgres.js'),...require('../compiled/lib/payment-reconciliation-worker.js'),...require('../compiled/lib/account-test-payment-verifier.js'),Pool:require('pg').Pool};
}

/** Private TEST-only financial process; no fallback to the HTTP role, operator or live merchant.
 * loadModules is a trusted composition/test seam, never an environment/module-path override.
 * Factory validates locally only; preflight is explicitly read-only and precedes any tick.
 */
export async function createPaymentWorkerRuntime(environment=process.env,{loadModules=loadCompiledModules}={}){
 let db,pool;
 try {
  const env={...environment};
  if(typeof window!=='undefined'||env.NODE_ENV!=='production'||!['queued-test','account-test'].includes(env.BLIZHNIY_PAYMENT_WORKER)||env.BLIZHNIY_PAYMENT_MODE!=='test'||
   env.BLIZHNIY_DB_HOST!=='17e86f80f26733d39ef4b84d.twc1.net'||env.BLIZHNIY_DB_PORT!=='5432'||env.BLIZHNIY_DB_NAME!=='blizhniy_prod'||
   env.BLIZHNIY_DB_USER!=='blizhniy_payment_reconciler'||!env.BLIZHNIY_DB_PASSWORD||env.BLIZHNIY_DB_SSL_MODE!=='verify-full'||
   !env.BLIZHNIY_DB_CA_FILE||!isAbsolute(env.BLIZHNIY_DB_CA_FILE)||env.NODE_TLS_REJECT_UNAUTHORIZED==='0'||
   [env,process.env].some(source=>Object.keys(source).some(key=>key.startsWith('PG')))||process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0'||
   !/^[a-zA-Z0-9_-]{1,64}$/.test(env.BLIZHNIY_PAYMENT_SHOP_ID??'')||
   typeof env.BLIZHNIY_PAYMENT_SECRET_KEY!=='string'||!env.BLIZHNIY_PAYMENT_SECRET_KEY.startsWith('test_')||
   env.BLIZHNIY_PAYMENT_SECRET_KEY.length>2048||/[\s\u0000-\u001f\u007f]/.test(env.BLIZHNIY_PAYMENT_SECRET_KEY))throw Error('Invalid worker configuration');
  if(env.BLIZHNIY_PAYMENT_WORKER==='account-test'&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(env.BLIZHNIY_PAYMENT_TEST_USER_ID??''))throw Error('Invalid account TEST owner');
  const merchant=Object.freeze({shopId:env.BLIZHNIY_PAYMENT_SHOP_ID,isTest:true,secretKey:env.BLIZHNIY_PAYMENT_SECRET_KEY});
  const {readPostgresConfig,PostgresDatabase,Pool,createPaymentReconciliationWorker,createAccountTestPaymentVerifier}=loadModules();
  const config=readPostgresConfig(env);
  pool=new Pool({...config,max:2,application_name:'blizhniy-payment-reconciler'});
  db=new PostgresDatabase(pool);
  const worker=env.BLIZHNIY_PAYMENT_WORKER==='account-test'?createAccountTestPaymentVerifier(db,Object.freeze({...merchant,ownerId:env.BLIZHNIY_PAYMENT_TEST_USER_ID})):createPaymentReconciliationWorker(db,merchant);
  let closing;
  return{worker,preflight:()=>verifyPaymentReconciliationDatabase(db,{database:config.database}),
   close:()=>closing??=db.close()};
 }catch {
  try {if(db)await db.close();else if(pool)await pool.end();}catch { /* Never replace the generic configuration error with driver details. */ }
  throw Error('Payment worker configuration unavailable');
 }
}
