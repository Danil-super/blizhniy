import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createScramVerifier, saveStagingCredentials, validateStagingTarget } from '../scripts/provision-staging-postgres.mjs';

const config = { host: 'db.example.invalid', database: 'default_db', user: 'operator', password: 'fixture', ssl: { rejectUnauthorized: true } };

test('only explicitly confirmed separate staging database is accepted', () => {
  assert.equal(validateStagingTarget(config, 'db.example.invalid:blizhniy_staging'), undefined);
  for (const confirmation of ['db.example.invalid:default_db', 'db.example.invalid:postgres', '', 'other.invalid:blizhniy_staging']) {
    assert.throws(() => validateStagingTarget(config, confirmation));
  }
  assert.throws(() => validateStagingTarget({ ...config, database: 'blizhniy_staging' }, 'db.example.invalid:blizhniy_staging'));
  assert.throws(() => validateStagingTarget({ ...config, ssl: false }, 'db.example.invalid:blizhniy_staging'));
  assert.throws(() => validateStagingTarget({ ...config, ssl: { rejectUnauthorized: false } }, 'db.example.invalid:blizhniy_staging'));
});

test('TLS-disabled fixture is allowed only on loopback with explicit test mode', () => {
  assert.equal(validateStagingTarget({ ...config, host: '127.0.0.1', ssl: false }, '127.0.0.1:blizhniy_staging', 'test'), undefined);
  assert.throws(() => validateStagingTarget({ ...config, ssl: false }, 'db.example.invalid:blizhniy_staging', 'test'));
});

test('SCRAM verifier accepts only generated ASCII hex passwords, has fresh salt and no plaintext', () => {
  const password = 'ab'.repeat(32);
  const first = createScramVerifier(password);
  assert.match(first, /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]+=*\$[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*$/);
  assert.notEqual(first, createScramVerifier(password));
  assert.ok(!first.includes(password));
  for (const value of ['', 'simple-password', 'аб'.repeat(32), undefined]) assert.throws(() => createScramVerifier(value));
});

test('credentials are created privately without overwriting existing files', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'blizhniy-staging-credentials-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'credentials.json');
  const contents = { runtime: 'synthetic-fixture-only' };
  saveStagingCredentials(file, contents);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), contents);
  assert.throws(() => saveStagingCredentials(file, { runtime: 'different-fixture' }));
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), contents);
});

test('credentials refuse symlink destinations, non-private folders and repository paths', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'blizhniy-staging-path-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const original = path.join(directory, 'original.json');
  writeFileSync(original, 'fixture');
  const linked = path.join(directory, 'linked.json');
  symlinkSync(original, linked);
  assert.throws(() => saveStagingCredentials(linked, {}));
  assert.throws(() => saveStagingCredentials(path.join(tmpdir(), 'blizhniy-invalid-output.json'), {}));
  assert.throws(() => saveStagingCredentials(path.resolve('staging-credentials.json'), {}));
  assert.equal(readFileSync(original, 'utf8'), 'fixture');
});
