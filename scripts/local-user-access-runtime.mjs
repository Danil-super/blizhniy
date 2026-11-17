import {createRequire} from 'node:module';
import {verifyLocalPrimaryRefundTarget,assertLocalPrimaryRefundTrust} from './local-primary-refund-target.mjs';
import {verifyUserAccessDatabase} from './user-access-role.mjs';
const require=createRequire(import.meta.url),unavailable=()=>Error('Local user operator unavailable');
/** Explicit owned local database only. Import never connects or adopts credentials. */
export async function createLocalUserAccessRuntime(environment,{stateFile,project,tariffs=false}={}){
 let db,pool;
 try{
  const env={...environment};
  if(typeof tariffs!=='boolean'||typeof window!=='undefined'||process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0'||env.BLIZHNIY_DB_USER!=='blizhniy_user_operator'||
   env.BLIZHNIY_DB_NAME!=='blizhniy_prod'||env.BLIZHNIY_DB_HOST!=='127.0.0.1'||env.BLIZHNIY_DB_SSL_MODE!=='verify-full'||
   !/^[a-f0-9]{64}$/.test(env.BLIZHNIY_DB_PASSWORD??''))throw unavailable();
  const certificate=await verifyLocalPrimaryRefundTarget(env,{stateFile,project});
  const {PostgresDatabase,readPostgresConfig}=require('../compiled/lib/postgres.js'),{PostgresAdminUserAccess}=require('../compiled/lib/postgres-admin-user-access.js');
  const {AdminUserAccessError}=require('../compiled/lib/admin-user-access-contract.js'),config=readPostgresConfig(env);
  const {PostgresAdminTariffs}=require('../compiled/lib/postgres-admin-tariffs.js'),{AdminTariffError}=require('../compiled/lib/admin-tariff-contract.js');
  assertLocalPrimaryRefundTrust(config,certificate);
  pool=new(require('pg').Pool)({...config,max:3,statement_timeout:3000,application_name:'blizhniy-local-user-operator'});db=new PostgresDatabase(pool);
  await verifyUserAccessDatabase(db,{database:config.database,tariffs});
  const store=new PostgresAdminUserAccess(db),tariffStore=tariffs?new PostgresAdminTariffs(db):null;let closed=false,closing;
  return {execute:async(token,command,signal)=>{
   try{
    const deadline=performance.now()+12000,active=()=>{if(closed||signal?.aborted||performance.now()>=deadline)throw unavailable();};active();
    const current=await verifyLocalPrimaryRefundTarget(env,{stateFile,project});assertLocalPrimaryRefundTrust(config,current);
    active();await verifyUserAccessDatabase(db,{database:config.database,deadline,tariffs});active();
    if(performance.now()+6500>deadline)throw unavailable();
    if(command?.resource==='tariffs'){if(!tariffStore)throw unavailable();return await tariffStore.execute(token,command);}
    return await store.execute(token,command);
   }catch(error){if(error instanceof AdminUserAccessError||tariffs&&error instanceof AdminTariffError)throw error;throw unavailable();}
  },close:()=>closing??=(async()=>{closed=true;try{await db.close();}catch{throw unavailable();}})()};
 }catch{
  if(db)await Promise.allSettled([db.close()]);else if(pool)await Promise.allSettled([pool.end()]);
  throw unavailable();
 }
}
