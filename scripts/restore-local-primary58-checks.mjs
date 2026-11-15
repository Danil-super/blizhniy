// Dormant drill helper. Caller must first prove a fresh owned disposable target, offline.
import {readFileSync} from 'node:fs';
import {getRefundWorkerRolePlan} from './refund-worker-role.mjs';
import {readRefundSchema,assertRefundSchema} from './refund-worker-schema.mjs';
export async function restoreLocalPrimary58Checks(db){
 try{
  if(typeof window!=='undefined'||process.env.NODE_ENV!=='test')throw Error();
  await db.transaction(async tx=>{
   await tx.query("set local statement_timeout='10s'");await tx.query("set local lock_timeout='3s'");await tx.query('set local search_path=pg_catalog');
   const identity=(await tx.query(`select current_database() as database,current_user as role,session_user as login,
    current_setting('server_version_num')::integer as version,current_setting('transaction_read_only') as readonly`)).rows[0];
   if(!identity||identity.database!=='blizhniy_prod'||identity.role!=='postgres'||identity.login!=='postgres'||identity.version<180000||identity.version>=190000||identity.readonly!=='off')throw Error();
   const journal=(await tx.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;
   if(JSON.stringify(journal)!==JSON.stringify(getRefundWorkerRolePlan('blizhniy_prod',{schema:58,localPrimary:true}).journal))throw Error();
   const restored=JSON.parse(readFileSync(new URL('../database/refund-schema-local-primary-restored-0058.json',import.meta.url),'utf8'));
   if(JSON.stringify(await readRefundSchema(tx))!==JSON.stringify(restored))throw Error();
   await tx.query("select set_config('blizhniy.restore_drill','owned-local58',true)");
   await tx.query(readFileSync(new URL('../database/restore/local-primary58-checks.sql',import.meta.url),'utf8'));
   await assertRefundSchema(tx,58,{localPrimary:true});
  });
 }catch{throw Error('Local58 restore preflight failed');}
}
