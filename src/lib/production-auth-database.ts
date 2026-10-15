import type { PostgresDatabase } from "./postgres";

/** Shared startup boundary for HTTP and the separate mail process. No owner-role fallback. */
export async function verifyProductionAuthDatabase(db: Pick<PostgresDatabase, "query">): Promise<void> {
  const row = (await db.query<Record<string, unknown>>(`select current_user as name,
    rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,
    has_schema_privilege('app','CREATE') as schema_create,
    has_schema_privilege('public','CREATE') as public_create,
    has_database_privilege(current_database(),'CREATE') as database_create,
    has_database_privilege(current_database(),'TEMP') as temp_create,
    has_column_privilege('app.users','role','UPDATE') as role_update,
    has_column_privilege('app.users','role','INSERT') as role_insert,
    not exists(select 1 from pg_class c where c.oid='app.users'::regclass
      and has_table_privilege(c.relowner,c.oid,'SELECT')
      and has_any_column_privilege(c.relowner,c.oid,'UPDATE')) as identity_owner_permissions_missing,
    not exists(select 1 from pg_constraint where conrelid='app.auth_rate_limits'::regclass
      and conname='auth_rate_limits_production_attempts_check' and convalidated) as rate_schema_missing
    from pg_roles where rolname=current_user`)).rows[0];
  if (!row || row.name !== "blizhniy_runtime" || row.rate_schema_missing !== false || row.role_insert !== false ||
      row.identity_owner_permissions_missing !== false ||
      Object.entries(row).some(([key,value]) => key !== "name" && value !== false)) {
    throw new Error("Invalid production runtime privileges");
  }
  await db.query("select state,claim_id,lease_until from app.mail_outbox limit 0");
}
