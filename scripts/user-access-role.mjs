import {readFileSync} from 'node:fs';
import {getAdminTariffMigration} from './admin-tariff-release.mjs';
import {getAdminUserAccessMigration} from './admin-user-access-release.mjs';
import {getRefundWorkerRolePlan} from './refund-worker-role.mjs';
import {readRefundSchema,assertRefundSchema} from './refund-worker-schema.mjs';
import {assertFinancialSystemPrivileges} from './financial-catalog-privileges.mjs';
const role='blizhniy_user_operator',signature='app_admin.user_access(text,uuid,text,uuid,uuid,bigint,text,boolean,text)';
const tariffSignature='app_admin.tariff_access(text,uuid,text,text,uuid,text,text,text,integer,boolean,text)';
const validDatabase=value=>typeof value==='string'&&/^[a-zA-Z0-9_.-]{1,63}$/.test(value);
export function getUserAccessRolePlan(database,{tariffs=false}={}){
 if(typeof tariffs!=='boolean'||!validDatabase(database))throw Error('Invalid user operator database');
 const {name,sha256}=getAdminUserAccessMigration(),tariff=tariffs?getAdminTariffMigration():null;
 return {role,createRole:`create role ${role} nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls connection limit 4`,
  appJournal:getRefundWorkerRolePlan(database,{schema:60,localPrimary:true}).journal,journal:[{name,sha256},...(tariff?[{name:tariff.name,sha256:tariff.sha256}]:[])],
  grants:[`grant connect on database "${database}" to ${role}`,`grant usage on schema app,app_admin,blizhniy_meta to ${role}`,
   `grant select(name,sha256) on blizhniy_meta.migrations,app_admin.migrations to ${role}`,`grant execute on function ${signature} to ${role}`,...(tariffs?[`grant execute on function ${tariffSignature} to ${role}`]:[])]};
}
/** Read-only admission: exact reviewed admin capability set, metadata reads and independent schema. */
export async function verifyUserAccessDatabase(db,{database,deadline,tariffs=false}={}){
 try{
  if(typeof tariffs!=='boolean')throw Error();
  let plan=getUserAccessRolePlan(database);
  await db.readTransaction(async tx=>{
   await tx.query("select set_config('search_path','pg_catalog',true),set_config('statement_timeout','5s',true),set_config('lock_timeout','1s',true)");
   const identity=(await tx.query(`select current_user as name,session_user as login,current_database() as database,
    current_setting('server_version_num')::integer as version,current_setting('transaction_read_only') as readonly,current_setting('session_replication_role') as replication,
    current_setting('default_transaction_read_only') as default_readonly,current_setting('default_transaction_isolation') as default_isolation,
    rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolreplication,rolbypassrls,rolcanlogin,rolconnlimit,
    exists(select 1 from pg_auth_members m where m.roleid=r.oid or m.member=r.oid) as membership,
    has_database_privilege(current_database(),'CONNECT') as connect,has_database_privilege(current_database(),'CREATE,TEMP,CONNECT WITH GRANT OPTION') as database_extra,
    has_parameter_privilege('session_replication_role','SET,ALTER SYSTEM') as replication_override from pg_roles r where rolname=current_user`)).rows[0];
   if(!identity||identity.name!==role||identity.login!==role||identity.database!==database||identity.version<180000||identity.version>=190000||identity.readonly!=='on'||identity.replication!=='origin'||identity.default_readonly!=='off'||identity.default_isolation!=='read committed'||
    identity.rolcanlogin!==true||identity.rolconnlimit!==4||identity.connect!==true||['rolsuper','rolcreatedb','rolcreaterole','rolinherit','rolreplication','rolbypassrls','membership','database_extra','replication_override'].some(key=>identity[key]!==false))throw Error();
   const main=(await tx.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;
   const admin=(await tx.query('select name,sha256 from app_admin.migrations order by name')).rows;
   const tariffProfile=admin.length===2;if(tariffs&&!tariffProfile)throw Error();
   plan=getUserAccessRolePlan(database,{tariffs:tariffProfile});
   if(JSON.stringify(main)!==JSON.stringify(plan.appJournal)||JSON.stringify(admin)!==JSON.stringify(plan.journal))throw Error();
   const signatures=tariffProfile?[signature,tariffSignature]:[signature];
   await assertRefundSchema(tx,60,{localPrimary:true});
   const expected=JSON.parse(readFileSync(new URL(tariffProfile?'../database/admin-user-access-schema-v2.json':'../database/admin-user-access-schema-v1.json',import.meta.url),'utf8'));
   if(JSON.stringify(await readRefundSchema(tx,{namespace:'app_admin'}))!==JSON.stringify(expected))throw Error();
   const schemas=(await tx.query("select nspname as name,has_schema_privilege(oid,'USAGE') as usage,has_schema_privilege(oid,'CREATE,USAGE WITH GRANT OPTION') as extra from pg_namespace")).rows;
   if(!['app','app_admin','blizhniy_meta'].every(name=>schemas.some(row=>row.name===name&&row.usage===true))||
    schemas.some(row=>row.extra!==false||row.usage&&!['app','app_admin','blizhniy_meta','public','pg_catalog','information_schema'].includes(row.name)))throw Error();
   await assertFinancialSystemPrivileges(tx);
   // Global ACLs matter too: this role must not overlook a grant to PUBLIC or another role.
   const namespaceAcl=await tx.query(`select 1 from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
    where n.nspname='app_admin' and a.grantee<>n.nspowner and not (a.grantee=(select oid from pg_roles where rolname=current_user)
     and a.privilege_type='USAGE' and not a.is_grantable) limit 1`);
   const functionAcl=await tx.query(`select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where n.nspname='app_admin' and a.grantee<>p.proowner and not(p.oid=any($1::regprocedure[]) and a.grantee=(select oid from pg_roles where rolname=current_user)
     and a.privilege_type='EXECUTE' and not a.is_grantable) limit 1`,[signatures]);
   const tableAcl=await tx.query(`select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    cross join lateral aclexplode(coalesce(c.relacl,acldefault(case when c.relkind='S' then 's'::"char" else 'r'::"char" end,c.relowner))) a
    where n.nspname='app_admin' and c.relkind in ('r','p','v','m','f','S') and a.grantee<>c.relowner limit 1`);
   const columnAcl=await tx.query(`select 1 from pg_attribute c join pg_class t on t.oid=c.attrelid join pg_namespace n on n.oid=t.relnamespace
    cross join lateral aclexplode(c.attacl) a where n.nspname='app_admin' and c.attnum>0 and not c.attisdropped and a.grantee<>t.relowner
     and not(t.relname='migrations' and c.attname in ('name','sha256') and a.grantee=(select oid from pg_roles where rolname=current_user)
      and a.privilege_type='SELECT' and not a.is_grantable) limit 1`);
   if(namespaceAcl.rows.length||functionAcl.rows.length||tableAcl.rows.length||columnAcl.rows.length)throw Error();
   const columns=(await tx.query(`select n.nspname||'.'||c.relname||'.'||a.attname||':'||p.privilege as key,
    has_column_privilege(c.oid,a.attnum,p.privilege||' WITH GRANT OPTION') as grantable
    from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid
    cross join(values('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) p(privilege)
    where n.nspname not in ('pg_catalog','information_schema') and c.relkind in ('r','p','v','m','f','t') and a.attnum>0 and not a.attisdropped and has_column_privilege(c.oid,a.attnum,p.privilege) limit 10001`)).rows;
   const allowed=new Set(['app_admin.migrations.name:SELECT','app_admin.migrations.sha256:SELECT','blizhniy_meta.migrations.name:SELECT','blizhniy_meta.migrations.sha256:SELECT']);
   if(columns.length!==allowed.size||columns.some(row=>row.grantable!==false||!allowed.delete(row.key))||allowed.size)throw Error();
   const tables=await tx.query(`select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in ('pg_catalog','information_schema') and
    (has_table_privilege(c.oid,'DELETE,TRUNCATE,TRIGGER,MAINTAIN') or c.relkind='S' and has_sequence_privilege(c.oid,'USAGE,SELECT,UPDATE')) limit 1`);
   const callable=(await tx.query(`select n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')' as signature,
    has_function_privilege(p.oid,'EXECUTE WITH GRANT OPTION') as grantable from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname not in ('pg_catalog','information_schema') and has_function_privilege(p.oid,'EXECUTE') limit 10001`)).rows;
   const permitted=new Set(signatures.map(value=>value.replaceAll(',',', ')));
   if(tables.rows.length||callable.length!==permitted.size||callable.some(row=>row.grantable!==false||!permitted.delete(row.signature))||permitted.size)throw Error();
  },{timeoutMs:5000,deadline});
 }catch{throw Error('User operator database preflight failed');}
}
