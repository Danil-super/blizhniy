// Review candidate: no connections, role adoption, migration or grant executor.
import {getRefundWorkerRolePlan} from './refund-worker-role.mjs';
import {getMediaRetentionMigration} from './media-retention-release.mjs';
import {assertRefundSchema} from './refund-worker-schema.mjs';
import {assertFinancialCatalogPrivileges} from './financial-catalog-privileges.mjs';
const role='blizhniy_media_cleanup',columns=text=>text.split(',');
const policy={
 'app.media_objects':{select:columns('id,mime_type,width,height,size,sha256'),update:['id']},
 'app.media_write_attempts':{select:columns('id,media_id')},
 'app.media_retirement_requests':{select:columns('media_id,operation_id'),insert:columns('media_id,operation_id')},
 'app.media_retirement_completions':{select:['media_id'],insert:columns('media_id,operation_id')},
 'blizhniy_meta.migrations':{select:columns('name,sha256')},
};
const validDatabase=value=>typeof value==='string'&&/^[a-zA-Z0-9_.-]{1,63}$/.test(value);
export function getMediaRetentionRolePlan(database){
 if(!validDatabase(database))throw Error('Invalid media retention database');
 const {name,sha256}=getMediaRetentionMigration();
 return{role,createRole:`create role ${role} nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls connection limit 2`,
  journal:[...getRefundWorkerRolePlan(database,{schema:57}).journal,{name,sha256}],
  grants:[`grant connect on database "${database}" to ${role}`,`grant usage on schema app,blizhniy_meta to ${role}`,
   ...Object.entries(policy).flatMap(([table,access])=>Object.entries(access).map(([privilege,names])=>`grant ${privilege}(${names.join(',')}) on ${table} to ${role}`))]};
}
export const mediaRetentionRuntimeGrants=[
 'grant select(media_id) on app.media_retirement_requests to blizhniy_runtime',
 'grant select(owner_id,charged_bytes,charged_objects) on app.media_active_usage to blizhniy_runtime',
];
/** Dedicated local role only; exact journal, schema and ACL. No owner fallback or object repair. */
export async function verifyMediaRetentionDatabase(db,{database}={}){
 try{
  if(database!=='blizhniy_prod')throw Error();const plan=getMediaRetentionRolePlan(database);
  await db.transaction(async tx=>{
   await tx.query("set local statement_timeout='5s'");await tx.query("set local lock_timeout='1s'");await tx.query("set local search_path=pg_catalog");
   const identity=(await tx.query(`select current_user as name,session_user as login,current_database() as database,
    current_setting('server_version_num')::integer as version,current_setting('transaction_read_only') as readonly,
    current_setting('session_replication_role') as replication,rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolreplication,rolbypassrls,rolcanlogin,rolconnlimit,
    exists(select 1 from pg_auth_members where roleid=r.oid or member=r.oid) as membership,
    exists(select 1 from pg_shdepend where refclassid='pg_authid'::regclass and refobjid=r.oid and deptype='o') as ownership,
    has_database_privilege(current_database(),'CONNECT') as connect,
    has_database_privilege(current_database(),'CREATE,TEMP,CONNECT WITH GRANT OPTION') as database_extra,
    has_parameter_privilege('session_replication_role','SET,ALTER SYSTEM') as replication_override
    from pg_roles r where rolname=current_user`)).rows[0];
   if(!identity||identity.name!==role||identity.login!==role||identity.database!==database||identity.version<180000||identity.version>=190000||
    identity.readonly!=='on'||identity.replication!=='origin'||identity.rolcanlogin!==true||identity.rolconnlimit!==2||identity.connect!==true||
    ['rolsuper','rolcreatedb','rolcreaterole','rolinherit','rolreplication','rolbypassrls','membership','ownership','database_extra','replication_override'].some(key=>identity[key]!==false))throw Error();
   const journal=(await tx.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;
   if(JSON.stringify(journal)!==JSON.stringify(plan.journal))throw Error();
   await assertRefundSchema(tx,58,{localPrimary:true});await assertFinancialCatalogPrivileges(tx);
   const actual=(await tx.query(`select n.nspname||'.'||c.relname||'.'||a.attname||':'||p.privilege as key,
    has_column_privilege(c.oid,a.attnum,p.privilege||' WITH GRANT OPTION') as grantable
    from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid
    cross join (values('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) p(privilege)
    where n.nspname not in ('pg_catalog','information_schema') and c.relkind in ('r','p','v','m','f','t')
     and a.attnum>0 and not a.attisdropped and has_column_privilege(c.oid,a.attnum,p.privilege) limit 10001`)).rows;
   const expected=new Set(Object.entries(policy).flatMap(([table,access])=>Object.entries(access).flatMap(([privilege,names])=>names.map(name=>`${table}.${name}:${privilege.toUpperCase()}`))));
   if(actual.length!==expected.size||actual.some(item=>item.grantable!==false||!expected.delete(item.key))||expected.size)throw Error();
   if((await tx.query(`select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname not in ('pg_catalog','information_schema') and
    ((c.relkind in ('r','p','v','m','f','t') and has_table_privilege(c.oid,'DELETE,TRUNCATE,TRIGGER,MAINTAIN')) or
     (c.relkind='S' and has_sequence_privilege(c.oid,'USAGE,SELECT,UPDATE'))) limit 1`)).rows.length||
    (await tx.query(`select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname not in ('pg_catalog','information_schema') and has_function_privilege(p.oid,'EXECUTE') limit 1`)).rows.length||
    (await tx.query("select 1 from pg_namespace where has_schema_privilege(oid,'CREATE') limit 1")).rows.length)throw Error();
  },{readOnly:true});
 }catch{throw Error('Media cleanup database preflight failed');}
}

/** Only new object families: old web privileges are not broadened or re-granted. */
export async function verifyMediaRetentionRuntimeAccess(tx){
 const role=(await tx.query(`select rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolreplication,rolbypassrls,
  exists(select 1 from pg_auth_members where roleid=r.oid or member=r.oid) as membership
  from pg_roles r where rolname='blizhniy_runtime'`)).rows[0];
 if(!role||role.rolcanlogin!==true||Object.entries(role).some(([key,value])=>key!=='rolcanlogin'&&value!==false))throw Error('Invalid local media web access');
 const expected=new Set(['app.media_retirement_requests.media_id:SELECT',...['owner_id','charged_bytes','charged_objects'].map(name=>'app.media_active_usage.'+name+':SELECT')]);
 const actual=(await tx.query(`select n.nspname||'.'||c.relname||'.'||a.attname||':'||p.privilege as key,
  has_column_privilege('blizhniy_runtime',c.oid,a.attnum,p.privilege||' WITH GRANT OPTION') as grantable
  from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid
  cross join (values('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) p(privilege)
  where n.nspname='app' and c.relname in ('media_reference_events','media_payment_reference_captures','media_retirement_requests','media_retirement_completions','media_active_usage')
   and a.attnum>0 and not a.attisdropped and has_column_privilege('blizhniy_runtime',c.oid,a.attnum,p.privilege) limit 10001`)).rows;
 if(actual.length!==expected.size||actual.some(item=>item.grantable!==false||!expected.delete(item.key))||expected.size)throw Error('Invalid local media web access');
 const extra=(await tx.query(`select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app' and
  ((c.relname in ('media_reference_events','media_payment_reference_captures','media_retirement_requests','media_retirement_completions','media_active_usage') and has_table_privilege('blizhniy_runtime',c.oid,'DELETE,TRUNCATE,TRIGGER,MAINTAIN')) or
   (c.relname='media_reference_events_event_id_seq' and has_sequence_privilege('blizhniy_runtime',c.oid,'USAGE,SELECT,UPDATE'))) limit 1`)).rows;
 const callable=(await tx.query(`select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app' and
  p.proname in ('media_retention_clock','guard_media_reference_events','media_reference_ids','journal_media_reference_change','capture_payment_media','journal_payment_media','guard_media_retirement_request','guard_media_retirement_completion','release_completed_media_budget','guard_retired_media_write')
  and has_function_privilege('blizhniy_runtime',p.oid,'EXECUTE') limit 1`)).rows;
 if(extra.length||callable.length)throw Error('Invalid local media web access');
}
