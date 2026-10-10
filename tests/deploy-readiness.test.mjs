import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import test from 'node:test';

const deployScript = path.resolve('scripts/deploy-release.sh');

function runDeploy(ready, prebuilt = false, checksumValid = true) {
  const root = mkdtempSync(path.join(tmpdir(), 'deploy-readiness-'));
  try {
    const bin = path.join(root, 'bin');
    const previous = path.join(root, 'previous');
    const source = path.join(root, 'source');
    const app = path.join(root, 'app');
    const probeLog = path.join(root, 'probes.log');
    const commandLog = path.join(root, 'commands.log');
    for (const dir of [bin, previous, source]) mkdirSync(dir);
    writeFileSync(path.join(previous, 'ecosystem.config.cjs'), 'module.exports = {};\n');
    writeFileSync(path.join(source, 'ecosystem.config.cjs'), 'module.exports = {};\n');
    symlinkSync(previous, app);

    for (const cmd of ['npm', 'node', 'pm2', 'sleep']) {
      writeFileSync(path.join(bin, cmd), `#!/usr/bin/env bash
printf '%s %s\\n' '${cmd}' "$*" >> "$COMMAND_LOG"
if [[ '${cmd}' == node && "$1" == --version ]]; then printf 'v22.23.3\\n'; fi
exit 0
`, { mode: 0o755 });
    }
    writeFileSync(path.join(bin, 'seq'), '#!/usr/bin/env bash\nprintf "1\\n2\\n3\\n"\n', { mode: 0o755 });
    writeFileSync(path.join(bin, 'curl'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$PROBE_LOG"
if [[ "$*" == *"/api/ready"* && "$READY_MODE" == "down" ]]; then exit 22; fi
exit 0
`, { mode: 0o755 });

    let archive, checksum;
    if (prebuilt) {
      mkdirSync(path.join(source, '.next'));
      mkdirSync(path.join(source, 'scripts'));
      writeFileSync(path.join(source, 'scripts', 'check-auth-captcha-env.cjs'), '// fixture checker\n');
      writeFileSync(path.join(source, '.next', 'BUILD_ID'), 'fixture-build');
      writeFileSync(path.join(source, 'server.js'), '// fixture standalone server\n');
      archive = path.join(root, 'release.tar.gz');
      assert.equal(spawnSync('tar', ['-czf', archive, '-C', source, '.']).status, 0);
      checksum = createHash('sha256').update(readFileSync(archive)).digest('hex');
    }
    const result = spawnSync('/bin/bash', [deployScript], {
      encoding: 'utf8',
      env: {
        ...process.env,
        APP_DIR: app,
        SOURCE_DIR: source,
        SOURCE_ARCHIVE: archive ?? '',
        SOURCE_ARCHIVE_SHA256: checksumValid ? checksum ?? '' : '0'.repeat(64),
        PREBUILT_RELEASE: prebuilt ? 'true' : 'false',
        RELEASES_DIR: path.join(root, 'releases'),
        COMMIT_SHA: 'a'.repeat(40),
        PROBE_LOG: probeLog,
        COMMAND_LOG: commandLog,
        READY_MODE: ready ? 'up' : 'down',
        PATH: `${bin}:${process.env.PATH}`,
      },
    });

    return { result, activeRelease: readlinkSync(app), probes: existsSync(probeLog) ? readFileSync(probeLog, 'utf8') : '',
      commands: existsSync(commandLog) ? readFileSync(commandLog, 'utf8') : '', previous,
      releaseMode: statSync(readlinkSync(app)).mode & 0o777 };
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

test('prebuilt release is promoted without installing dependencies or rebuilding on VPS', () => {
  const { result, activeRelease, previous, commands, probes } = runDeploy(true, true);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.notEqual(activeRelease, previous);
  assert.doesNotMatch(commands, /npm /);
  assert.match(probes, /\/api\/health[\s\S]*\/api\/ready/);
});

test('prebuilt release with unavailable database rolls back', () => {
  const { result, activeRelease, previous, commands } = runDeploy(false, true);
  assert.notEqual(result.status, 0);
  assert.equal(activeRelease, previous);
  assert.doesNotMatch(commands, /npm /);
});

test('wrong artifact checksum refuses deployment before replacing the service', () => {
  const { result, activeRelease, previous, commands } = runDeploy(true, true, false);
  assert.notEqual(result.status, 0);
  assert.equal(activeRelease, previous);
  assert.doesNotMatch(commands, /pm2 /);
});

test('prebuilt archive does not make the release directory accessible to other users', () => {
  const { result, releaseMode } = runDeploy(true, true);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(releaseMode, 0o700);
});
