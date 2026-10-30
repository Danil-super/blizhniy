// Explicit additive install in the owned loopback fixture only. Never loads production config.
import {readFile} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import pg from 'pg';
import {getBootstrapPlan} from './bootstrap-postgres.mjs';
import {stateDirectory,stateFile,docker,localPrimaryDatabaseConfig,getLocalPrimaryExtraMigrations} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
import {getLocalTelegramMigrations,withoutTransaction} from './local-telegram-migrations.mjs';
import {getLocalDeletionMigrations} from './local-deletion-schema.mjs';
export async function installLocalDeletion({apply=false}={}){
 const root=realpathSync(fileURLToPath(new URL('..',import.meta.url)));
 const state=readLocalPrimaryState(stateFile,root);
 validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
 const ready=JSON.parse(await readFile(join(stateDirectory,'ready.json'),'utf8'));
 if(ready.version!==1||ready.containerId!==state.containerId)throw Error('Owned local fixture not ready');
 const before=[...getBootstrapPlan({includeListingContactMethod:true}),...await getLocalPrimaryExtraMigrations(),...await getLocalTelegramMigrations()].map(({name,sha256})=>({name,sha256}));
 const additions=await getLocalDeletionMigrations(),after=[...before,...additions.map(({name,sha256})=>({name,sha256}))];
 const owner=new pg.Client(localPrimaryDatabaseConfig(state,'owner'));await owner.connect();
 try{
  await owner.query('begin');
  try{
   await owner.query("set local lock_timeout='3s';set local statement_timeout='10s'");
   await owner.query('lock table blizhniy_meta.migrations in exclusive mode');
   const journal=(await owner.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;
   const old=JSON.stringify(journal)===JSON.stringify(before),current=JSON.stringify(journal)===JSON.stringify(after);
   if(!old&&!current)throw Error('Unexpected local migration journal; no writes');
   const role=(await owner.query("select rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolreplication,rolbypassrls from pg_roles where rolname='blizhniy_runtime'")).rows[0];
   if(!role||Object.values(role).some(Boolean))throw Error('Unexpected runtime authority');
   const excessive=(await owner.query(`select
    exists(select 1 from pg_auth_members m join pg_roles r on r.oid=m.member where r.rolname='blizhniy_runtime') as membership,
    has_table_privilege('blizhniy_runtime','app.users','DELETE') as erase_users,
    has_column_privilege('blizhniy_runtime','app.users','role','UPDATE') as change_roles,
    has_column_privilege('blizhniy_runtime','app.listings','is_paid','UPDATE') as listing_paid,
    has_column_privilege('blizhniy_runtime','app.listings','published_at','UPDATE') as publish_dates,
    has_column_privilege('blizhniy_runtime','app.listings','expires_at','UPDATE') as paid_expiry,
    has_column_privilege('blizhniy_runtime','app.payment_orders','status','UPDATE') as payment_status`)).rows[0];
   if(!excessive||Object.values(excessive).some(Boolean))throw Error('Unexpected local erasure, role or payment authority');
   if(old){
    if(!apply)throw Error('Local deletion migration not installed');
    for(const {name,source,sha256} of additions){
     await owner.query(withoutTransaction(source));
     await owner.query('insert into blizhniy_meta.migrations(name,sha256) values($1,$2)',[name,sha256]);
    }
    await owner.query(withoutTransaction(await readFile(new URL('../database/permissions/account-deletion.sql',import.meta.url),'utf8')));
   }
   const checks=(await owner.query(`select
    has_column_privilege('blizhniy_runtime','app.account_deletion_requests','user_id','INSERT') as intake,
    has_column_privilege('blizhniy_runtime','app.account_deletion_requests','status','UPDATE') as review,
    has_table_privilege('blizhniy_runtime','app.account_deletion_requests','SELECT') as readable,
    has_table_privilege('blizhniy_runtime','app.account_deletion_events','SELECT') as audit_read,
    has_table_privilege('blizhniy_runtime','app.account_deletion_requests','DELETE') as erase,
    has_table_privilege('blizhniy_runtime','app.account_deletion_events','INSERT,UPDATE,DELETE') as audit_write,
    has_column_privilege('blizhniy_runtime','app.account_deletion_requests','user_id','UPDATE') as reassign,
    has_column_privilege('blizhniy_runtime','app.account_deletion_requests','requested_at','UPDATE') as redating,
    has_column_privilege('blizhniy_runtime','app.account_deletion_requests','revision','UPDATE') as revision_write`)).rows[0];
   if(!checks.intake||!checks.review||!checks.readable||!checks.audit_read||checks.erase||checks.audit_write||checks.reassign||checks.redating||checks.revision_write)throw Error('Unexpected deletion grants');
   await owner.query('commit');return {ready:true,installed:old,origin:state.origin};
  }catch(error){await owner.query('rollback');throw error;}
 }finally{await owner.end();}
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==3||!['--check','--apply'].includes(process.argv[2]))throw Error('Use --check or --apply');
 installLocalDeletion({apply:process.argv[2]==='--apply'}).then(value=>console.log(JSON.stringify(value))).catch(()=>{console.error('Local deletion setup refused. Data preserved; inspect the owned fixture.');process.exitCode=1;});
}
