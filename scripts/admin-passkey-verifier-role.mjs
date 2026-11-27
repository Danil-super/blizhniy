import {createHash} from 'node:crypto';
import {assertFinancialSystemPrivileges} from './financial-catalog-privileges.mjs';
import {readRefundSchema} from './refund-worker-schema.mjs';

const role='blizhniy_passkey_verifier',namespace='app_admin_passkey';
const signatures=['session_state(text, boolean)','enrollment_state(text, text, text)',
 'bind_enrollment(text, text, text, text, text)','complete_enrollment(text, text, text, text, text, bytea, bigint)',
 'store_access_permit(text, bigint, text, jsonb)'].map(name=>namespace+'.'+name);
const expectedCatalogs=new Set([
 '97bd313ae890ff235ad12627b5081d75e2e82214b607b4cf232bc15fc58460da',
 '5eadd0e7ca1a541d3d53a8cd4ea56e210799c4a1275104866b59b0df12679ab4',
]);

async function readAdminPasskeyCatalog(tx){
 const schema=await readRefundSchema(tx,{namespace});
 const access=(await tx.query(`select pg_get_functiondef(p.oid) as definition,p.proowner=n.nspowner as owned
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='app_admin' and p.proname in ('user_access','user_access_before_passkey')
   order by p.proname collate "C"`)).rows;
 if(access.length!==2||access.some(row=>row.owned!==true))throw Error('Invalid passkey access guard');
 return createHash('sha256').update(JSON.stringify([schema,access])).digest('hex');
}

export async function assertAdminPasskeyCatalog(tx){
 if(!expectedCatalogs.has(await readAdminPasskeyCatalog(tx)))throw Error('Invalid passkey catalog');
 const foreignGrants=await tx.query(`select 1 from (
  select a.grantee,a.is_grantable,n.nspowner as owner from pg_namespace n
    cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a where n.nspname=$1
  union all select a.grantee,a.is_grantable,p.proowner from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where n.nspname=$1
  union all select a.grantee,a.is_grantable,c.relowner from pg_class c join pg_namespace n on n.oid=c.relnamespace
    cross join lateral aclexplode(c.relacl) a where n.nspname=$1
  union all select a.grantee,a.is_grantable,c.relowner from pg_class c join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute f on f.attrelid=c.oid cross join lateral aclexplode(f.attacl) a where n.nspname=$1
 ) grants where grantee<>owner and
  (grantee is distinct from (select oid from pg_roles where rolname=$2) or is_grantable) limit 1`,[namespace,role]);
 if(foreignGrants.rows.length)throw Error('Invalid passkey permissions');
}

function exact(rows,expected){
 return rows.length===expected.length&&rows.every(row=>row.grantable===false)&&
  JSON.stringify(rows.map(row=>row.name).sort())===JSON.stringify([...expected].sort());
}

export async function verifyAdminPasskeyDatabase(db,{database,deadline}={}){
 try{
  if(typeof database!=='string'||!database)throw Error();
  await db.readTransaction(async tx=>{
   await tx.query("select pg_catalog.set_config('search_path','pg_catalog',true)");
   const {rows:[identity]}=await tx.query(`select current_user as name,session_user as login,current_database() as database,
    current_setting('server_version_num')::integer as version,current_setting('transaction_read_only') as readonly,
    current_setting('session_replication_role') as replication,current_setting('default_transaction_read_only') as default_readonly,
    current_setting('default_transaction_isolation') as default_isolation,
    rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolreplication,rolbypassrls,rolcanlogin,rolconnlimit,
    exists(select 1 from pg_auth_members m where m.roleid=r.oid or m.member=r.oid) as membership,
    has_database_privilege(current_database(),'CONNECT') as connect,
    has_database_privilege(current_database(),'CREATE,TEMP,CONNECT WITH GRANT OPTION') as database_extra
    from pg_roles r where rolname=current_user`);
   if(!identity||identity.name!==role||identity.login!==role||identity.database!==database||identity.version<180000||identity.version>=190000||
    identity.readonly!=='on'||identity.replication!=='origin'||identity.default_readonly!=='off'||identity.default_isolation!=='read committed'||
    identity.rolcanlogin!==true||identity.rolconnlimit!==4||identity.connect!==true||
    ['rolsuper','rolcreatedb','rolcreaterole','rolinherit','rolreplication','rolbypassrls','membership','database_extra'].some(key=>identity[key]!==false))throw Error();
   await assertAdminPasskeyCatalog(tx);
   await assertFinancialSystemPrivileges(tx);
   const namespaces=(await tx.query(`select nspname as name,has_schema_privilege(oid,'USAGE') as usage,
    has_schema_privilege(oid,'CREATE,USAGE WITH GRANT OPTION') as extra from pg_namespace`)).rows;
   if(!namespaces.some(row=>row.name===namespace&&row.usage===true)||
    namespaces.some(row=>row.extra!==false||row.usage&&![namespace,'public','pg_catalog','information_schema'].includes(row.name)))throw Error();
   const callable=(await tx.query(`select n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')' as name,
    has_function_privilege(p.oid,'EXECUTE WITH GRANT OPTION') as grantable from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname not in ('pg_catalog','information_schema') and has_function_privilege(p.oid,'EXECUTE') limit 1000`)).rows;
   const columns=(await tx.query(`select n.nspname||'.'||c.relname||'.'||a.attname||':'||p.permission as name,
    has_column_privilege(c.oid,a.attnum,p.permission||' WITH GRANT OPTION') as grantable
    from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid
    cross join(values('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) p(permission)
    where n.nspname not in ('pg_catalog','information_schema') and c.relkind in ('r','p','v','m','f','t')
      and a.attnum>0 and not a.attisdropped and has_column_privilege(c.oid,a.attnum,p.permission) limit 1000`)).rows;
   const credentials=['id','admin_id','user_handle','public_key','counter','created_at','revoked_at'];
   const challenges=['session_hash','auth_version','kind','command_digest','credential_ids','challenge','expires_at'];
   const expectedColumns=[...credentials.map(name=>`credentials.${name}:SELECT`),'credentials.counter:UPDATE',
    ...challenges.flatMap(name=>[`challenges.${name}:SELECT`,`challenges.${name}:INSERT`,...(name==='session_hash'?[]:[`challenges.${name}:UPDATE`])])];
   const tables=(await tx.query(`select n.nspname||'.'||c.relname||':'||x.permission as name,
    has_table_privilege(c.oid,x.permission||' WITH GRANT OPTION') as grantable from pg_class c join pg_namespace n on n.oid=c.relnamespace
    cross join(values('DELETE'),('TRUNCATE'),('TRIGGER'),('MAINTAIN')) x(permission)
    where n.nspname not in ('pg_catalog','information_schema') and c.relkind in ('r','p','v','m','f','t')
      and has_table_privilege(c.oid,x.permission) limit 1000`)).rows;
   if(!exact(callable,signatures)||!exact(columns,expectedColumns.map(name=>namespace+'.'+name))||
    !exact(tables,[namespace+'.challenges:DELETE']))throw Error();
   const sequences=await tx.query(`select 1 from pg_class where
    case when relkind='S' then has_sequence_privilege(oid,'USAGE,SELECT,UPDATE') else false end limit 1`);
   const guard=(await tx.query(`select p.proname as name,
     has_function_privilege('blizhniy_user_operator',p.oid,'EXECUTE') as allowed,
     has_function_privilege('blizhniy_user_operator',p.oid,'EXECUTE WITH GRANT OPTION') as grantable
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app_admin' and p.proname in ('user_access','user_access_before_passkey')`)).rows;
   if(sequences.rows.length||guard.length!==2||
    guard.some(row=>row.grantable!==false||row.allowed!==(row.name==='user_access')))throw Error();
  },{timeoutMs:5000,deadline});
 }catch{throw Error('Passkey verifier database preflight failed');}
}
