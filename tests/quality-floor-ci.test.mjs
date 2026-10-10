import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('CI checks the real PR or push baseline before dependencies and deployment', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /fetch-depth: 0/);
  assert.match(ci, /QUALITY_FLOOR_BASE:.*github\.event\.pull_request\.base\.sha.*github\.event\.before/);
  assert.match(ci, /base="\$\{QUALITY_FLOOR_BASE:-HEAD\^\}"/);
  assert.match(ci, /node scripts\/check-quality-floor\.mjs --base "\$base"/);
  const gate = ci.slice(ci.indexOf('- name: Guard quality floor'), ci.indexOf('- name: Install dependencies'));
  assert.ok(gate.length > 0);
  assert.doesNotMatch(gate, /continue-on-error|\|\| true/);
});

test('explicit type checking and existing tests remain mandatory CI steps', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /- name: Type check\s+run: npm run check:types/);
  assert.match(ci, /node --experimental-strip-types --test tests\/\*\.test\.mjs tests\/\*\.test\.cjs scripts\/test-\*\.mjs/);
  assert.match(read('.github/workflows/deploy.yml'), /needs: \[validate, security, codeql\]/);
});

test('local commands use installed tooling rather than downloading new runners', () => {
  const { scripts } = JSON.parse(read('package.json'));
  assert.equal(scripts['check:floor'], 'node scripts/check-quality-floor.mjs');
  assert.equal(scripts['check:types'], 'node node_modules/typescript/bin/tsc --noEmit');
  assert.equal(scripts.test, 'node --experimental-strip-types --test tests/*.test.mjs tests/*.test.cjs scripts/test-*.mjs');
});
