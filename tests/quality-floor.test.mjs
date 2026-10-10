import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const guard = path.resolve('scripts/check-quality-floor.mjs');

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'blizhniy-floor-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: directory, stdio: 'pipe' });
  const put = (file, contents) => {
    mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    writeFileSync(path.join(directory, file), contents);
  };
  git('init', '-q');
  git('config', 'user.email', 'floor-test@example.invalid');
  git('config', 'user.name', 'Floor regression');
  put('tests/example.test.mjs', "assert.equal(value, 1);\n");
  put('CONSTRAINTS.md', '| Coverage | >= 80% |\n| Latency | <= 800 ms |\n');
  git('add', '.');
  git('commit', '-qm', 'fixture baseline');
  const baseline = git('rev-parse', 'HEAD').toString().trim();
  const run = (args = ['--base', baseline], cwd = directory) => spawnSync(process.execPath, [guard, ...args], { cwd, encoding: 'utf8' });
  return { directory, git, put, run };
}

test('floor accepts clean work and stricter thresholds', (t) => {
  const { put, run } = fixture(t);
  assert.equal(run().status, 0);
  put('CONSTRAINTS.md', '| Coverage | >= 85% |\n| Latency | <= 700 ms |\n');
  assert.equal(run().status, 0);
});

for (const [name, file, contents, rule] of [
  ['suppression', 'src/unsafe.ts', '// @ts-ignore\nconst value = 1;\n', 'silenced-checker'],
  ['skipped test', 'tests/new.test.mjs', "test.skip('case', () => {});\n", 'test-made-easier'],
  ['unfinished implementation', 'src/stub.ts', 'throw new Error("Not implemented");\n', 'unfinished-work'],
  ['empty catch', 'src/silent.ts', 'try { work(); } catch {}\n', 'unfinished-work'],
  ['removed assertion', 'tests/example.test.mjs', 'const value = 1;\n', 'assertion-removed'],
  ['lower minimum', 'CONSTRAINTS.md', '| Coverage | >= 79% |\n| Latency | <= 800 ms |\n', 'threshold-loosened'],
  ['higher maximum', 'CONSTRAINTS.md', '| Coverage | >= 80% |\n| Latency | <= 801 ms |\n', 'threshold-loosened'],
  ['removed rule', 'CONSTRAINTS.md', '| Coverage | >= 80% |\n', 'rule-removed'],
  ['removed threshold', 'CONSTRAINTS.md', '| Coverage | enforced |\n| Latency | <= 800 ms |\n', 'threshold-removed'],
  ['new exception', 'CONSTRAINTS.md', '| Coverage | >= 80% |\n| Latency | <= 800 ms |\n| E1 | temporary |\n', 'new-exception'],
]) {
  test(`floor blocks ${name} in untracked or modified work`, (t) => {
    const { put, run } = fixture(t);
    put(file, contents);
    const result = run();
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, new RegExp(rule));
  });
}

test('floor sees staged changes from a subdirectory, without disclosing source values', (t) => {
  const { directory, git, put, run } = fixture(t);
  put('src/private.ts', '// @ts-ignore PRIVATE_FIXTURE_NOT_A_SECRET\n');
  git('add', 'src/private.ts');
  const result = run(undefined, path.join(directory, 'tests'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /silenced-checker/);
  assert.doesNotMatch(result.stderr + result.stdout, /PRIVATE_FIXTURE_NOT_A_SECRET/);
});

test('floor blocks deleted test files, including integration test naming', (t) => {
  const { directory, git, put, run } = fixture(t);
  put('tests/example-integration.mjs', 'assert.ok(true);\n');
  git('add', '.');
  git('commit', '-qm', 'integration fixture');
  rmSync(path.join(directory, 'tests/example-integration.mjs'));
  const result = run(['--base', 'HEAD']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /test-deleted/);
});

test('floor accepts documentation and literal examples instead of treating them as executed code', (t) => {
  const { put, run } = fixture(t);
  put('docs/rules.md', 'Avoid @ts-ignore and test.skip.\n');
  put('tests/fixtures.test.mjs', 'const example = "test.skip and @ts-ignore";\n');
  put('scripts/patterns.mjs', 'const pattern = /@ts-ignore/;\n');
  assert.equal(run().status, 0);
});

test('floor fails closed for missing base, invalid arguments and non-git directories', (t) => {
  const { run } = fixture(t);
  assert.equal(run(['--base', 'missing-reference']).status, 2);
  assert.equal(run(['--base']).status, 2);
  assert.equal(run(['--unknown']).status, 2);
  assert.equal(run(['--base', '--help']).status, 2);
  assert.equal(run(undefined, tmpdir()).status, 2);
});
