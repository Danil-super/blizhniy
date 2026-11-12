import {isAbsolute} from 'node:path';
import {createRequire} from 'node:module';
import {verifyRefundOperatorDatabase} from './refund-operator-role.mjs';

const require=createRequire(import.meta.url),unavailable=()=>Error('Local refund operator unavailable');
function loadCompiledModules(){
 return{...require('../compiled/lib/postgres.js'),...require('../compiled/lib/postgres-refund-approvals.js'),
  ...require('../compiled/lib/primary-refund-recovery.js'),...require('../compiled/lib/refund-merchant-preflight.js'),
  ...require('../compiled/lib/placement-refund-approval.js'),...require('../compiled/lib/listing-draft-contract.js'),
  ...require('../compiled/lib/identity.js'),verifyRefundOperatorDatabase,Pool:require('pg').Pool};
}

/** Explicit private local TEST capability. Every command rechecks admission; canonical stores authorize the live admin.
 * Unknown results require an explicit same-ID call. No HTTP listener, send method, ambient config or command/SQL retry.
 */
export async function createLocalRefundOperatorRuntime(environment,{loadModules=loadCompiledModules,fetcher=globalThis.fetch}={}){
 let db,pool;
 try{
  const env={...environment};
  if(typeof window!=='undefined'||env.NODE_ENV!=='production'||env.BLIZHNIY_REFUND_OPERATOR!=='local-test'||env.BLIZHNIY_PAYMENT_MODE!=='test'||
   env.BLIZHNIY_DB_HOST!=='127.0.0.1'||env.BLIZHNIY_DB_NAME!=='blizhniy_test'||env.BLIZHNIY_DB_USER!=='blizhniy_refund_operator'||
   !/^\d{1,5}$/.test(env.BLIZHNIY_DB_PORT??'')||Number(env.BLIZHNIY_DB_PORT)<1||Number(env.BLIZHNIY_DB_PORT)>65535||!env.BLIZHNIY_DB_PASSWORD||
   env.BLIZHNIY_DB_SSL_MODE!=='verify-full'||!env.BLIZHNIY_DB_CA_FILE||!isAbsolute(env.BLIZHNIY_DB_CA_FILE)||
   [env,process.env].some(e=>e.NODE_TLS_REJECT_UNAUTHORIZED==='0'||Object.keys(e).some(k=>k.startsWith('PG')))||
   !/^[a-zA-Z0-9_-]{1,64}$/.test(env.BLIZHNIY_PAYMENT_SHOP_ID??'')||typeof env.BLIZHNIY_PAYMENT_SECRET_KEY!=='string'||
   !env.BLIZHNIY_PAYMENT_SECRET_KEY.startsWith('test_')||env.BLIZHNIY_PAYMENT_SECRET_KEY.length>2048||/[\s\u0000-\u001f\u007f]/.test(env.BLIZHNIY_PAYMENT_SECRET_KEY)||
   typeof fetcher!=='function')throw unavailable();
  const merchant=Object.freeze({shopId:env.BLIZHNIY_PAYMENT_SHOP_ID,secretKey:env.BLIZHNIY_PAYMENT_SECRET_KEY,isTest:true}),modules=loadModules();
  let closed=false,active,closing;
  const readOnlyFetch=(url,init)=>{if(closed||init?.method!=='GET')throw unavailable();init.signal?.throwIfAborted();return fetcher(url,init);};
  const config=modules.readPostgresConfig(env);pool=new modules.Pool({...config,max:2,application_name:'blizhniy-local-refund-operator'});db=new modules.PostgresDatabase(pool);
  const approvals=new modules.PostgresRefundApprovalStore(db,merchant),recovery=modules.createPrimaryRefundRecovery(db,merchant,readOnlyFetch);
  const verify=()=>modules.verifyRefundOperatorDatabase(db,{database:config.database,merchant}),probe=modules.createRefundMerchantPreflight(merchant,readOnlyFetch);
  async function admitMerchant(){await probe();if(closed)throw unavailable();await verify();if(closed)throw unavailable();}
  function execute(work,merchantAdmission=false){
   if(closed||active)return Promise.reject(unavailable());
   active=Promise.resolve().then(async()=>{
    try{
     await verify();if(closed)throw unavailable();if(merchantAdmission)await admitMerchant();
     const result=await work();if(closed)throw unavailable();return result;
    }catch{throw unavailable();}
   });
   return active.finally(()=>{active=undefined;});
  }
  function command(kind,token,expectedAdmin,value){
   try{
    if(!modules.hashSessionToken(token))throw unavailable();
    const actor=modules.parseListingDraftId(expectedAdmin),input=kind==='approve'?modules.parsePlacementRefundApproval(value):kind==='read'?modules.parseListingDraftId(value):modules.parseRefundRecovery(value);
    return execute(async()=>{
     if(kind==='approve')return approvals.approve(token,actor,input);
     if(kind==='read')return approvals.readForAdmin(token,actor,input);
     // Read a committed terminal action even when the provider is unavailable.
     const completed=await recovery.prepare(token,actor,input);if(closed)throw unavailable();if(completed)return completed;
     await admitMerchant();return recovery.recover(token,actor,input);
    },kind==='approve');
   }catch{return Promise.reject(unavailable());}
  }
  return{preflight:()=>execute(async()=>undefined,true),approve:(...args)=>command('approve',...args),readForAdmin:(...args)=>command('read',...args),recover:(...args)=>command('recover',...args),
   close:()=>closing??=(async()=>{closed=true;try{await active;}catch{ /* Drain the current command before closing its pool. */ }try{await db.close();}catch{throw unavailable();}})()};
 }catch{
  try{if(db)await db.close();else if(pool)await pool.end();}catch{ /* Preserve the redacted error. */ }
  throw unavailable();
 }
}
