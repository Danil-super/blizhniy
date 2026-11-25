// Private operator plan and read-only admission; no role installation or service startup.
import {readFileSync} from 'node:fs';
import {assertFinancialCatalogPrivileges} from './financial-catalog-privileges.mjs';
import {assertRefundSchema} from './refund-worker-schema.mjs';
import {getRefundWorkerRolePlan} from './refund-worker-role.mjs';
import {assertHostedRefundRelease} from './publication-test-release-plan.mjs';

const role='blizhniy_refund_operator',locks=['users','payment_checkout_intents','payment_orders'];
const cols=text=>text.split(',');
const policy={
 'app.users':{select:cols('id,role,is_blocked,email_verified_at,auth_version'),update:['id']},
 'app.sessions':{select:cols('token_hash,user_id,auth_version,scope,expires_at,last_seen_at'),update:['last_seen_at']},
 'app.payment_checkout_intents':{select:cols('id,owner_id,target_type,target_id,target_revision,tariff_id,amount,duration_days,merchant_shop_id,is_test,request_body,request_sha256,created_at'),update:['id']},
 'app.payment_orders':{select:cols('id,status'),update:['id']},
 'app.payment_provider_links':{select:cols('intent_id,provider_payment_id')},
 'app.payment_verifications':{select:cols('intent_id,provider_payment_id,status,captured_at')},
 'app.payment_refund_approvals':{select:cols('id,payment_intent_id,approved_by,reason,policy_version,fiscal_mode,amount,approved_at'),insert:cols('id,payment_intent_id,reason')},
 'app.payment_refund_reservations':{select:cols('id,payment_intent_id,provider_payment_id,merchant_shop_id,is_test,amount,created_at')},
 'app.payment_refund_requests':{select:cols('operation_id,idempotence_key,request_body,request_sha256,created_at')},
 'app.payment_refund_dispatch_anchors':{select:cols('operation_id,authorized_at')},
 'app.payment_refund_send_attempts':{select:cols('id,operation_id,request_sha256')},
 'app.payment_refund_candidates':{select:cols('operation_id,attempt_id,provider_refund_id')},
 'app.payment_refund_provider_links':{select:cols('operation_id,provider_refund_id'),insert:cols('operation_id,provider_refund_id')},
 'app.payment_refund_observations':{select:cols('operation_id,provider_refund_id,status,provider_created_at,observed_at'),insert:cols('operation_id,provider_refund_id,status,provider_created_at')},
 'app.payment_refund_effects':{select:cols('operation_id,merchant_shop_id,payment_intent_id,provider_refund_id,target_type,target_id,effect,applied_at'),insert:cols('operation_id,merchant_shop_id')},
 'app.application_compensation_refunds':{select:cols('payment_intent_id,merchant_shop_id,application_id,provider_refund_id,amount,applied_at'),insert:cols('payment_intent_id,merchant_shop_id')},
 'app.payment_refund_recovery_actions':{select:cols('action_id,operation_id,provider_refund_id,reason,operator_id,phase,recorded_at'),insert:cols('action_id,operation_id,provider_refund_id,reason,phase')},
 'blizhniy_meta.migrations':{select:['name','sha256']},
};
const functions=['app.lock_refund_recovery_source(uuid,uuid)','app.refund_target_admitted(uuid,uuid)'];
const validDatabase=value=>typeof value==='string'&&/^[a-zA-Z0-9_.-]{1,63}$/.test(value);
const journal=(schema=55)=>getRefundWorkerRolePlan('operator',{schema,localPrimary:[58,60].includes(schema)}).journal;

export function getRefundOperatorRolePlan(database,{schema=55,localPrimary=false}={}){
 if(typeof localPrimary!=='boolean'||([58,60].includes(schema)&&!localPrimary)||([75,76,78,79,80,81,82,83].includes(schema)&&localPrimary)||!validDatabase(database)||![55,56,57,58,60,75,76,78,79,80,81,82,83].includes(schema))throw Error('Invalid refund database');
 return{role,createRole:`create role ${role} nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls connection limit 4`,journal:journal(schema),
  grants:[`grant connect on database "${database}" to ${role}`,`grant usage on schema app,blizhniy_meta to ${role}`,
   ...Object.entries(policy).flatMap(([table,access])=>Object.entries(access).map(([privilege,names])=>`grant ${privilege}(${names.join(',')}) on ${table} to ${role}`)),
   ...functions.map(signature=>`grant execute on function ${signature} to ${role}`)]};
}

/** Trusted TEST operator: session/source reads and audited approval/recovery, no send capabilities.
 * Read-only exact PG18/schema55 admission; never an untrusted-SQL or per-merchant isolation boundary.
 */
export async function verifyRefundOperatorDatabase(db,{database,merchant,localPrimary=false,hostedRefunds=false}={}){
 try{
  if(!validDatabase(database)||typeof localPrimary!=='boolean'||typeof hostedRefunds!=='boolean'||(localPrimary&&(hostedRefunds||database!=='blizhniy_prod'))||!merchant||merchant.isTest!==true||typeof merchant.shopId!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(merchant.shopId))throw Error('Invalid refund target');
  await db.transaction(async tx=>{
   if(hostedRefunds)await tx.query('set transaction isolation level repeatable read');
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
   if(hostedRefunds){
    const hostedSchema=await assertHostedRefundRelease(tx,actualJournal);
    if(merchant.marqueeRefunds!==undefined&&merchant.marqueeRefunds!==(hostedSchema>=78))throw Error('Marquee refund configuration does not match schema');
    if(merchant.specialistRefunds!==undefined&&merchant.specialistRefunds!==(hostedSchema>=80))throw Error('Specialist refund configuration does not match schema');
   }
   else{
    const schema=localPrimary&&actualJournal.length===59?60:localPrimary&&[56,57,58].includes(actualJournal.length)?actualJournal.length:55;
    if(JSON.stringify(actualJournal)!==JSON.stringify(journal(schema)))throw Error('Invalid refund journal');
    await assertRefundSchema(tx,schema,{localPrimary});
   }
   await assertFinancialCatalogPrivileges(tx);
   const actual=(await tx.query(`select n.nspname||'.'||c.relname||'.'||a.attname||':'||p.privilege as key,
    has_column_privilege(c.oid,a.attnum,p.privilege||' WITH GRANT OPTION') as grantable
    from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid
    cross join (values('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) as p(privilege)
    where n.nspname not in ('pg_catalog','information_schema') and c.relkind in ('r','p','v','m','f','t')
     and a.attnum>0 and not a.attisdropped and has_column_privilege(c.oid,a.attnum,p.privilege) limit 10001`)).rows;
   const expected=new Set(Object.entries(policy).flatMap(([table,access])=>Object.entries(access).flatMap(([privilege,names])=>names.map(name=>`${table}.${name}:${privilege.toUpperCase()}`))));
   if(actual.length!==expected.size||actual.some(item=>item.grantable!==false||!expected.delete(item.key))||expected.size)throw Error('Invalid column privileges');
   const dangerous=await tx.query(`select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname not in ('pg_catalog','information_schema') and
     ((c.relkind in ('r','p','v','m','f','t') and has_table_privilege(c.oid,'DELETE,TRUNCATE,TRIGGER,MAINTAIN')) or
      (c.relkind='S' and has_sequence_privilege(c.oid,'USAGE,SELECT,UPDATE'))) limit 1`);
   const callable=(await tx.query(`select n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')' as signature,
    has_function_privilege(p.oid,'EXECUTE WITH GRANT OPTION') as grantable from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname not in ('pg_catalog','information_schema') and has_function_privilege(p.oid,'EXECUTE') limit 10001`)).rows;
   const allowed=new Set(functions.map(name=>name.replaceAll(',',', ')));
   if(dangerous.rows.length||callable.length!==allowed.size||callable.some(item=>item.grantable!==false||!allowed.delete(item.signature))||allowed.size)throw Error('Invalid object privileges');
   const body=readFileSync(new URL('../database/migrations/0055-refund-operator-locks.sql',import.meta.url),'utf8').match(/as \$\$([\s\S]*?)\$\$;/)?.[1];
   const guards=(await tx.query(`select c.relname as name,t.tgenabled,t.tgtype,t.tgnargs,
    t.tgattr::text=a.attnum::text as id_only,t.tgqual is null as unconditional,p.prosrc,p.prosecdef,p.proconfig,l.lanname
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    join pg_proc p on p.oid=t.tgfoid join pg_language l on l.oid=p.prolang
    join pg_attribute a on a.attrelid=c.oid and a.attname='id' and not a.attisdropped
    where n.nspname='app' and c.relname=any($1::text[]) and t.tgname='refund_operator_lock_only'
     and not t.tgisinternal and p.oid='app.guard_refund_operator_locks()'::regprocedure`,[locks])).rows;
   if(!body||guards.length!==locks.length||new Set(guards.map(item=>item.name)).size!==locks.length||guards.some(item=>
    item.tgenabled!=='A'||item.tgtype!==19||item.tgnargs!==0||item.id_only!==true||item.unconditional!==true||
    item.prosrc!==body||item.prosecdef!==false||item.lanname!=='plpgsql'||JSON.stringify(item.proconfig)!==JSON.stringify(['search_path=""'])))throw Error('Invalid lock guards');
  },{readOnly:true});
 }catch{throw Error('Refund operator database preflight failed');}
}
