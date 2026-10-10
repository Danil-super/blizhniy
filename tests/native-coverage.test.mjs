import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import reporter, { summarizeCoverage } from '../scripts/native-coverage-reporter.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const inventory = ['src/lib/measured.ts', 'src/app/unmeasured/page.tsx'];
const file = { path: path.join(root, inventory[0]), totalLineCount: 10, coveredLineCount: 7,
  totalBranchCount: 4, coveredBranchCount: 2, totalFunctionCount: 3, coveredFunctionCount: 2,
  lines: [{ line: 8, count: 0 }, { line: 9, count: 0 }, { line: 10, count: 0 }] };

test('coverage keeps unmeasured sources separate and calculates weighted native counts', () => {
  const result = summarizeCoverage([file], inventory, root);
  assert.deepEqual(result.unmeasuredFiles, [inventory[1]]);
  assert.equal(result.sourceFiles, 2);
  assert.equal(result.measuredFiles, 1);
  assert.deepEqual(result.totals.lines, { covered: 7, total: 10, percent: 70 });
  assert.deepEqual(result.totals.branches, { covered: 2, total: 4, percent: 50 });
  assert.deepEqual(result.files[0].uncoveredLines, [8, 9, 10]);
  assert.equal(result.scope, 'native-backend-subset');
  assert.equal(result.changedLineGate, false);
  const second = { ...file, path: path.join(root, inventory[1]), totalLineCount: 90, coveredLineCount: 90 };
  assert.equal(summarizeCoverage([file, second], inventory, root).totals.lines.percent, 97);
});

test('empty, duplicate, foreign or malformed coverage fails without reporting success', () => {
  for (const files of [[], [file, file], [{ ...file, path: path.join(root, 'tests/fixture.mjs') }],
    [{ ...file, path: '/outside/src/lib/measured.ts' }], [{ ...file, coveredLineCount: 11 }],
    [{ ...file, coveredBranchCount: NaN }], [{ ...file, totalFunctionCount: -1 }]]) {
    assert.throws(() => summarizeCoverage(files, inventory, root));
  }
  assert.equal(summarizeCoverage([{ ...file, totalBranchCount: 0, coveredBranchCount: 0 }], inventory, root).totals.branches.percent, null);
});

async function collect(events) {
  const output = [];
  for await (const chunk of reporter(events)) output.push(chunk);
  return output;
}
const successful = { type: 'test:summary', data: { success: true, counts: { tests: 1, passed: 1, failed: 0, cancelled: 0, skipped: 0, todo: 0 } } };
const coverage = { type: 'test:coverage', data: { summary: { files: [{ ...file, path: path.join(root, 'src/lib/server-request-timeout.ts') }] } } };

test('reporter refuses missing coverage, unsuccessful, skipped and empty test runs', async () => {
  await assert.rejects(collect([successful]));
  for (const data of [{ ...successful.data, success: false },
    { ...successful.data, counts: { ...successful.data.counts, skipped: 1 } },
    { ...successful.data, counts: { ...successful.data.counts, tests: 0, passed: 0 } }]) {
    await assert.rejects(collect([coverage, { type: 'test:summary', data }]));
  }
});

test('reporter waits for the cumulative success event and rejects duplicate coverage', async () => {
  const output = await collect([coverage, { ...successful, data: { ...successful.data, file: 'child.test.mjs', success: false } }, successful]);
  assert.equal(output.length, 1);
  assert.equal(JSON.parse(output[0]).tests.passed, 1);
  await assert.rejects(collect([coverage, coverage, successful]));
});

test('native reporter works with actual TypeScript imports and excludes test code', () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // Launch an independent runner, not an inherited test worker.
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--experimental-test-coverage',
    '--test-coverage-include=src/**', '--test-reporter=./scripts/native-coverage-reporter.mjs',
    '--test', 'tests/server-request-timeout.test.mjs'], { cwd: root, env, encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.ok(report.tests.passed > 0);
  assert.ok(report.files.some(item => item.path === 'src/lib/server-request-timeout.ts'));
  assert.ok(report.files.every(item => item.path.startsWith('src/')));
  assert.ok(report.unmeasuredFiles.includes('src/app/page.tsx'));
});

test('coverage runner is additive and cannot silently replace full regression with VM coverage', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts['test:coverage:native'], 'node scripts/run-native-coverage.mjs');
  assert.match(pkg.scripts.test, /tests\/\*\.test\.mjs tests\/\*\.test\.cjs scripts\/test-\*\.mjs/);
  const unknown = spawnSync(process.execPath, ['scripts/run-native-coverage.mjs', '--unknown'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(unknown.status, 0);
  assert.ok(!unknown.stdout.includes('native-backend-subset'));
});
