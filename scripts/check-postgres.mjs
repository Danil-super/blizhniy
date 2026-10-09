import { createPostgresDatabase, PostgresError } from "../src/lib/postgres.ts";

// Explicit environment only: no dotenv, no fallback and no schema changes.
let db;
try {
  db = createPostgresDatabase();
  const result = await db.transaction(async (tx) => tx.query(`
    select current_database() as database, current_setting('server_version') as version,
      (select ssl from pg_catalog.pg_stat_ssl where pid = pg_backend_pid()) as tls,
      (select count(*)::integer from pg_catalog.pg_tables
       where schemaname not in ('pg_catalog', 'information_schema')) as user_tables
  `), { readOnly: true });
  process.stdout.write(`${JSON.stringify(result.rows[0], null, 2)}\n`);
} catch (error) {
  const code = error instanceof PostgresError && error.code ? ` (${error.code})` : "";
  process.stderr.write(`PostgreSQL check failed${code}; check explicit server configuration and TLS\n`);
  process.exitCode = 1;
} finally { if (db) await db.close(); }
