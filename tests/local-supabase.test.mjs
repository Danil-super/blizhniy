import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { getLocalStackConfig, assertLocalStackContainer, createLocalAppEnv } from '../scripts/local-supabase.mjs';

test('full local stack pins the local Docker socket and checks project/network ownership', () => {
  const config = getLocalStackConfig();
  assert.equal(config.host, 'unix:///var/run/docker.sock');
  const metadata = () => ({
    Id: 'a'.repeat(64), Name: `/supabase_db_${config.project}`,
    Config: { Labels: { 'com.supabase.cli.project': config.project } },
    NetworkSettings: { Networks: { [config.network]: {} }, Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '54342' }] } },
  });
  assert.equal(assertLocalStackContainer(metadata(), config), 'a'.repeat(64));
  for (const mutate of [
    row => { row.Config.Labels = {}; },
    row => { row.NetworkSettings.Networks = { bridge: {} }; },
    row => { row.NetworkSettings.Ports['5432/tcp'][0].HostIp = '0.0.0.0'; },
    row => { row.NetworkSettings.Ports['5432/tcp'][0].HostIp = '192.168.1.5'; },
    row => { row.Name = '/production'; },
  ]) {
    const row = metadata(); mutate(row);
    assert.throws(() => assertLocalStackContainer(row, config), /local stack/);
  }
});

test('local site uses only local credentials, ignores cloud env, and skips dotenv parsing', () => {
  const env = createLocalAppEnv({ API_URL: 'http://127.0.0.1:54341', ANON_KEY: 'local-anon', SERVICE_ROLE_KEY: 'local-service' });
  assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:54341');
  assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, 'local-service');
  assert.equal(env.__NEXT_PROCESSED_ENV, 'true');
  assert.equal(env.NEXT_PUBLIC_LOCAL_DEVELOPMENT, 'true');
  assert.equal(env.PAYMENT_PROVIDER, 'mock');
  assert.equal(env.YOOKASSA_SECRET_KEY, '');
  assert.equal(env.TURNSTILE_SECRET_KEY, '');
  assert.equal(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY, '');
  assert.equal(env.ENABLE_DEMO_CONTENT, 'false');
  assert.equal(env.NODE_ENV, 'development');
  for (const API_URL of ['https://example.supabase.co', 'http://localhost:54341', 'http://127.0.0.1:54321', 'http://user@127.0.0.1:54341', 'http://127.0.0.1:54341/remote']) {
    assert.throws(() => createLocalAppEnv({ API_URL, ANON_KEY: 'a', SERVICE_ROLE_KEY: 'b' }), /local API/);
  }
  assert.throws(() => createLocalAppEnv({ API_URL: 'http://127.0.0.1:54341' }), /credentials/);
});

test('local CLI does not replay historic migrations or legacy demo seed automatically', () => {
  const config = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  assert.match(config, /\[db\.migrations\]\s+enabled = false/);
  assert.match(config, /\[db\.seed\]\s+enabled = false/);
  assert.match(config, /site_url = "http:\/\/127\.0\.0\.1:3005"/);
  assert.match(config, /enable_confirmations = true/);
});

test('Next.js cannot replace local credentials with the existing cloud dotenv file', () => {
  const env = createLocalAppEnv({ API_URL: 'http://127.0.0.1:54341', ANON_KEY: 'local-anon', SERVICE_ROLE_KEY: 'local-service' });
  const result = spawnSync(process.execPath, ['-e', `
    require('@next/env').loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
    process.stdout.write(JSON.stringify({ api: process.env.NEXT_PUBLIC_SUPABASE_URL,
      service: process.env.SUPABASE_SERVICE_ROLE_KEY, turnstile: process.env.TURNSTILE_SECRET_KEY,
      payment: process.env.PAYMENT_PROVIDER, yookassa: process.env.YOOKASSA_SECRET_KEY }));
  `], { encoding: 'utf8', env });
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), { api: 'http://127.0.0.1:54341', service: 'local-service',
    turnstile: '', payment: 'mock', yookassa: '' });
});

test('the local build output is isolated and production cannot opt into the development directory', () => {
  const ts = createRequire(import.meta.url)('typescript');
  const compiled = ts.transpileModule(readFileSync(new URL('../next.config.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  for (const [mode, flag, directory] of [
    ['development', 'true', '.next-local'], ['development', undefined, '.next'], ['production', 'true', '.next'],
  ]) {
    const exports = {};
    vm.runInNewContext(compiled, { exports, process: { env: { NODE_ENV: mode, NEXT_PUBLIC_LOCAL_DEVELOPMENT: flag } } });
    assert.equal(exports.default.distDir, directory);
  }
});
