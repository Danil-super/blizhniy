// Explicit operator workflow. Never loaded by the application or auto-deploy.
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, constants, fsyncSync, lstatSync, openSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { readPostgresConfig } from '../src/lib/postgres.ts';
import { bootstrapPostgres, getBootstrapPlan } from './bootstrap-postgres.mjs';

export const staging = Object.freeze({ database: 'blizhniy_staging', owner: 'blizhniy_stage_owner', migrator: 'blizhniy_stage_migrator', runtime: 'blizhniy_stage_runtime' });
const repository = realpathSync(fileURLToPath(new URL('..', import.meta.url)));

export function validateStagingTarget(config, confirmation, mode = process.env.NODE_ENV) {
  if (!config.host || !config.database || config.database === staging.database || confirmation !== `${config.host}:${staging.database}`) {
    throw new Error('Staging requires an explicitly confirmed separate target');
  }
  if (config.ssl?.rejectUnauthorized !== true && !(config.ssl === false && mode === 'test' && ['127.0.0.1', '::1'].includes(config.host))) {
    throw new Error('Staging requires verified TLS');
  }
}

// PostgreSQL scram_build_secret: generated ASCII avoids SASLprep ambiguity.
// Transmit a verifier, not a plaintext password in a potentially logged DDL statement.
export function createScramVerifier(password) {
  if (typeof password !== 'string' || !/^[a-f0-9]{64}$/.test(password)) throw new Error('Expected generated staging credential');
  const salt = randomBytes(16);
  const salted = pbkdf2Sync(password, salt, 4096, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest('base64');
  const serverKey = createHmac('sha256', salted).update('Server Key').digest('base64');
  return `SCRAM-SHA-256$4096:${salt.toString('base64')}$${storedKey}:${serverKey}`;
}

export function saveStagingCredentials(file, contents) {
  if (!path.isAbsolute(file)) throw new Error('Private absolute credential destination required');
  const directory = path.dirname(file), resolved = realpathSync(directory);
  const relative = path.relative(repository, resolved);
  const metadata = lstatSync(directory);
  if (directory !== resolved || !metadata.isDirectory() || metadata.uid !== process.getuid() ||
      (metadata.mode & 0o777) !== 0o700 || relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('Credential folder must be private, owned and outside repository');
  }
  const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, JSON.stringify(contents)); fsyncSync(fd); }
  finally { closeSync(fd); }
}

export async function verifyStagingRuntime(client) {
  // Denied writes alone do not prove a usable runtime if a controller removed read grants.
  await client.query(`select 1 from app.regions,app.cities,app.categories,app.specialist_categories,app.tariffs limit 0`);
  const { rows: [role] } = await client.query(`select rolcreatedb,rolcreaterole,rolsuper,rolreplication,rolbypassrls,
    pg_has_role(current_user,$1,'MEMBER') as owner_member from pg_roles where rolname=current_user`, [staging.owner]);
  if (!role || Object.values(role).some(Boolean)) throw new Error('Staging runtime has elevated rights');
  for (const sql of [
    'create table public.staging_permission_probe(id integer)',
    'create schema staging_permission_probe',
    'create temporary table staging_permission_probe(id integer)',
    "update app.tariffs set name=name where false",
    'select * from app.users limit 0',
    'select * from blizhniy_meta.migrations limit 0',
    'update app.media_storage_budget set charged_bytes=0 where false',
    'select * from app.media_write_attempts limit 0',
    `set role ${staging.owner}`,
  ]) {
    let denied = false;
    await client.query('begin');
    try { await client.query(sql); }
    catch (error) { if (error.code === '42501') denied = true; else throw error; }
    finally { await client.query('rollback'); }
    if (!denied) throw new Error('Staging runtime permission probe unexpectedly succeeded');
  }
  return { restricted: true };
}

/** Fixed target only, no adoption, cleanup, password rotation or unknown-outcome retry. */
export async function provisionStaging(config, confirmation, credentialsFile, mode) {
  validateStagingTarget(config, confirmation, mode);
  const admin = new pg.Client(config);
  const connections = [];
  let phase = 'preflight';
  const connect = async (options) => {
    const client = new pg.Client(options); connections.push(client); await client.connect(); return client;
  };
  try {
    await admin.connect();
    const { rows: [operator] } = await admin.query(`select current_setting('server_version_num')::integer as version,
      rolcreatedb,rolcreaterole from pg_roles where rolname=current_user`);
    if (operator.version < 180000 || operator.version >= 190000 || !operator.rolcreatedb || !operator.rolcreaterole) {
      throw new Error('PostgreSQL 18 operator with existing CREATEDB/CREATEROLE is required');
    }
    const conflicts = await admin.query(`select 1 from pg_roles where rolname=any($1::text[])
      union all select 1 from pg_database where datname=$2`, [[staging.owner, staging.migrator, staging.runtime], staging.database]);
    if (conflicts.rowCount) throw new Error('Staging database or role already exists; inspect rather than retry');
    const credentials = {
      host: config.host, port: config.port, database: staging.database, owner: staging.owner,
      migrator: { user: staging.migrator, password: randomBytes(32).toString('hex') },
      runtime: { user: staging.runtime, password: randomBytes(32).toString('hex') },
    };
    // Persist before any mutation, so lost COMMIT/connection responses cannot lose credentials.
    saveStagingCredentials(credentialsFile, credentials);
    const operatorName = admin.escapeIdentifier(config.user);
    phase = 'roles';
    await admin.query('begin');
    const restricted = 'nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls';
    await admin.query(`create role ${staging.owner} nologin ${restricted}`);
    for (const [name, limit] of [['migrator', 2], ['runtime', 5]]) {
      const account = credentials[name];
      const verifier = admin.escapeLiteral(createScramVerifier(account.password));
      await admin.query(`create role ${account.user} login ${restricted} connection limit ${limit} password ${verifier}`);
    }
    await admin.query(`grant ${staging.owner} to ${staging.migrator} with admin false, inherit false, set true`);
    await admin.query(`grant ${staging.owner} to ${operatorName} with inherit false, set true`);
    await admin.query('commit');
    phase = 'database';
    await admin.query(`create database ${staging.database} owner ${staging.owner} template template0 encoding 'UTF8' connection limit 10`);
    const owner = await connect({ ...config, database: staging.database });
    await owner.query(`set role ${staging.owner}`);
    await owner.query(`revoke all on database ${staging.database} from public;
      grant connect on database ${staging.database} to ${staging.migrator},${staging.runtime},${operatorName};
      revoke all on schema public from public;
      alter default privileges revoke execute on functions from public`);
    phase = 'schema';
    const migration = await connect({ ...config, database: staging.database, ...credentials.migrator });
    await migration.query(`set role ${staging.owner}`);
    const bootstrap = await bootstrapPostgres(migration, confirmation);
    await migration.query(`grant usage on schema app to ${staging.runtime};
      grant select on app.regions,app.cities,app.categories,app.specialist_categories,app.tariffs to ${staging.runtime}`);
    phase = 'verification';
    const runtime = await connect({ ...config, database: staging.database, ...credentials.runtime });
    await verifyStagingRuntime(runtime);
    const { rows: [counts] } = await runtime.query(`select (select count(*)::integer from app.categories) as categories,
      (select count(*)::integer from app.tariffs) as tariffs`);
    return { database: staging.database, runtimeProfile: 'references-read-only', bootstrap, counts };
  } catch (error) {
    try { await admin.query('rollback'); } catch { /* Failed connection; do not retry. */ }
    const safe = new Error(phase === 'preflight' ? 'Staging preflight failed; inspect whether target/role already exists and check configuration/credential path' : `Staging provisioning failed during ${phase}; inspect target and saved credentials before retrying`);
    if (typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)) safe.code = error.code;
    throw safe;
  } finally {
    await Promise.allSettled(connections.map((client) => client.end()));
    await admin.end();
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--plan') {
    console.log(JSON.stringify({ ...staging, runtimeProfile: 'references-read-only', migrations: getBootstrapPlan().map(({ name, sha256 }) => ({ name, sha256 })) }));
    return;
  }
  if (args.length !== 4 || args[0] !== '--apply' || args[2] !== '--credentials-file') throw new Error('Expected --apply HOST:blizhniy_staging --credentials-file PRIVATE_PATH');
  // Disable terminal echo ourselves, and prevent readline from echoing independently.
  const { createInterface } = await import('node:readline/promises');
  // Restore only the echo flag that we change, not a platform-specific termios blob.
  let restoreEcho = null;
  if (process.stdin.isTTY) {
    const settings = execFileSync('stty', ['-a'], { stdio: ['inherit', 'pipe', 'pipe'], encoding: 'utf8' });
    restoreEcho = !/(?:^|[\s;])-echo(?:[\s;]|$)/.test(settings);
    execFileSync('stty', ['-echo'], { stdio: 'inherit' });
  }
  const input = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  let password;
  try { password = await input.question('Operator password (hidden): '); }
  finally {
    input.close();
    if (restoreEcho !== null) execFileSync('stty', [restoreEcho ? 'echo' : '-echo'], { stdio: 'inherit' });
  }
  const config = readPostgresConfig({ ...process.env, BLIZHNIY_DB_PASSWORD: password });
  console.log(JSON.stringify(await provisionStaging(config, args[1], args[3])));
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`Staging operator command failed${error.code ? ` (${error.code})` : ''}; inspect state, no automatic retry`); process.exitCode = 1; });
}
