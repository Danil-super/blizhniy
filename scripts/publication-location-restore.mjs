import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const table = 'app_publication_privacy.location_withdrawals';
const source = 'blizhniy_prod';
const target = 'blizhniy_restore';
const scope = 'blizhniy-location-withdrawals';
const maxRows = 100000;
const maxBytes = 16 * 1024 * 1024;
const kinds = new Set(['listing', 'vacancy', 'workRequest', 'specialist', 'fair', 'marquee']);
const digest = data => createHash('sha256').update(data).digest('hex');
const encode = rows => JSON.stringify({ version: 4, scope, rows });
const photoScope = /^photo:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const textScope = /^text:([a-zA-Z]+):[0-9a-f]{64}:(0|[1-9][0-9]{0,3}):([1-9][0-9]{0,3})$/;
const textFields={
  listing:['title','description'],vacancy:['title','description','organization','schedule','workFormat','requirements','responsibilities','conditions'],
  workRequest:['title','description'],specialist:['description','skills','experience'],fair:['title','description'],marquee:['title'],
};

function checkpointRows(document, expectedDigest) {
  try {
    if (typeof document !== 'string' || Buffer.byteLength(document) > maxBytes ||
        typeof expectedDigest !== 'string' || !/^[a-f0-9]{64}$/.test(expectedDigest) ||
        digest(document) !== expectedDigest) throw Error();
    const { rows } = JSON.parse(document);
    if (!Array.isArray(rows) || rows.length > maxRows) throw Error();
    const ids = new Set();
    const normalized = rows.map(({ kind, publicationId, withdrawnAt, scope }) => {
      const text = typeof scope === 'string' ? textScope.exec(scope) : null;
      const permittedScope = scope === 'publication' || scope === 'location' && kind !== 'marquee' ||
        (scope === 'phone' || scope === 'messenger') && kind === 'listing' ||
        scope === 'name' && (kind === 'listing' || kind === 'specialist') ||
        scope === 'avatar' && kind === 'specialist' ||
        typeof scope === 'string' && ['listing','vacancy','workRequest','fair'].includes(kind) && photoScope.test(scope) ||
        text && kinds.has(kind) && textFields[kind].includes(text[1]) && Number(text[2])<Number(text[3]);
      if (!kinds.has(kind) || !permittedScope ||
          typeof publicationId !== 'string' ||
          !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(publicationId) ||
          typeof withdrawnAt !== 'string' || withdrawnAt.startsWith('0000-') ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(withdrawnAt) ||
          new Date(withdrawnAt).toISOString().slice(0, 19) !== withdrawnAt.slice(0, 19)) throw Error();
      const id = kind + ':' + publicationId + ':' + scope;
      if (ids.has(id)) throw Error();
      ids.add(id);
      return { kind, publicationId, withdrawnAt, scope };
    });
    if (encode(normalized) !== document) throw Error();
    return normalized;
  } catch {
    throw new Error('Invalid withdrawal checkpoint');
  }
}

async function checkDatabase(client, database) {
  const { rows: [context] } = await client.query(`select current_database() as database,
    current_user='postgres' and session_user='postgres' and not pg_is_in_recovery()
    and current_setting('session_replication_role')='origin' as allowed`);
  if (context?.database !== database || context.allowed !== true) throw new Error('Unexpected database');
}

export async function captureLocationWithdrawals(client) {
  await checkDatabase(client, source);
  const { rows } = await client.query(`select kind,publication_id::text as "publicationId",
    to_char(withdrawn_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "withdrawnAt",scope
    from ${table} order by kind collate "C",publication_id,scope collate "C" limit ${maxRows + 1}`);
  const document = encode(rows), sha256 = digest(document);
  return { count: checkpointRows(document, sha256).length, document, sha256 };
}

async function assertClosed(client) {
  const { rows: [row] } = await client.query(`select
    not has_database_privilege('blizhniy_runtime',current_database(),'CONNECT')
    and not exists(select 1 from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid()
      and backend_type='client backend') as closed`);
  if (row?.closed !== true) throw new Error('Restore database must be closed');
}

export async function replayLocationWithdrawals(client, document, sha256) {
  const records = checkpointRows(document, sha256);
  await checkDatabase(client, target);
  await client.query('begin');
  try {
    await client.query("set local search_path=pg_catalog,pg_temp");
    await client.query("set local lock_timeout='3s'");
    await client.query("set local statement_timeout='30s'");
    await assertClosed(client);
    await client.query('lock table ' + table + ' in share row exclusive mode');
    const input = 'jsonb_to_recordset($1::jsonb) as r(kind text,"publicationId" uuid,"withdrawnAt" timestamptz,scope text)';
    const { rowCount: inserted } = await client.query(`insert into ${table}(kind,publication_id,withdrawn_at,scope)
      select kind,"publicationId","withdrawnAt",scope from ${input} on conflict (kind,publication_id,scope) do nothing`, [JSON.stringify(records)]);
    const { rows: [result] } = await client.query(`select not exists(select 1 from ${input}
      left join ${table} w on w.kind=r.kind and w.publication_id=r."publicationId" and w.scope=r.scope
      where w.withdrawn_at is distinct from r."withdrawnAt") as matches`, [JSON.stringify(records)]);
    if (result?.matches !== true) throw new Error('Withdrawal checkpoint conflicts with restored data');
    const { rows: [consents] } = await client.query(
      "select to_regclass('app_publication_privacy.publication_consents') is not null as installed");
    if (typeof consents?.installed !== 'boolean') throw new Error('Cannot verify consent schema');
    if (consents.installed) {
      await client.query('update app_publication_privacy.publication_consents set retired=true where not retired');
    }
    await assertClosed(client);
    await client.query('commit');
    return { count: records.length, inserted, reopenAuthorized: false };
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

async function readCheckpoint(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || (metadata.mode & 0o077) !== 0 || metadata.size > maxBytes) throw Error('Unsafe checkpoint');
    return await file.readFile('utf8');
  } finally { await file.close(); }
}

async function main([action, socket, path, sha256, ...extra]) {
  if (!['capture', 'replay'].includes(action) || !socket?.startsWith('/') || !path ||
      extra.length || (action === 'capture' ? sha256 !== undefined : !sha256)) {
    throw new Error('Expected capture SOCKET FILE or replay SOCKET FILE TRUSTED_SHA256');
  }
  const { default: pg } = await import('pg');
  const client = new pg.Client({ host: socket, port: 5432, user: 'postgres', database: action === 'capture' ? source : target,
    ssl: false, connectionTimeoutMillis: 4000, statement_timeout: 30000, options: '-csearch_path=pg_catalog,pg_temp' });
  try {
    await client.connect();
    if (action === 'replay') {
      console.log(JSON.stringify(await replayLocationWithdrawals(client, await readCheckpoint(path), sha256)));
    } else {
      const checkpoint = await captureLocationWithdrawals(client);
      await writeFile(path, checkpoint.document, { flag: 'wx', mode: 0o600 });
      console.log(JSON.stringify({ count: checkpoint.count, sha256: checkpoint.sha256 }));
    }
  } finally { await client.end(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(() => {
    console.error('Publication location recovery failed. Keep the recovered site closed or suppress exact locations.');
    process.exitCode = 1;
  });
}
