import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, realpathSync, symlinkSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assertPhotoSandbox } from '../scripts/media-sandbox-check.mjs';
const good = () => ({ uid: 993, gid: 984, node: '22.23.3', env: { NODE_ENV: 'production' },
  status: 'NoNewPrivs:\t1\nCapEff:\t0000000000000000\nCapAmb:\t0000000000000000\n',
  cgroup: '0::/system.slice/blizhniy-media-check.service\n',
  limits: { memory: '536870912\n', swap: '0\n', tasks: '32\n', cpu: '100000 100000\n' } });
test('sandbox proof requires the actual dedicated non-root production unit and kernel limits', () => {
  assert.doesNotThrow(() => assertPhotoSandbox(good()));
  for (const change of [v => v.uid = 0, v => v.gid = 0, v => v.node = '20.20.2', v => v.env.NODE_ENV = 'test',
    v => v.env.DATABASE_URL = 'synthetic-private', v => v.env.NODE_OPTIONS = '--inspect',
    v => v.status = v.status.replace('NoNewPrivs:\t1', 'NoNewPrivs:\t0'), v => v.status = v.status.replace('CapEff:\t0000000000000000', 'CapEff:\t0000000000000001'),
    v => v.cgroup = '0::/unrelated.service\n', v => v.limits.memory = 'max', v => v.limits.swap = 'max', v => v.limits.tasks = 'max', v => v.limits.cpu = 'max 100000']) {
    const value = good(); change(value); assert.throws(() => assertPhotoSandbox(value), /Photo sandbox unavailable/);
  }
});
test('production sandbox check refuses direct invocation outside its actual cgroup without private diagnostics', () => {
  const run = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/media-sandbox-check.mjs', '--check'], {
    encoding: 'utf8', timeout: 5000, env: { PATH: process.env.PATH, NODE_ENV: 'production' },
  });
  assert.equal(run.status, 1); assert.deepEqual(JSON.parse(run.stdout), { event: 'media_sandbox_check', status: 'unavailable' });
  assert.doesNotMatch(run.stderr, /Error:|\/home\/|password|stack/);
});
test('invocation through the production symlink executes the guard instead of exiting successfully without checking', () => {
  const root = mkdtempSync(join(tmpdir(), 'blizhniy-media-entry-'));
  try {
    const entry = join(root, 'check.mjs'); symlinkSync(realpathSync('scripts/media-sandbox-check.mjs'), entry);
    for (const flags of [[], ['--preserve-symlinks-main']]) {
      const run = spawnSync(process.execPath, ['--experimental-strip-types', ...flags, entry, '--check'], {
        encoding: 'utf8', timeout: 5000, env: { PATH: process.env.PATH, NODE_ENV: 'production' },
      });
      assert.equal(run.status, 1); assert.deepEqual(JSON.parse(run.stdout), { event: 'media_sandbox_check', status: 'unavailable' });
    }
  } finally { rmSync(root, { recursive: true }); }
});
test('media proof unit separates the decoder identity, files and network and has no scheduler or credentials', () => {
  const unit = readFileSync('ops/systemd/blizhniy-media-check.service', 'utf8');
  for (const value of ['Type=oneshot', 'User=blizhniy-media', 'Group=blizhniy-media', 'MemoryMax=512M', 'MemorySwapMax=0', 'TasksMax=32',
    'CPUQuota=100%', 'TimeoutStartSec=8', 'NoNewPrivileges=true', 'ProtectSystem=strict', 'ProtectHome=true', 'PrivateNetwork=true',
    'RestrictAddressFamilies=AF_UNIX', 'CapabilityBoundingSet=', 'AmbientCapabilities=', 'LimitCORE=0', 'ProtectProc=invisible',
    'InaccessiblePaths=-/etc/blizhniy -/var/lib/blizhniy-web']) assert.ok(unit.includes(value), value);
  assert.match(unit, /ExecStart=\/opt\/blizhniy-node22\/bin\/node .*media-sandbox-check\.mjs --check/);
  assert.doesNotMatch(unit, /EnvironmentFile|WantedBy|Restart=|NODE_ENV=test|Password|RuntimeMaxSec/);
  const root = mkdtempSync(join(tmpdir(), 'blizhniy-media-unit-'));
  try {
    const file = join(root, 'blizhniy-media-check.service');
    writeFileSync(file, unit.replace('/opt/blizhniy-node22/bin/node', process.execPath));
    execFileSync('systemd-analyze', ['verify', '--man=no', file], { timeout: 5000, maxBuffer: 16384 });
  } finally { rmSync(root, { recursive: true }); }
});
