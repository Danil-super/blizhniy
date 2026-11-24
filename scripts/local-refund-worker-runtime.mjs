import {isAbsolute} from 'node:path';
import {createRequire} from 'node:module';
import {verifyLocalPrimaryRefundTarget,assertLocalPrimaryRefundTrust} from './local-primary-refund-target.mjs';
import {verifyRefundWorkerDatabase} from './refund-worker-role.mjs';

const require=createRequire(import.meta.url);
function loadCompiledModules(){
 return{...require('../compiled/lib/postgres.js'),...require('../compiled/lib/placement-refund-worker.js'),
  ...require('../compiled/lib/application-compensation-worker.js'),...require('../compiled/lib/refund-merchant-preflight.js'),
  verifyRefundWorkerDatabase,Pool:require('pg').Pool};
}

/** Local disposable TEST database only; no implicit environment, installer or startup.
 * Trusted module/fetch seams are for composition tests, never environment-selected paths.
 */
export async function createLocalRefundWorkerRuntime(environment,options={}){
 return createRuntime(environment,options,'blizhniy_test');
}
/** Separate owned manual-stand entry; ordinary disposable admission remains unchanged. */
export async function createLocalPrimaryRefundWorkerRuntime(environment,{stateFile,project,...options}={}){
 try{
  const env={...environment},certificate=await verifyLocalPrimaryRefundTarget(env,{stateFile,project});
  return await createRuntime(env,options,'blizhniy_prod',certificate);
 }catch{throw Error('Local refund runtime unavailable');}
}
async function createRuntime(environment,options,database,certificate){
 let db,pool;
 try{
  const {loadModules=loadCompiledModules,fetcher=globalThis.fetch}=options;
  const env={...environment};
  const marqueeRefunds=env.BLIZHNIY_REFUND_WORKER==='hosted-marquee-schema-local-test';
  const hostedRefunds=(env.BLIZHNIY_REFUND_WORKER==='hosted-schema-local-test'||marqueeRefunds)&&database==='blizhniy_test'&&certificate===undefined;
  if(typeof window!=='undefined'||env.NODE_ENV!=='production'||(env.BLIZHNIY_REFUND_WORKER!=='local-test'&&!hostedRefunds)||env.BLIZHNIY_PAYMENT_MODE!=='test'||
   env.BLIZHNIY_DB_HOST!=='127.0.0.1'||env.BLIZHNIY_DB_NAME!==database||env.BLIZHNIY_DB_USER!=='blizhniy_refund_worker'||
   !/^\d{1,5}$/.test(env.BLIZHNIY_DB_PORT??'')||Number(env.BLIZHNIY_DB_PORT)<1||Number(env.BLIZHNIY_DB_PORT)>65535||!env.BLIZHNIY_DB_PASSWORD||
   env.BLIZHNIY_DB_SSL_MODE!=='verify-full'||!env.BLIZHNIY_DB_CA_FILE||!isAbsolute(env.BLIZHNIY_DB_CA_FILE)||
   [env,process.env].some(e=>e.NODE_TLS_REJECT_UNAUTHORIZED==='0'||Object.keys(e).some(k=>k.startsWith('PG')))||
   !/^[a-zA-Z0-9_-]{1,64}$/.test(env.BLIZHNIY_PAYMENT_SHOP_ID??'')||typeof env.BLIZHNIY_PAYMENT_SECRET_KEY!=='string'||
   !env.BLIZHNIY_PAYMENT_SECRET_KEY.startsWith('test_')||env.BLIZHNIY_PAYMENT_SECRET_KEY.length>2048||/[\s\u0000-\u001f\u007f]/.test(env.BLIZHNIY_PAYMENT_SECRET_KEY)||
   typeof fetcher!=='function')throw Error();
  const merchant=Object.freeze({shopId:env.BLIZHNIY_PAYMENT_SHOP_ID,secretKey:env.BLIZHNIY_PAYMENT_SECRET_KEY,isTest:true,
   ...(hostedRefunds?{marqueeRefunds}:{})});
  const modules=loadModules(),config=modules.readPostgresConfig(env);
  if(certificate!==undefined)assertLocalPrimaryRefundTrust(config,certificate);
  pool=new modules.Pool({...config,max:2,application_name:'blizhniy-local-refund-worker'});db=new modules.PostgresDatabase(pool);
  const placement=modules.createPlacementRefundWorker(db,merchant,fetcher),application=modules.createApplicationCompensationWorker(db,merchant,fetcher);
  const verify=()=>modules.verifyRefundWorkerDatabase(db,{database:config.database,merchant,
   ...(hostedRefunds?{hostedRefunds:true}:certificate!==undefined?{localPrimary:true}:{})});
  const probe=modules.createRefundMerchantPreflight(merchant,fetcher);
  let admitted=false,closed=false,active,closing;
  function exclusive(task,admission=false){
   if(closed||active||(!admission&&!admitted))return Promise.reject(Error('Local refund runtime unavailable'));
   if(admission)admitted=false;
   active=Promise.resolve().then(async()=>{
    try{await verify();if(closed)throw Error();const value=await task();if(closed)throw Error();
     if(value?.code==='processing_unavailable'||value?.processing?.code==='processing_unavailable')admitted=false;
     return value;}
    catch{admitted=false;throw Error('Local refund runtime unavailable');}
   });
   return active.finally(()=>{active=undefined;});
  }
  return{
   preflight:()=>exclusive(async()=>{await probe();await verify();if(!closed)admitted=true;},true),
   placement:{tick:()=>exclusive(()=>placement.tick())},application:{sweep:()=>exclusive(()=>application.sweep())},
   close:()=>closing??=(async()=>{closed=true;admitted=false;try{await active;}catch{ /* Drain before closing the owned pool. */ }try{await db.close();}catch{throw Error('Local refund runtime unavailable');}})(),
  };
 }catch{
  try{if(db)await db.close();else if(pool)await pool.end();}catch{ /* Keep credentials and driver details out of errors. */ }
  throw Error('Local refund runtime unavailable');
 }
}
