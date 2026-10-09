import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { getLocalReferencePayload } from './local-payment-db.mjs';

const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const run = promisify(execFile);
const toolEnv = { PATH: process.env.PATH, LANG: 'C.UTF-8', DOCKER_HOST: 'unix:///var/run/docker.sock' };
const cliVersion = '2.120.0';

export function getLocalStackConfig() {
  const owner = createHash('sha256').update(root).digest('hex').slice(0, 12);
  return { host: 'unix:///var/run/docker.sock', project: 'blizhniy-local', owner,
    network: `blizhniy-local-${owner}`, api: 'http://127.0.0.1:54341', site: 'http://127.0.0.1:3005' };
}

export function assertLocalStackContainer(row, config) {
  if (!/^[a-f0-9]{64}$/.test(row?.Id ?? '')
    || !row.Name?.startsWith('/supabase_') || !row.Name.endsWith(`_${config.project}`)
    || row.Config?.Labels?.['com.supabase.cli.project'] !== config.project
    || Object.keys(row.NetworkSettings?.Networks ?? {}).length !== 1
    || !row.NetworkSettings.Networks[config.network]
    || Object.values(row.NetworkSettings?.Ports ?? {}).some(ports => ports?.some(port => !['127.0.0.1', '::1'].includes(port.HostIp)))) {
    throw new Error('Refusing access to a foreign or network-exposed local stack');
  }
  return row.Id;
}

export function createLocalAppEnv(credentials) {
  const config = getLocalStackConfig();
  if (credentials.API_URL !== config.api) throw new Error('Refusing a non-local API URL');
  if (!credentials.ANON_KEY || !credentials.SERVICE_ROLE_KEY) throw new Error('Local credentials are missing');
  return { PATH: process.env.PATH, LANG: 'C.UTF-8', NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1',
    __NEXT_PROCESSED_ENV: 'true', NEXT_PUBLIC_LOCAL_DEVELOPMENT: 'true',
    NEXT_PUBLIC_SUPABASE_URL: config.api, NEXT_PUBLIC_SUPABASE_ANON_KEY: credentials.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: credentials.SERVICE_ROLE_KEY, SITE_URL: config.site, NEXT_PUBLIC_SITE_URL: config.site,
    PAYMENT_PROVIDER: 'mock', ENABLE_DEMO_CONTENT: 'false', NEXT_PUBLIC_ENABLE_DEMO_CONTENT: 'false',
    ENABLE_DEMO_ADMIN_BYPASS: 'false', NEXT_PUBLIC_TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '',
    NEXT_PUBLIC_2GIS_API_KEY: '', YOOKASSA_SHOP_ID: '', YOOKASSA_SECRET_KEY: '',
    YOOKASSA_RECEIPTS_ENABLED: 'false', YOOKASSA_RECEIPT_VAT_CODE: '' };
}

export function getLocalAppBootstrap() {
  const visit = (file, ancestors = []) => {
    const resolved = realpathSync(file);
    if (!resolved.startsWith(`${root}/supabase/`) || ancestors.includes(resolved)) throw new Error('Invalid local bootstrap include');
    return readFileSync(resolved, 'utf8').replace(/^\\ir (.+)$/gm,
      (_, relative) => visit(new URL(relative, pathToFileURL(resolved)), [...ancestors, resolved]));
  };
  // These reviewed migrations have no CONCURRENTLY operations. Wrap the clean
  // baseline in one transaction rather than committing a partial initialization.
  const source = visit(`${root}/supabase/local-app-bootstrap.sql`).replace(/^(begin|commit);\s*$/gim, '');
  const reference = Buffer.from(getLocalReferencePayload()).toString('base64');
  const fingerprint = createHash('sha256').update(source).update(reference).digest('hex');
  const sql = source.replaceAll(":'local_reference'", `'${reference}'`).replaceAll(":'local_fingerprint'", `'${fingerprint}'`);
  return { fingerprint, sql: `begin;\n${sql}\ncommit;` };
}

export function createLocalSupabase() {
  const config = getLocalStackConfig();
  const docker = async args => (await run('docker', ['--host', config.host, ...args],
    { env: toolEnv, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
  const cli = async (args, timeout = 30_000) => {
    const binary = process.env.SUPABASE_CLI_BIN || 'supabase';
    const version = (await run(binary, ['--version'], { env: toolEnv, timeout: 10_000 })).stdout.trim();
    if (version !== cliVersion) throw new Error(`Local stack requires Supabase CLI ${cliVersion}`);
    try {
      return (await run(binary, ['--workdir', root, ...args], { env: toolEnv, timeout, maxBuffer: 8 * 1024 * 1024 })).stdout;
    } catch (error) {
      // CLI output may contain the local service key. Do not disclose raw output.
      throw new Error(`Local Supabase CLI ${args[0]} failed (${error.code ?? 'unknown'}). Data preserved; inspect the owned local containers.`);
    }
  };
  const inspect = async () => {
    const ids = (await docker(['container', 'ls', '--all', '--filter', `label=com.supabase.cli.project=${config.project}`, '--format', '{{.ID}}'])).split('\n').filter(Boolean);
    if (!ids.length) return [];
    const rows = JSON.parse(await docker(['container', 'inspect', ...ids]));
    rows.forEach(row => assertLocalStackContainer(row, config));
    return rows;
  };
  const ensureNetwork = async () => {
    const exists = await docker(['network', 'ls', '--filter', `name=^${config.network}$`, '--format', '{{.ID}}']);
    if (!exists) await docker(['network', 'create', '--label', `blizhniy.local-stack=${config.owner}`,
      '--opt', 'com.docker.network.bridge.host_binding_ipv4=127.0.0.1', config.network]);
    const [network] = JSON.parse(await docker(['network', 'inspect', config.network]));
    if (network.Labels?.['blizhniy.local-stack'] !== config.owner || network.Driver !== 'bridge'
      || network.Options?.['com.docker.network.bridge.host_binding_ipv4'] !== '127.0.0.1') {
      throw new Error('Refusing a foreign or network-exposed local stack network');
    }
  };
  const sql = async statement => {
    const rows = await inspect();
    const database = rows.find(row => row.Name === `/supabase_db_${config.project}` && row.State.Running);
    if (!database) throw new Error('Local Supabase database is not running');
    return new Promise((resolve, reject) => {
      const child = spawn('docker', ['--host', config.host, 'exec', '-i', database.Id,
        'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], { env: toolEnv });
      let output = '', errors = '';
      const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Local SQL timed out')); }, 120_000);
      child.stdout.on('data', data => { output += data; });
      child.stderr.on('data', data => { errors += data; });
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.stdin.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => {
        clearTimeout(timer);
        if (code === 0) resolve(output.trim());
        else reject(new Error(errors.trim() || 'Local SQL failed'));
      });
      child.stdin.end(`set statement_timeout='90s';\n${statement}\n`);
    });
  };
  const credentials = async () => {
    await ensureNetwork();
    const rows = await inspect();
    if (!rows.length || rows.some(row => !row.State.Running)) throw new Error('Start the local stack first');
    const result = JSON.parse(await cli(['status', '-o', 'json']));
    createLocalAppEnv(result);
    return result;
  };
  const status = async () => {
    const rows = await inspect();
    if (!rows.length) return { running: false, ready: false, api: config.api, site: config.site };
    let ready = false;
    if (rows.every(row => row.State.Running)) {
      try { ready = await sql('select fingerprint from local_dev.bootstrap;') === getLocalAppBootstrap().fingerprint; }
      catch { /* Uninitialized schemas are not ready. No automatic reset. */ }
    }
    return { running: rows.every(row => row.State.Running), ready, api: config.api, site: config.site,
      mail: 'http://127.0.0.1:54344', containers: rows.length };
  };
  const start = async () => {
    await ensureNetwork();
    await inspect(); // Ownership and loopback checks precede any CLI mutation.
    await cli(['start', '--network-id', config.network, '--exclude',
      'realtime,imgproxy,studio,postgres-meta,edge-runtime,logflare,vector,supavisor'], 1_800_000);
    await inspect();
    const bootstrap = getLocalAppBootstrap();
    if (await sql("select to_regclass('public.profiles') is null and to_regclass('local_dev.bootstrap') is null;") === 't') {
      await sql(bootstrap.sql);
    }
    const state = await status();
    if (!state.ready) throw new Error('Local schema incomplete or changed. Data preserved; no automatic reset/migration.');
    await credentials();
    return state;
  };
  const stop = async () => {
    await ensureNetwork();
    const rows = await inspect();
    if (rows.length) await cli(['stop', '--project-id', config.project], 120_000);
    return status();
  };
  const dev = async () => {
    if (!(await status()).ready) throw new Error('Run npm run supabase:local -- start first');
    const env = createLocalAppEnv(await credentials());
    const child = spawn(process.execPath, [`${root}/node_modules/next/dist/bin/next`, 'dev', '--hostname', '127.0.0.1', '--port', '3005'],
      { cwd: root, env, stdio: 'inherit' });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
    return new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => { process.exitCode = code ?? 1; resolve(); });
    });
  };
  return { config, start, stop, status, sql, inspect, credentials, dev };
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stack = createLocalSupabase();
  const command = process.argv[2] ?? 'status';
  try {
    if (!['start', 'status', 'stop', 'dev'].includes(command) || process.argv.length > 3) {
      throw new Error('Usage: npm run supabase:local -- start|status|stop; npm run dev:local');
    }
    const result = await stack[command]();
    if (result) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
