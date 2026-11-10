// Dormant operator library: sources/SQL only, no connection, role adoption or grant executor.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {getBootstrapPlan} from './postgres-migration-plan.mjs';
import {getCabinetMigrationPlan} from './cabinet-release-plan.mjs';

const role='blizhniy_refund_worker',locks=['users','payment_checkout_intents','payment_orders'];
const suffix=['0033-account-deletion.sql','0034-checkout-edit-fence.sql','0035-application-contact-views.sql','0036-placement-refund-reservations.sql','0037-refund-requests.sql','0038-refund-journal.sql','0039-refund-dispatch.sql','0040-placement-refund-effects.sql','0041-booking-lifecycle.sql','0042-placement-refund-approvals.sql','0043-application-compensation-cases.sql','0044-work-owner-actions.sql','0045-customer-closure-compensation.sql','0046-response-checkout-fence.sql','0047-checkout-cancellation.sql','0048-application-compensation-refunds.sql','0049-application-compensation-queue.sql','0050-application-compensation-discovery.sql','0051-refund-recovery.sql','0052-placement-refund-queue.sql','0053-application-compensation-lease.sql','0054-refund-worker-locks.sql'];
const cols=text=>text.split(',');
// PG18.6 information_schema.sql grants these SELECTs after initdb records pg_init_privs.
const publicMetadata=cols('information_schema_catalog_name,applicable_roles,administrable_role_authorizations,attributes,character_sets,check_constraint_routine_usage,check_constraints,collations,collation_character_set_applicability,column_column_usage,column_domain_usage,column_privileges,column_udt_usage,columns,constraint_column_usage,constraint_table_usage,domain_constraints,domain_udt_usage,domains,enabled_roles,key_column_usage,parameters,referential_constraints,role_column_grants,routine_column_usage,routine_privileges,role_routine_grants,routine_routine_usage,routine_sequence_usage,routine_table_usage,routines,schemata,sequences,sql_features,sql_implementation_info,sql_sizing,table_constraints,table_privileges,role_table_grants,tables,triggered_update_columns,triggers,udt_privileges,role_udt_grants,usage_privileges,role_usage_grants,user_defined_types,view_column_usage,view_routine_usage,view_table_usage,views,data_type_privileges,element_types,column_options,foreign_data_wrapper_options,foreign_data_wrappers,foreign_server_options,foreign_servers,foreign_table_options,foreign_tables,user_mapping_options,user_mappings');
const policy={
 'app.users':{select:['id'],update:['id']},
 'app.payment_checkout_intents':{select:cols('id,owner_id,target_type,target_id,target_revision,tariff_id,amount,duration_days,merchant_shop_id,is_test,request_body,request_sha256,created_at'),update:['id']},
 'app.payment_orders':{select:cols('id,status'),update:['id']},
 'app.payment_provider_links':{select:cols('intent_id,provider_payment_id')},
 'app.payment_verifications':{select:cols('intent_id,provider_payment_id,status,captured_at')},
 'app.payment_refund_approvals':{select:cols('id,payment_intent_id,approved_by,reason,policy_version,fiscal_mode,amount,approved_at')},
 'app.payment_refund_reservations':{select:cols('id,payment_intent_id,provider_payment_id,merchant_shop_id,is_test,amount,created_at'),insert:cols('id,payment_intent_id,provider_payment_id,merchant_shop_id,is_test,amount')},
 'app.payment_refund_requests':{select:cols('operation_id,idempotence_key,request_body,request_sha256,created_at'),insert:cols('operation_id,idempotence_key,request_body')},
 'app.payment_refund_dispatch_anchors':{select:cols('operation_id,authorized_at'),insert:['operation_id']},
 'app.payment_refund_send_attempts':{select:cols('id,operation_id,request_sha256'),insert:cols('id,operation_id')},
 'app.payment_refund_candidates':{select:cols('operation_id,attempt_id,provider_refund_id'),insert:cols('operation_id,attempt_id,provider_refund_id')},
 'app.payment_refund_provider_links':{select:cols('operation_id,provider_refund_id'),insert:cols('operation_id,provider_refund_id')},
 'app.payment_refund_observations':{select:cols('operation_id,provider_refund_id,status,provider_created_at,observed_at'),insert:cols('operation_id,provider_refund_id,status,provider_created_at')},
 'app.payment_refund_effects':{select:cols('operation_id,merchant_shop_id,payment_intent_id,provider_refund_id,target_type,target_id,effect,applied_at'),insert:cols('operation_id,merchant_shop_id')},
 'app.application_compensation_cases':{select:cols('payment_intent_id,application_id,merchant_shop_id,policy_version,amount,fiscal_mode,reason,eligible_at,delivered_at,contact_view_at,selected_application_id,created_at'),insert:cols('payment_intent_id,merchant_shop_id')},
 'app.application_compensation_refunds':{select:cols('payment_intent_id,merchant_shop_id,application_id,provider_refund_id,amount,applied_at'),insert:cols('payment_intent_id,merchant_shop_id')},
 'blizhniy_meta.migrations':{select:['name','sha256']},
};
const functions=[
 'app.lock_application_compensation_source(uuid,text)','app.refund_target_admitted(uuid,uuid)',
 'app.next_application_compensation_candidates(text,integer)',
 'app.enqueue_application_compensation_batch(text,integer)','app.claim_application_compensation_job(text)',
 'app.owns_application_compensation_job(text,uuid,uuid)','app.finish_application_compensation_job(text,uuid,uuid,text,text)',
 'app.assert_application_compensation_job(text,uuid,uuid)','app.assert_application_compensation_job_remaining(text,uuid,uuid)',
 'app.enqueue_placement_refund_batch(text,integer)','app.claim_placement_refund_job(text)',
 'app.owns_placement_refund_job(text,uuid,uuid)','app.finish_placement_refund_job(text,uuid,uuid,text,text)',
 'app.assert_placement_refund_job(text,uuid,uuid)',
];
const validDatabase=value=>typeof value==='string'&&/^[a-zA-Z0-9_.-]{1,63}$/.test(value);
function journal(){return[...getBootstrapPlan({includeListingContactMethod:true}),...getCabinetMigrationPlan(),...suffix.map(name=>{
 const source=readFileSync(new URL('../database/migrations/'+name,import.meta.url),'utf8');
 if(!/^begin;$/m.test(source)||!/commit;\s*$/.test(source))throw Error('Invalid refund migration');
 return{name,sha256:createHash('sha256').update(source).digest('hex')};
})].map(({name,sha256})=>({name,sha256}));}

export function getRefundWorkerRolePlan(database){
 if(!validDatabase(database))throw Error('Invalid refund database');
 return{role,createRole:`create role ${role} nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls connection limit 4`,journal:journal(),
  grants:[`grant connect on database "${database}" to ${role}`,`grant usage on schema app,blizhniy_meta to ${role}`,
   ...Object.entries(policy).flatMap(([table,access])=>Object.entries(access).map(([privilege,names])=>`grant ${privilege}(${names.join(',')}) on ${table} to ${role}`)),
   ...functions.map(signature=>`grant execute on function ${signature} to ${role}`)]};
}

/** Read-only identity/ACL/journal/lock-guard admission, not full live-schema attestation.
 * Trusted TEST financial process; merchant isolation is enforced by the stores, not SQL RLS.
 * No managed membership exception, production runtime wiring or automatic activation.
 */
export async function verifyRefundWorkerDatabase(db,{database,merchant}={}){
 try{
  if(!validDatabase(database)||!merchant||merchant.isTest!==true||typeof merchant.shopId!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(merchant.shopId))throw Error('Invalid refund target');
  const expectedJournal=journal();
  await db.transaction(async tx=>{
   await tx.query("set local statement_timeout='5s'");
   await tx.query("set local lock_timeout='1s'");
   await tx.query('set local search_path=pg_catalog');
   const identity=(await tx.query(`select current_user as name,session_user as login,current_database() as database,
    current_setting('server_version_num')::integer as version,current_setting('transaction_read_only') as readonly,
    current_setting('session_replication_role') as replication,rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolreplication,rolbypassrls,rolcanlogin,rolconnlimit,
    exists(select 1 from pg_auth_members m where m.roleid=r.oid or m.member=r.oid) as membership,
    has_database_privilege(current_database(),'CONNECT') as connect,
    has_database_privilege(current_database(),'CREATE,TEMP,CONNECT WITH GRANT OPTION') as database_extra,
    has_parameter_privilege('session_replication_role','SET,ALTER SYSTEM') as replication_override
    from pg_roles r where rolname=current_user`)).rows[0];
   if(!identity||identity.name!==role||identity.login!==role||identity.database!==database||identity.version<180000||identity.version>=190000||
    identity.readonly!=='on'||identity.replication!=='origin'||identity.rolcanlogin!==true||identity.rolconnlimit!==4||identity.connect!==true||
    ['rolsuper','rolcreatedb','rolcreaterole','rolinherit','rolreplication','rolbypassrls','membership','database_extra','replication_override'].some(key=>identity[key]!==false))throw Error('Invalid refund role');
   const actualJournal=(await tx.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;
   if(JSON.stringify(actualJournal)!==JSON.stringify(expectedJournal))throw Error('Invalid refund journal');
   const schemas=(await tx.query(`select nspname as name,has_schema_privilege(oid,'USAGE') as usage,
    has_schema_privilege(oid,'CREATE,USAGE WITH GRANT OPTION') as extra from pg_namespace
    `)).rows;
   if(!['app','blizhniy_meta'].every(name=>schemas.some(item=>item.name===name&&item.usage===true))||
    schemas.some(item=>item.extra!==false||(item.usage&&!['app','blizhniy_meta','public','pg_catalog','information_schema'].includes(item.name))))throw Error('Invalid schema privileges');
   if((await tx.query("select 1 from pg_parameter_acl where has_parameter_privilege(parname,'SET,ALTER SYSTEM') limit 1")).rows.length)throw Error('Invalid parameter privileges');
   const actual=(await tx.query(`select n.nspname||'.'||c.relname||'.'||a.attname||':'||p.privilege as key,
    has_column_privilege(c.oid,a.attnum,p.privilege||' WITH GRANT OPTION') as grantable
    from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid
    cross join (values('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) as p(privilege)
    where n.nspname not in ('pg_catalog','information_schema') and c.relkind in ('r','p','v','m','f')
     and a.attnum>0 and not a.attisdropped and has_column_privilege(c.oid,a.attnum,p.privilege) limit 10001`)).rows;
   const expected=new Set(Object.entries(policy).flatMap(([table,access])=>Object.entries(access).flatMap(([privilege,names])=>names.map(name=>`${table}.${name}:${privilege.toUpperCase()}`))));
   if(actual.length!==expected.size||actual.some(item=>item.grantable!==false||!expected.delete(item.key))||expected.size)throw Error('Invalid column privileges');
   const dangerous=await tx.query(`select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname not in ('pg_catalog','information_schema') and
     ((c.relkind in ('r','p','v','m','f') and has_table_privilege(c.oid,'DELETE,TRUNCATE,TRIGGER,MAINTAIN')) or
      (c.relkind='S' and has_sequence_privilege(c.oid,'USAGE,SELECT,UPDATE'))) limit 1`);
   const callable=(await tx.query(`select n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')' as signature,
    has_function_privilege(p.oid,'EXECUTE WITH GRANT OPTION') as grantable from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname not in ('pg_catalog','information_schema') and has_function_privilege(p.oid,'EXECUTE') limit 10001`)).rows;
   const allowed=new Set(functions.map(name=>name.replaceAll(',',', ')));
   if(dangerous.rows.length||callable.length!==allowed.size||callable.some(item=>item.grantable!==false||!allowed.delete(item.signature))||allowed.size)throw Error('Invalid object privileges');
   // A direct built-in EXECUTE grant can bypass table ACLs without any role membership.
   const catalogExtra=await tx.query(`with catalog_acl as (
    select 'pg_proc'::regclass as classoid,p.oid as objoid,0 as objsubid,
     coalesce(p.proacl,acldefault('f',p.proowner)) as acl,
     coalesce(i.initprivs,acldefault('f',p.proowner)) as initial,false as public_metadata
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    left join pg_init_privs i on i.classoid='pg_proc'::regclass and i.objoid=p.oid and i.objsubid=0 and i.privtype='i'
    where n.nspname in ('pg_catalog','information_schema')
    union all
    select 'pg_class'::regclass,c.oid,0,coalesce(c.relacl,acldefault(case when c.relkind='S' then 's'::"char" else 'r'::"char" end,c.relowner)),
     coalesce(i.initprivs,acldefault(case when c.relkind='S' then 's'::"char" else 'r'::"char" end,c.relowner)),
     n.nspname='information_schema' and c.oid<16384 and c.relname=any($1::text[]) and c.relkind in ('r','v')
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    left join pg_init_privs i on i.classoid='pg_class'::regclass and i.objoid=c.oid and i.objsubid=0 and i.privtype='i'
    where n.nspname in ('pg_catalog','information_schema')
    union all
    select 'pg_class'::regclass,c.oid,a.attnum,a.attacl,coalesce(i.initprivs,'{}'::aclitem[]),false
    from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
    left join pg_init_privs i on i.classoid='pg_class'::regclass and i.objoid=c.oid and i.objsubid=a.attnum and i.privtype='i'
    where n.nspname in ('pg_catalog','information_schema') and a.attnum>0 and not a.attisdropped
   ) select 1 from catalog_acl c cross join lateral aclexplode(c.acl) g
    where g.grantee in (0,(select oid from pg_roles where rolname=current_user))
    and not (c.public_metadata and g.privilege_type='SELECT' and not g.is_grantable) and not exists (
     select 1 from aclexplode(c.initial) p where p.grantee=0 and p.privilege_type=g.privilege_type
      and (not g.is_grantable or p.is_grantable)) limit 1`,[publicMetadata]);
   if(catalogExtra.rows.length)throw Error('Invalid catalog privileges');
   const body=readFileSync(new URL('../database/migrations/0054-refund-worker-locks.sql',import.meta.url),'utf8').match(/as \$\$([\s\S]*?)\$\$;/)?.[1];
   const guards=(await tx.query(`select c.relname as name,t.tgenabled,t.tgtype,t.tgnargs,
    t.tgattr::text=a.attnum::text as id_only,t.tgqual is null as unconditional,p.prosrc,p.prosecdef,p.proconfig,l.lanname
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    join pg_proc p on p.oid=t.tgfoid join pg_language l on l.oid=p.prolang
    join pg_attribute a on a.attrelid=c.oid and a.attname='id' and not a.attisdropped
    where n.nspname='app' and c.relname=any($1::text[]) and t.tgname='refund_worker_lock_only'
     and not t.tgisinternal and p.oid='app.guard_refund_worker_locks()'::regprocedure`,[locks])).rows;
   if(!body||guards.length!==locks.length||new Set(guards.map(item=>item.name)).size!==locks.length||guards.some(item=>
    item.tgenabled!=='A'||item.tgtype!==19||item.tgnargs!==0||item.id_only!==true||item.unconditional!==true||
    item.prosrc!==body||item.prosecdef!==false||item.lanname!=='plpgsql'||JSON.stringify(item.proconfig)!==JSON.stringify(['search_path=""'])))throw Error('Invalid lock guards');
  },{readOnly:true});
 }catch{throw Error('Refund worker database preflight failed');}
}
