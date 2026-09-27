import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const deployScript = path.resolve('scripts/deploy-release.sh');

function runDeploy(ready) {
  const root = mkdtempSync(path.join(tmpdir(), 'deploy-readiness-'));
  try {
    const bin = path.join(root, 'bin');
    const previous = path.join(root, 'previous');
    const source = path.join(root, 'source');
    const app = path.join(root, 'app');
    const probeLog = path.join(root, 'probes.log');
    for (const dir of [bin, previous, source]) mkdirSync(dir);
    writeFileSync(path.join(previous, 'ecosystem.config.cjs'), 'module.exports = {};\n');
    writeFileSync(path.join(source, 'ecosystem.config.cjs'), 'module.exports = {};\n');
    symlinkSync(previous, app);

    for (const cmd of ['npm', 'node', 'pm2', 'sleep']) {
      writeFileSync(path.join(bin, cmd), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
    }
    writeFileSync(path.join(bin, 'seq'), '#!/usr/bin/env bash\nprintf "1\\n2\\n3\\n"\n', { mode: 0o755 });
    writeFileSync(path.join(bin, 'curl'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$PROBE_LOG"
if [[ "$*" == *"/api/ready"* && "$READY_MODE" == "down" ]]; then exit 22; fi
exit 0
`, { mode: 0o755 });

    const result = spawnSync('/bin/bash', [deployScript], {
      encoding: 'utf8',
      env: {
        ...process.env,
        APP_DIR: app,
        SOURCE_DIR: source,
        RELEASES_DIR: path.join(root, 'releases'),
        COMMIT_SHA: 'a'.repeat(40),
        PROBE_LOG: probeLog,
        READY_MODE: ready ? 'up' : 'down',
        PATH: `${bin}:${process.env.PATH}`,
      },
    });

    return { result, activeRelease: readlinkSync(app), probes: readFileSync(probeLog, 'utf8'), previous };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('an available process with unavailable database does not get promoted', () => {
  const { result, activeRelease, previous, probes } = runDeploy(false);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.equal(activeRelease, previous, 'rollback restores the previous release');
  assert.match(probes, /\/api\/health/);
  assert.match(probes, /\/api\/ready/);
  assert.doesNotMatch(result.stdout, /promoting release/);
});

test('a ready process promotes only after both probes succeed', () => {
  const { result, activeRelease, previous, probes } = runDeploy(true);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.notEqual(activeRelease, previous);
  assert.match(probes, /\/api\/health[\s\S]*\/api\/ready/);
  assert.match(result.stdout, /promoting release/);
});
