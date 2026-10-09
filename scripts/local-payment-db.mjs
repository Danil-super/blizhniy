import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import vm from 'node:vm';

const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const run = promisify(execFile);
const childEnv = { PATH: process.env.PATH, LANG: 'C.UTF-8' };
const sha256 = value => createHash('sha256').update(value).digest('hex');
const database = 'blizhniy_local_payments';

export function getLocalDbConfig(scope = 'dev') {
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(scope)) throw new Error('Invalid local DB scope');
  const project = sha256(root).slice(0, 12);
  return {
    host: 'unix:///var/run/docker.sock', network: 'none',
    image: 'postgres@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73',
    name: `blizhniy-local-payments-${project}-${scope}`,
    labels: { 'blizhniy.local-payment-db': project, 'blizhniy.local-payment-db.scope': scope },
  };
}

export function assertLocalContainer(metadata, config) {
  if (!/^[a-f0-9]{64}$/.test(metadata?.Id ?? '') || metadata.Name !== `/${config.name}`
    || metadata.Config?.Image !== config.image || metadata.HostConfig?.NetworkMode !== 'none'
    || Object.keys(metadata.HostConfig?.PortBindings ?? {}).length !== 0
    || Object.values(metadata.NetworkSettings?.Ports ?? {}).some(value => value !== null)
    || Object.entries(config.labels).some(([key, value]) => metadata.Config?.Labels?.[key] !== value)) {
    throw new Error('Refusing to access a foreign or network-exposed local container');
  }
  return metadata.Id;
}

export function getReferenceData() {
  // Evaluate only the project's trusted, type-only-import data module. This is
  // not a sandbox for third-party code. Never import the production seeder.
  const ts = createRequire(import.meta.url)('typescript');
  const source = readFileSync(`${root}/src/lib/data.ts`, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports }, { timeout: 1000 });
  return JSON.parse(JSON.stringify({ region: exports.region, cities: exports.cities,
    categories: exports.categories, professions: exports.professions, tariffs: exports.tariffs }));
}

export function getLocalReferencePayload() {
  const seed = getReferenceData();
  const alphabet = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя';
  const latin = ['a','b','v','g','d','e','e','zh','z','i','y','k','l','m','n','o','p','r','s','t','u','f','h','ts','ch','sh','shch','','y','','e','yu','ya'];
  const slugify = name => name.toLowerCase().replace(/[а-яё]/g, char => latin[alphabet.indexOf(char)])
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const slugs = new Set(seed.categories.map(row => row.slug));
  seed.categories = seed.categories.map(row => ({ ...row, children: row.children.map(name => {
    const slug = `${row.slug}-${slugify(name)}`;
    if (slugs.has(slug)) throw new Error('Duplicate local catalog seed slug');
    slugs.add(slug);
    return { name, slug };
  }) }));
  return JSON.stringify(seed);
}

function bootstrapFingerprint() {
  const hash = createHash('sha256');
  const visit = file => {
    const resolved = realpathSync(file);
    if (!resolved.startsWith(`${root}/supabase/`)) throw new Error('Bootstrap source must be in supabase/');
    const source = readFileSync(resolved, 'utf8');
    hash.update(source);
    for (const match of source.matchAll(/^\\ir (.+)$/gm)) visit(new URL(match[1], pathToFileURL(resolved)));
  };
  visit(`${root}/supabase/local-payment-bootstrap.sql`);
  return hash.update(getLocalReferencePayload()).digest('hex');
}

export function createLocalPaymentDb(scope = 'dev') {
  const config = getLocalDbConfig(scope);
  const docker = async args => (await run('docker', ['--host', config.host, ...args],
    { env: childEnv, timeout: 20_000, maxBuffer: 2 * 1024 * 1024 })).stdout.trim();
  const inspect = async () => {
    const found = await docker(['container', 'ls', '--all', '--filter', `name=^/${config.name}$`, '--format', '{{.ID}}']);
    if (!found) return null;
    const metadata = JSON.parse(await docker(['container', 'inspect', config.name]))[0];
    assertLocalContainer(metadata, config);
    return metadata;
  };
  const psql = (id, statement, variables = {}) => new Promise((resolve, reject) => {
    const args = ['--host', config.host, 'exec', '-i', id, 'psql', '-X', '-q', '-A', '-t',
      '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database];
    for (const [key, value] of Object.entries(variables)) args.push('-v', `${key}=${value}`);
    const child = spawn('docker', args, { env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', errors = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Local SQL timed out')); }, 15_000);
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { errors += data; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.stdin.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(output.trim());
      else reject(new Error(errors.trim() || 'Local SQL failed'));
    });
    child.stdin.end(`set statement_timeout='10s';\n${statement}\n`);
  });
  const sql = async statement => {
    const metadata = await inspect();
    if (!metadata?.State.Running) throw new Error('Local database is stopped; run npm run db:local -- start');
    return psql(metadata.Id, statement);
  };
  const status = async () => {
    const metadata = await inspect();
    if (!metadata) return { exists: false, running: false, ready: false, name: config.name };
    let ready = false;
    if (metadata.State.Running) {
      try { ready = await psql(metadata.Id, 'select fingerprint from local_dev.bootstrap;') === bootstrapFingerprint(); }
      catch { /* Uninitialized or changed bootstrap is never reported as ready. */ }
    }
    return { exists: true, running: metadata.State.Running, ready, name: config.name };
  };
  const start = async () => {
    const fingerprint = bootstrapFingerprint();
    let metadata = await inspect();
    const fresh = !metadata;
    if (fresh) {
      // No automatic pull or credentials; the only database connection is its
      // container-local Unix socket. PGDATA is an anonymous persistent volume.
      await docker(['run', '--detach', '--pull', 'never', '--network', 'none', '--name', config.name,
        ...Object.entries(config.labels).flatMap(([key, value]) => ['--label', `${key}=${value}`]),
        '--memory', '512m', '--cpus', '1', '--mount', `type=bind,source=${root}/supabase,target=/work/supabase,readonly`,
        '-e', `POSTGRES_DB=${database}`, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', config.image,
        '-c', 'listen_addresses=', '-c', 'timezone=UTC']);
      metadata = await inspect();
    } else if (!metadata.State.Running) {
      await docker(['start', metadata.Id]);
    }
    const deadline = performance.now() + 15_000;
    for (;;) {
      try { await psql(metadata.Id, 'select 1;'); break; }
      catch (error) {
        if (performance.now() > deadline) throw error;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    if (fresh) {
      await psql(metadata.Id, '\\ir /work/supabase/local-payment-bootstrap.sql', {
        local_reference: Buffer.from(getLocalReferencePayload()).toString('base64'), local_fingerprint: fingerprint,
      });
    }
    const state = await status();
    if (!state.ready) throw new Error('Local bootstrap incomplete or changed. Data preserved; no automatic reset/migration.');
    return state;
  };
  const stop = async () => {
    const metadata = await inspect();
    if (metadata?.State.Running) await docker(['stop', '--time', '10', metadata.Id]);
    return status();
  };
  return { config, start, status, stop, inspect, sql, docker };
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const db = createLocalPaymentDb();
  const command = process.argv[2] ?? 'status';
  try {
    if (['start', 'status', 'stop'].includes(command) && process.argv.length <= 3) {
      process.stdout.write(`${JSON.stringify(await db[command](), null, 2)}\n`);
    } else if (command === 'sql' && process.argv.length === 3) {
      let statement = '';
      for await (const chunk of process.stdin) statement += chunk;
      process.stdout.write(`${await db.sql(statement)}\n`);
    } else throw new Error('Usage: npm run db:local -- start|status|stop|sql (SQL from stdin)');
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
