import {realpathSync} from 'node:fs';
import {mkdtemp,symlink,rm} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import pg from 'pg';
import {readLocalPrimaryState} from './local-primary-config.mjs';
import {readLocalPrimaryRefundConfig} from './local-primary-refund-config.mjs';
import {verifyLocalPrimaryRefundTarget,assertLocalPrimaryRefundTrust} from './local-primary-refund-target.mjs';
import {buildRefundOperator} from './build-refund-operator.mjs';
import {buildRefundWorker} from './build-refund-worker.mjs';
import {getRefundOperatorRolePlan} from './refund-operator-role.mjs';
import {assertRefundSchema} from './refund-worker-schema.mjs';
import {createLocalPrimaryRefundProvider} from './local-primary-refund-provider.mjs';
import {localPrimaryMerchant} from './local-primary-payment.mjs';

const root=realpathSync(fileURLToPath(new URL('..',import.meta.url))),unavailable=()=>Error('Local primary refunds unavailable');
/** Explicit owned stand only. Fresh checked artifacts, fixed fake provider, no installer or real merchant. */
export async function startLocalPrimaryRefunds({stateFile,signal,report}={}){
 let directory,ownerDb,services,cleaning,closing;
 const cleanup=()=>cleaning??=(async()=>{
  let failed=false;
  try{await ownerDb?.close();}catch{failed=true;}
  if(directory)try{await rm(directory,{recursive:true,force:true});}catch{failed=true;}
  return failed;
 })();
 try{
  if(typeof window!=='undefined'||process.env.NODE_ENV!=='test'||process.env.BLIZHNIY_LOCAL_PRIMARY!=='enabled'||
   process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0'||Object.keys(process.env).some(key=>key.startsWith('PG'))||
   !(signal instanceof AbortSignal)||signal.aborted||typeof report!=='function')throw unavailable();
  const state=readLocalPrimaryState(stateFile,root),parent=dirname(stateFile),config=readLocalPrimaryRefundConfig(join(parent,'refunds.json'),state);
  if(process.env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN!==state.origin)throw unavailable();
  const env={NODE_ENV:'production',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_PAYMENT_MODE:'test',BLIZHNIY_DB_HOST:'127.0.0.1',
   BLIZHNIY_DB_PORT:String(state.dbPort),BLIZHNIY_DB_NAME:state.database,BLIZHNIY_DB_SSL_MODE:'verify-full',BLIZHNIY_DB_CA_FILE:join(parent,'refund-db-ca.pem'),
   BLIZHNIY_PAYMENT_SHOP_ID:localPrimaryMerchant.shopId,BLIZHNIY_PAYMENT_SECRET_KEY:localPrimaryMerchant.secretKey};
  const certificate=await verifyLocalPrimaryRefundTarget(env,{stateFile,project:root});signal.throwIfAborted();
  directory=await mkdtemp(join(parent,'refund-runtime-'));signal.throwIfAborted();
  const operatorPath=join(directory,'operator'),workerPath=join(directory,'worker');
  buildRefundOperator(operatorPath);signal.throwIfAborted();buildRefundWorker(workerPath,{schema:55});signal.throwIfAborted();
  for(const destination of [operatorPath,workerPath])await symlink(join(root,'node_modules'),join(destination,'node_modules'),'dir');
  const require=createRequire(join(workerPath,'package.json')),{PostgresDatabase,readPostgresConfig}=require('./compiled/lib/postgres.js');
  const ownerConfig=readPostgresConfig({...env,BLIZHNIY_DB_USER:'postgres',BLIZHNIY_DB_PASSWORD:state.ownerPassword});
  assertLocalPrimaryRefundTrust(ownerConfig,certificate);signal.throwIfAborted();
  ownerDb=new PostgresDatabase(new pg.Pool({...ownerConfig,max:2,application_name:'blizhniy-local-refund-provider'}));
  await ownerDb.transaction(async tx=>{
   await tx.query("set local statement_timeout='5s'");await tx.query("set local lock_timeout='1s'");
   const journal=(await tx.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;
   if(JSON.stringify(journal)!==JSON.stringify(getRefundOperatorRolePlan(state.database).journal))throw unavailable();
   await assertRefundSchema(tx,55,{localPrimary:true});
  },{readOnly:true});signal.throwIfAborted();
  const fetcher=await createLocalPrimaryRefundProvider({state,ownerDb});signal.throwIfAborted();
  const operator=await import(pathToFileURL(join(operatorPath,'scripts/local-refund-operator-runtime.mjs')).href);
  const server=await import(pathToFileURL(join(operatorPath,'scripts/local-refund-operator-server.mjs')).href);
  const worker=await import(pathToFileURL(join(workerPath,'scripts/local-refund-worker-runtime.mjs')).href);
  const {startLocalRefundServices}=await import(pathToFileURL(join(workerPath,'scripts/local-refund-services.mjs')).href);
  services=await startLocalRefundServices({signal,report,startOperatorServer:server.startLocalRefundOperatorServer,
   createOperator:()=>operator.createLocalPrimaryRefundOperatorRuntime({...env,BLIZHNIY_REFUND_OPERATOR:'local-test',BLIZHNIY_DB_USER:'blizhniy_refund_operator',BLIZHNIY_DB_PASSWORD:config.operatorPassword},{stateFile,project:root,fetcher}),
   createWorker:()=>worker.createLocalPrimaryRefundWorkerRuntime({...env,BLIZHNIY_REFUND_WORKER:'local-test',BLIZHNIY_DB_USER:'blizhniy_refund_worker',BLIZHNIY_DB_PASSWORD:config.workerPassword},{stateFile,project:root,fetcher}),
  });
  const done=services.done.then(async code=>(await cleanup())?1:code);
  if(signal.aborted){await services.close();await done;throw unavailable();}
  return{socketPath:services.socketPath,done,close:()=>closing??=(async()=>{
   let failed=false;try{await services.close();}catch{failed=true;}
   if(await done!==0||failed)throw unavailable();
  })()};
 }catch{
  try{await services?.close();}catch{ /* Drain before closing the provider and artifacts. */ }
  await cleanup();throw unavailable();
 }
}
