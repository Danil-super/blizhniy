import {assertFinancialSystemPrivileges} from './financial-catalog-privileges.mjs';
import {assertPaidResponseSchema} from './paid-response-schema.mjs';

export const publicationRestrictionRole='blizhniy_publication_operator';
const namespace='app_publication_restriction';
const capability=namespace+'.restrict(text, uuid, text, uuid, bigint, uuid)';

export async function verifyPublicationRestrictionDatabase(db,{database}={}){
 try{
  if(database!=='blizhniy_prod')throw Error();
  await db.readTransaction(async tx=>{
   await tx.query("select set_config('search_path','pg_catalog',true)");
   const {rows:[identity]}=await tx.query(`select current_user as name,session_user as login,current_database() as database,
    current_setting('server_version_num')::int as version,current_setting('transaction_read_only') as readonly,
    current_setting('session_replication_role') as replication,current_setting('default_transaction_read_only') as default_readonly,
    current_setting('default_transaction_isolation') as default_isolation,
    rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolreplication,rolbypassrls,rolcanlogin,rolconnlimit,
    exists(select 1 from pg_auth_members m where m.roleid=r.oid or m.member=r.oid) as membership,
    has_database_privilege(current_database(),'CONNECT') as connect,
    has_database_privilege(current_database(),'CREATE,TEMP,CONNECT WITH GRANT OPTION') as database_extra
    from pg_roles r where rolname=current_user`);
   if(!identity||identity.name!==publicationRestrictionRole||identity.login!==publicationRestrictionRole||identity.database!==database||
    identity.version<180000||identity.version>=190000||identity.readonly!=='on'||identity.replication!=='origin'||
    identity.default_readonly!=='off'||identity.default_isolation!=='read committed'||identity.rolcanlogin!==true||
    identity.rolconnlimit!==4||identity.connect!==true||
    ['rolsuper','rolcreatedb','rolcreaterole','rolinherit','rolreplication','rolbypassrls','membership','database_extra']
     .some(key=>identity[key]!==false))throw Error();
   await assertPaidResponseSchema(tx,{publicationRestrictions:true});
   await assertFinancialSystemPrivileges(tx);
   const schemas=(await tx.query(`select nspname as name,has_schema_privilege(oid,'USAGE') as usage,
    has_schema_privilege(oid,'CREATE,USAGE WITH GRANT OPTION') as extra from pg_namespace`)).rows;
   if(!schemas.some(row=>row.name===namespace&&row.usage===true)||
    schemas.some(row=>row.extra!==false||row.usage&&![namespace,'public','pg_catalog','information_schema'].includes(row.name)))throw Error();
   const callable=(await tx.query(`select n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')' as name,
    has_function_privilege(p.oid,'EXECUTE WITH GRANT OPTION') as grantable
    from pg_proc p join pg_namespace n on p.pronamespace=n.oid
    where n.nspname not in ('pg_catalog','information_schema') and has_function_privilege(p.oid,'EXECUTE') limit 2`)).rows;
   if(callable.length!==1||callable[0].name!==capability||callable[0].grantable!==false)throw Error();
   const extra=await tx.query(`select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname not in ('pg_catalog','information_schema') and case
     when c.relkind in ('r','p','v','m','f','t') then has_table_privilege(c.oid,'DELETE,TRUNCATE,TRIGGER,MAINTAIN')
      or has_any_column_privilege(c.oid,'SELECT,INSERT,UPDATE,REFERENCES')
     when c.relkind='S' then has_sequence_privilege(c.oid,'USAGE,SELECT,UPDATE')
     else false end
    union all select 1 from pg_foreign_server where has_server_privilege(oid,'USAGE')
    union all select 1 from pg_foreign_data_wrapper where has_foreign_data_wrapper_privilege(oid,'USAGE') limit 1`);
   if(extra.rows.length)throw Error();
  },{timeoutMs:5000});
 }catch{throw Error('Publication restriction operator database preflight failed');}
}
