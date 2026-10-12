// Explicit operator API, never imported by app startup or auto-deploy. No secret values in results/errors.
import { randomBytes } from "node:crypto";
import pg from "pg";
import { getBootstrapPlan } from "./bootstrap-postgres.mjs";
import { createScramVerifier, saveStagingCredentials } from "./provision-staging-postgres.mjs";

export function validatePrimaryAuthTarget(config, confirmation, mode = process.env.NODE_ENV) {
  if (config.connectionString !== undefined || config.stream !== undefined ||
      Object.keys(config.ssl ?? {}).some(key => !["ca", "rejectUnauthorized"].includes(key))) throw new Error("Primary transport overrides refused");
  const local = mode === "test" && ["127.0.0.1", "::1"].includes(config.host) && config.database === "blizhniy_test" && config.ssl === false;
  const primary = mode === "production" && config.host === "17e86f80f26733d39ef4b84d.twc1.net" &&
    Number(config.port) === 5432 && config.database === "default_db" && config.user === "gen_user" && config.ssl?.rejectUnauthorized === true;
  if ((!local && !primary) || confirmation !== `${config.host}:${config.database}`) throw new Error("Unconfirmed primary Auth target");
}

export async function verifyPrimaryAuthRuntime(client, operator) {
  const { rows: [row] } = await client.query(`select current_user as name,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,
    has_database_privilege(current_database(),'CREATE') as database_create,has_database_privilege(current_database(),'TEMP') as temp_create,
    has_schema_privilege('app','CREATE') as schema_create,has_schema_privilege('public','CREATE') as public_create,
    has_column_privilege('app.users','role','INSERT') as role_insert,has_column_privilege('app.users','role','UPDATE') as role_update,
    has_table_privilege('app.users','DELETE') as user_delete,has_table_privilege('app.tariffs','UPDATE') as tariff_update,
    has_column_privilege('app.mail_outbox','payload','UPDATE') as payload_update,
    pg_has_role(current_user,$1,'MEMBER') as operator_member from pg_roles where rolname=current_user`, [operator]);
  const flags = ["rolsuper", "rolcreatedb", "rolcreaterole", "rolreplication", "rolbypassrls", "database_create", "temp_create",
    "schema_create", "public_create", "role_insert", "role_update", "user_delete", "tariff_update", "payload_update", "operator_member"];
  if (!row || row.name !== "blizhniy_runtime" || flags.some(key => row[key] !== false)) throw new Error("Invalid primary runtime privileges");
  await client.query("select state,claim_id,lease_until from app.mail_outbox limit 0");
  await client.query("select 1 from app.users,app.sessions,app.registration_legal,app.email_confirmations,app.password_recoveries,app.auth_rate_limits,app.regions,app.cities,app.categories,app.specialist_categories,app.tariffs limit 0");
  const executable = await client.query("select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('app','blizhniy_meta') and has_function_privilege(p.oid,'EXECUTE') limit 1");
  if (executable.rowCount) throw new Error("Primary runtime can execute application functions");
  for (const sql of ["create table public.__blizhniy_auth_permission_probe(id integer)", "create schema __blizhniy_auth_permission_probe",
    "create temporary table __blizhniy_auth_permission_probe(id integer)", "update app.users set role='admin' where false",
    "insert into app.users(email,password_hash,role) select 'probe@example.invalid','unused','admin' where false",
    `set role ${client.escapeIdentifier(operator)}`]) {
    let denied = false;
    await client.query("begin");
    try { await client.query(sql); } catch (error) { if (error.code === "42501") denied = true; else throw error; }
    finally { await client.query("rollback"); }
    if (!denied) throw new Error("Primary permission probe unexpectedly succeeded");
  }
  return { restricted: true };
}

export async function provisionPrimaryAuth(config, confirmation, credentialsFile, mode = process.env.NODE_ENV) {
  validatePrimaryAuthTarget(config, confirmation, mode);
  const admin = new pg.Client({ ...config, application_name: "blizhniy-primary-provision" });
  let runtime, phase = "preflight";
  try {
    await admin.connect();
    const operator = (await admin.query(`select current_database() as name,current_setting('server_version_num')::integer as version,
      rolcreaterole,has_database_privilege(current_database(),'TEMP WITH GRANT OPTION') as grant_temp,
      has_database_privilege(current_database(),'CONNECT WITH GRANT OPTION') as grant_connect,
      has_database_privilege(current_database(),'CREATE WITH GRANT OPTION') as grant_create from pg_roles where rolname=current_user`)).rows[0];
    if (operator.name !== config.database || operator.version < 180000 || operator.version >= 190000 ||
        !operator.rolcreaterole || !operator.grant_temp || !operator.grant_connect || !operator.grant_create) throw new Error("Operator rights insufficient");
    const journal = (await admin.query("select name,sha256 from blizhniy_meta.migrations order by name")).rows;
    const plan = getBootstrapPlan({ includeMail: true });
    if (journal.length !== plan.length || journal.some((row, i) => row.name !== plan[i].name || row.sha256 !== plan[i].sha256)) throw new Error("Primary migration journal mismatch");
    if ((await admin.query("select 1 from pg_roles where rolname='blizhniy_runtime'")).rowCount) throw new Error("Primary runtime already exists");
    const credentials = { host: config.host, port: config.port, database: config.database, user: "blizhniy_runtime", password: randomBytes(32).toString("hex") };
    // Exclusive private file outside the repository, persisted before a possibly ambiguous COMMIT.
    saveStagingCredentials(credentialsFile, credentials);
    phase = "grants";
    await admin.query("begin");
    await admin.query("set local lock_timeout='3s'; set local statement_timeout='10s'");
    await admin.query("select pg_advisory_xact_lock(187924,1)");
    await admin.query(`create role blizhniy_runtime login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls connection limit 10 password ${admin.escapeLiteral(createScramVerifier(credentials.password))}`);
    const database = admin.escapeIdentifier(config.database), owner = admin.escapeIdentifier(config.user);
    await admin.query(`revoke all on database ${database} from public; grant connect on database ${database} to ${owner},blizhniy_runtime`);
    for (const sql of [
      "grant usage on schema app to blizhniy_runtime",
      // Per-schema REVOKE cannot subtract the global PUBLIC EXECUTE default.
      "alter default privileges revoke execute on functions from public",
      "grant select on app.users,app.sessions,app.registration_legal,app.email_confirmations,app.password_recoveries,app.auth_rate_limits,app.mail_outbox,app.regions,app.cities,app.categories,app.specialist_categories,app.tariffs to blizhniy_runtime",
      "grant insert(email,password_hash),update(password_hash,email_verified_at,auth_version) on app.users to blizhniy_runtime",
      "grant insert,delete on app.sessions,app.email_confirmations,app.password_recoveries,app.auth_rate_limits,app.mail_outbox to blizhniy_runtime",
      "grant insert on app.registration_legal to blizhniy_runtime",
      "grant update(last_seen_at) on app.sessions to blizhniy_runtime",
      // PostgreSQL row-locking SELECT requires UPDATE on at least one column of each locked source table.
      "grant update(token_hash) on app.email_confirmations,app.password_recoveries to blizhniy_runtime",
      "grant update(attempts) on app.auth_rate_limits to blizhniy_runtime",
      "grant update(state,attempts,available_at,claim_id,lease_until,last_code) on app.mail_outbox to blizhniy_runtime",
    ]) await admin.query(sql);
    await admin.query("commit");
    phase = "verification";
    runtime = new pg.Client({ ...config, ...credentials, application_name: "blizhniy-primary-verification" });
    await runtime.connect();
    await verifyPrimaryAuthRuntime(runtime, config.user);
    return { database: config.database, runtime: "blizhniy_runtime", restricted: true };
  } catch (error) {
    try { await admin.query("rollback"); } catch { /* Lost connection is not a safe retry. */ }
    const safe = new Error(`Primary Auth provisioning failed during ${phase}; inspect target and saved credentials before retrying`);
    if (typeof error.code === "string" && /^[0-9A-Z]{5}$/.test(error.code)) safe.code = error.code;
    throw safe;
  } finally {
    await runtime?.end(); await admin.end();
  }
}
