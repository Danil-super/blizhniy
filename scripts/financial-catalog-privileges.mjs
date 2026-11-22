// Shared read-only system privilege boundary for the two dedicated financial roles.
// Caller has verified identity and set local search_path=pg_catalog. No grants or connection creation.
// PG18.6 information_schema.sql creates these public SELECTs after pg_init_privs.
const publicMetadata='information_schema_catalog_name,applicable_roles,administrable_role_authorizations,attributes,character_sets,check_constraint_routine_usage,check_constraints,collations,collation_character_set_applicability,column_column_usage,column_domain_usage,column_privileges,column_udt_usage,columns,constraint_column_usage,constraint_table_usage,domain_constraints,domain_udt_usage,domains,enabled_roles,key_column_usage,parameters,referential_constraints,role_column_grants,routine_column_usage,routine_privileges,role_routine_grants,routine_routine_usage,routine_sequence_usage,routine_table_usage,routines,schemata,sequences,sql_features,sql_implementation_info,sql_sizing,table_constraints,table_privileges,role_table_grants,tables,triggered_update_columns,triggers,udt_privileges,role_udt_grants,usage_privileges,role_usage_grants,user_defined_types,view_column_usage,view_routine_usage,view_table_usage,views,data_type_privileges,element_types,column_options,foreign_data_wrapper_options,foreign_data_wrappers,foreign_server_options,foreign_servers,foreign_table_options,foreign_tables,user_mapping_options,user_mappings'.split(',');

export async function assertFinancialCatalogPrivileges(tx,{paidResponses=false}={}){
   const required=paidResponses?['app','blizhniy_meta','app_response']:['app','blizhniy_meta'];
   const schemas=(await tx.query(`select nspname as name,has_schema_privilege(oid,'USAGE') as usage,
    has_schema_privilege(oid,'CREATE,USAGE WITH GRANT OPTION') as extra from pg_namespace
    `)).rows;
   if(!required.every(name=>schemas.some(item=>item.name===name&&item.usage===true))||
    schemas.some(item=>item.extra!==false||(item.usage&&![...required,'public','pg_catalog','information_schema'].includes(item.name))))throw Error('Invalid schema privileges');
   await assertFinancialSystemPrivileges(tx);
}

export async function assertFinancialSystemPrivileges(tx){
   if((await tx.query("select 1 from pg_parameter_acl where has_parameter_privilege(parname,'SET,ALTER SYSTEM') limit 1")).rows.length)throw Error('Invalid parameter privileges');
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
}
