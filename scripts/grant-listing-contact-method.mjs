// Explicit operator API only; importing does not connect or apply anything.
import {readFileSync} from 'node:fs';
import {getBootstrapPlan} from './postgres-migration-plan.mjs';
export function getListingContactMethodGrantPlan() {
  return {migrations: getBootstrapPlan({includeListingContactMethod: true}).map(({name, sha256}) => ({name, sha256})),
    sql: readFileSync(new URL('../database/permissions/listing-contact-method.sql', import.meta.url), 'utf8'),
    role: 'blizhniy_runtime', table: 'app.listings', columns: ['contact_method'], privileges: ['SELECT', 'UPDATE']};
}
const denied = () => {throw Error('Listing contact preference privileges unavailable or unexpected');};
async function inspect(client) {
  return (await client.query(`select n.nspname||'.'||c.relname as table_name,a.attname as name,
    c.relacl::text as table_acl,a.attacl::text as column_acl,
    has_column_privilege('blizhniy_runtime',c.oid,a.attnum,'SELECT') as read,
    has_column_privilege('blizhniy_runtime',c.oid,a.attnum,'INSERT') as insert,
    has_column_privilege('blizhniy_runtime',c.oid,a.attnum,'UPDATE') as update,
    has_column_privilege('blizhniy_runtime',c.oid,a.attnum,'REFERENCES') as reference,
    has_column_privilege('blizhniy_runtime',c.oid,a.attnum,'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION') as delegate,
    (select coalesce(jsonb_agg(jsonb_build_array(x.grantee,x.grantor,x.privilege_type,x.is_grantable)
      order by x.grantee,x.grantor,x.privilege_type,x.is_grantable),'[]'::jsonb)
      from aclexplode(a.attacl) x where x.grantee<>(select oid from pg_roles where rolname='blizhniy_runtime')) as other_column_acl
    from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid
    where n.nspname in ('app','blizhniy_meta') and c.relkind in ('r','p','v') and a.attnum>0 and not a.attisdropped
    order by n.nspname,c.relname,a.attnum`)).rows;
}
export async function grantListingContactMethod(client, confirmation) {
  const {host, database} = client.connectionParameters;
  if (typeof confirmation !== 'string' || confirmation !== `${host}:${database}` ||
    !((['127.0.0.1', '::1'].includes(host) && database === 'blizhniy_test') ||
      (host === '17e86f80f26733d39ef4b84d.twc1.net' && database === 'blizhniy_prod'))) throw Error('Missing or mismatched target confirmation');
  let began = false;
  try {
    await client.query('begin'); began = true;
    await client.query("set local lock_timeout='3s';set local statement_timeout='10s'");
    await client.query('select pg_advisory_xact_lock(187924,1)');
    const target = (await client.query("select current_database() as name,current_setting('server_version_num')::integer as version")).rows[0];
    if (target?.name !== database || target.version < 180000 || target.version >= 190000) denied();
    const plan = getListingContactMethodGrantPlan(), history = (await client.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;
    if (JSON.stringify(history) !== JSON.stringify(plan.migrations)) denied();
    const role = (await client.query("select rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname='blizhniy_runtime'")).rows[0];
    if (!role || Object.values(role).some(value => value !== false)) denied();
    const before = await inspect(client), column = before.find(row => row.table_name === 'app.listings' && row.name === 'contact_method');
    const broad = (await client.query("select has_table_privilege('blizhniy_runtime','app.listings','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES,MAINTAIN') as extra")).rows[0];
    if (!column || column.insert || column.reference || column.delegate || !broad || broad.extra !== false) denied();
    await client.query(plan.sql);
    const after = await inspect(client);
    const expected = before.map(row => row === column ? {...row, read: true, update: true} : row);
    // Column ACL text changes only here; every other table/column ACL and effective right must remain identical.
    const normalize = rows => rows.map(row => row.table_name === 'app.listings' && row.name === 'contact_method' ? {...row, column_acl: null} : row);
    if (JSON.stringify(normalize(after)) !== JSON.stringify(normalize(expected))) denied();
    await client.query('commit'); began = false;
    return {columns: 1, privileges: 2};
  } catch (error) {
    if (began) {try {await client.query('rollback');} catch { /* Unknown COMMIT outcome requires explicit inspection. */ }}
    const safe = Error('Listing contact preference grant failed; inspect the confirmed target before retrying');
    if (typeof error?.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)) safe.code = error.code;
    throw safe;
  }
}
