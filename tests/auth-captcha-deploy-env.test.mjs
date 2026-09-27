import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = path.resolve('scripts/check-auth-captcha-env.cjs');

function runWithEnvFile(contents) {
  const dir = mkdtempSync(path.join(tmpdir(), 'auth-captcha-gate-'));
  try {
    if (contents !== null) writeFileSync(path.join(dir, '.env.production'), contents);
    const env = { ...process.env, NODE_ENV: 'production' };
    delete env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    return spawnSync(process.execPath, [script, dir], { encoding: 'utf8', env });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('deployment refuses a release without a CAPTCHA site key', () => {
  const result = runWithEnvFile(null);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /NEXT_PUBLIC_TURNSTILE_SITE_KEY is required/);
});

test('deployment reads the production build env without disclosing the key', () => {
  const secret = 'synthetic-public-site-key';
  const result = runWithEnvFile(`NEXT_PUBLIC_TURNSTILE_SITE_KEY=${secret}\n`);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout + result.stderr, /synthetic-public-site-key/);
});
