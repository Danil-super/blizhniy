import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createConnection, createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir, userInfo } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const helper = path.resolve('scripts/setup-deployment-ssh.sh');
const pin = path.resolve('deploy/vps-host-key.pub');
const expectedPin = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMICT9w6GySK/JP73zZtwXTYwlbOalkgwJhj2KJF/73o';
const temporary = prefix => mkdtempSync(path.join(tmpdir(), prefix));
const run = (cmd, args, env = {}) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 15000, env: { ...process.env, ...env } });
const setup = (host, port, dir, key = pin, env = {}) => run('bash', [helper, host, String(port), dir, key], { VPS_USER: 'fixture-user', ...env });

function policy(args) {
  const result = run('/usr/bin/ssh', ['-G', ...args]);
  assert.equal(result.status, 0, result.stderr);
  return Object.fromEntries(result.stdout.trim().split('\n').map(line => { const at = line.indexOf(' '); return [line.slice(0, at), line.slice(at + 1)]; }));
}
function assertPolicy(config, dir) {
  assert.equal(config.stricthostkeychecking, 'true');
  assert.equal(config.userknownhostsfile, path.join(dir, 'known_hosts'));
  assert.equal(config.globalknownhostsfile, '/dev/null');
  // OpenSSH omits KnownHostsCommand from -G output when it is disabled.
  assert.ok(config.knownhostscommand === undefined || config.knownhostscommand === 'none');
  assert.equal(config.updatehostkeys, 'false');
  assert.equal(config.verifyhostkeydns, 'false');
  assert.equal(config.hostkeyalgorithms, 'ssh-ed25519');
  assert.equal(config.batchmode, 'yes');
  assert.equal(config.identitiesonly, 'yes');
  assert.equal(config.identityagent, 'none');
}

test('deployment pins the independently verified VPS public key exactly', () => {
  assert.equal(readFileSync(pin, 'utf8').trim(), expectedPin);
  const validation = run('ssh-keygen', ['-l', '-f', pin]);
  assert.equal(validation.status, 0, validation.stderr);
});

test('setup binds the pin to the configured host and port with restrictive files and effective OpenSSH policy', () => {
  const root = temporary('ssh-pin-binding-');
  try {
    for (const port of [22, 2222]) {
      const dir = path.join(root, `trust-${port}`);
      const result = setup('deploy.example.test', port, dir);
      assert.equal(result.status, 0, result.stderr);
      const lookup = port === 22 ? 'deploy.example.test' : `[deploy.example.test]:${port}`;
      assert.equal(readFileSync(path.join(dir, 'known_hosts'), 'utf8'), `${lookup} ${expectedPin}\n`);
      assert.equal(statSync(dir).mode & 0o777, 0o700);
      for (const file of ['known_hosts', 'ssh_config']) assert.equal(statSync(path.join(dir, file)).mode & 0o777, 0o600);
      const found = run('ssh-keygen', ['-F', lookup, '-f', path.join(dir, 'known_hosts')]);
      assert.equal(found.status, 0, found.stderr);
      assertPolicy(policy(['-F', path.join(dir, 'ssh_config'), '-p', String(port), 'fixture-user@deploy.example.test']), dir);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('setup rejects malformed host, port, user and public key before creating trust files', () => {
  const root = temporary('ssh-pin-input-');
  try {
    const invalid = [
      ['', 22, {}], ['-oProxyCommand=anything', 22, {}], ['host\nHost *', 22, {}], ['host,other', 22, {}], ['user@host', 22, {}],
      ['host', 0, {}], ['host', 65536, {}], ['host', '22\nStrictHostKeyChecking no', {}], ['host', '0022', {}],
      ['host', 22, { VPS_USER: '-oProxyCommand=x' }], ['host', 22, { VPS_USER: '' }],
    ];
    for (const [index, [host, port, env]] of invalid.entries()) {
      const dir = path.join(root, `invalid-${index}`);
      const result = setup(host, port, dir, pin, env);
      assert.equal(result.status, 1, result.stderr);
      assert.equal(existsSync(dir), false);
    }
    const broken = path.join(root, 'broken.pub');
    writeFileSync(broken, 'ssh-ed25519 not-an-ed25519-key\n');
    const dir = path.join(root, 'broken-trust');
    assert.equal(setup('host', 22, dir, broken).status, 1);
    assert.equal(existsSync(dir), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('setup never discovers keys over the network or adds a second supplied key', () => {
  const root = temporary('ssh-pin-no-discovery-');
  try {
    const bin = path.join(root, 'bin'); mkdirSync(bin);
    const marker = path.join(root, 'keyscan-called');
    writeFileSync(path.join(bin, 'ssh-keyscan'), '#!/bin/bash\ntouch "$KEYSCAN_MARKER"\nexit 99\n', { mode: 0o755 });
    const result = setup('217.149.30.35', 22, path.join(root, 'trust'), pin, { PATH: `${bin}:${process.env.PATH}`, KEYSCAN_MARKER: marker });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(marker), false);
    const multiple = path.join(root, 'multiple.pub'); writeFileSync(multiple, `${expectedPin}\n${expectedPin}\n`);
    assert.equal(setup('host', 22, path.join(root, 'multiple'), multiple).status, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function workflow(name) { return yaml.load(readFileSync(`.github/workflows/${name}.yml`, 'utf8')); }

function ciPrerequisiteStep() {
  const steps = workflow('ci').jobs.validate.steps;
  const index = steps.findIndex(step => step.name === 'Prepare OpenSSH regression prerequisites');
  assert.ok(index >= 0, 'CI must prepare the actual OpenSSH test prerequisites');
  assert.ok(index < steps.findIndex(step => step.name === 'Run application and security regression tests'));
  assert.equal(steps[index]['continue-on-error'], undefined);
  assert.equal(steps[index].if, undefined);
  return steps[index];
}

function ciPrerequisiteFixture({ missing = '', previousPolicy, installation = 'success' } = {}) {
  const root = temporary('ssh-ci-prerequisite-');
  const bin = path.join(root, 'bin'); mkdirSync(bin);
  const policyFile = path.join(root, 'policy-rc.d');
  if (previousPolicy) writeFileSync(policyFile, previousPolicy, { mode: 0o640 });
  const sudo = `#!${process.execPath}
const fs = require('node:fs'); const cp = require('node:child_process'); const path = require('node:path');
const root = process.env.CI_FIXTURE_ROOT; const args = process.argv.slice(2);
fs.appendFileSync(path.join(root, 'sudo-calls.jsonl'), JSON.stringify(args)+'\\n');
function fixturePath(value) {
  if (value === '/usr/sbin/policy-rc.d') return path.join(root, 'policy-rc.d');
  if (value === '/run/sshd') return path.join(root, 'run-sshd');
  if (!value.startsWith(root + '/')) throw new Error('Refusing non-fixture path: '+value);
  return value;
}
if(args[0] === 'test') {
  const file = fixturePath(args[2]);
  if(args[1] === '-e') process.exit(fs.existsSync(file) ? 0 : 1);
  if(args[1] === '-L') { try { process.exit(fs.lstatSync(file).isSymbolicLink() ? 0 : 1); } catch { process.exit(1); } }
} else if(args[0] === 'mv' && args[1] === '--') {
  fs.renameSync(fixturePath(args[2]), fixturePath(args[3])); process.exit(0);
} else if(args[0] === 'rm' && args[1] === '-f' && args[2] === '--') {
  fs.rmSync(fixturePath(args[3]), { force: true }); process.exit(0);
} else if(args[0] === 'install' && args[1] === '-d' && args[2] === '-m' && args[3] === '0755') {
  const target = fixturePath(args[4]); fs.mkdirSync(target, { recursive: true }); fs.chmodSync(target, 0o755); process.exit(0);
} else if(args[0] === 'install' && args[1] === '-m' && args[2] === '0755') {
  const target = fixturePath(args[4]); fs.copyFileSync(fixturePath(args[3]), target); fs.chmodSync(target, 0o755); process.exit(0);
} else {
  const aptArgs = args[0] === 'env' ? args.slice(2) : args;
  if(aptArgs[0] === 'apt-get') {
    if(args[0] === 'env' && args[1] !== 'DEBIAN_FRONTEND=noninteractive') throw new Error('Install must be noninteractive');
    const policy = cp.spawnSync('/bin/sh', [path.join(root, 'policy-rc.d')]);
    if(policy.status !== 101) throw new Error('Package service startup was not denied');
    if(aptArgs.includes('install')) {
      if(!['openssh-client', 'openssh-server', '--no-install-recommends'].every(arg => aptArgs.includes(arg))) throw new Error('Missing narrow OpenSSH packages');
      if(process.env.CI_FIXTURE_INSTALLATION === 'error') process.exit(42);
      if(process.env.CI_FIXTURE_INSTALLATION !== 'still-missing') fs.writeFileSync(path.join(root, 'installed'), 'synthetic installation');
    }
    process.exit(0);
  }
}
throw new Error('Refusing unexpected sudo operation: '+JSON.stringify(args));
`;
  writeFileSync(path.join(bin, 'sudo'), sudo, { mode: 0o755 });
  const prelude = `
command() {
  if [[ "$1" == -v && ( "$2" == ssh || "$2" == ssh-keygen ) ]]; then
    [[ -f "$CI_FIXTURE_ROOT/installed" || "$CI_FIXTURE_MISSING" != "$2" ]]
  else
    builtin command "$@"
  fi
}
test() {
  if [[ "$1" == -x && "$2" == /usr/sbin/sshd ]]; then
    [[ -f "$CI_FIXTURE_ROOT/installed" || "$CI_FIXTURE_MISSING" != sshd ]]
  elif [[ "$1" == -d && "$2" == /run/sshd ]]; then
    builtin test -d "$CI_FIXTURE_ROOT/run-sshd"
  else
    builtin test "$@"
  fi
}
`;
  return {
    root, policyFile,
    execute: step => run('bash', ['-c', prelude + step.run], { PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: root, CI_FIXTURE_ROOT: root, CI_FIXTURE_MISSING: missing, CI_FIXTURE_INSTALLATION: installation }),
    calls: () => readFileSync(path.join(root, 'sudo-calls.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('CI prepares OpenSSH before regressions without package installation when all tools exist', () => {
  const step = ciPrerequisiteStep(); const fixture = ciPrerequisiteFixture();
  try {
    const result = fixture.execute(step); assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(fixture.calls(), [['install', '-d', '-m', '0755', '/run/sshd']]);
    assert.equal(statSync(path.join(fixture.root, 'run-sshd')).mode & 0o777, 0o755);
  } finally { fixture.cleanup(); }
});

test('CI installs missing OpenSSH tools with service startup denied and restores previous policy', () => {
  const step = ciPrerequisiteStep();
  for (const missing of ['ssh', 'ssh-keygen', 'sshd']) {
    for (const previousPolicy of [undefined, '#!/bin/sh\n# existing runner policy\nexit 0\n']) {
      const fixture = ciPrerequisiteFixture({ missing, previousPolicy });
      try {
        const result = fixture.execute(step); assert.equal(result.status, 0, result.stderr);
        assert.ok(existsSync(path.join(fixture.root, 'installed')));
        assert.ok(existsSync(path.join(fixture.root, 'run-sshd')));
        assert.equal(existsSync(fixture.policyFile), Boolean(previousPolicy));
        if (previousPolicy) {
          assert.equal(readFileSync(fixture.policyFile, 'utf8'), previousPolicy);
          assert.equal(statSync(fixture.policyFile).mode & 0o777, 0o640);
        }
        assert.equal(fixture.calls().filter(args => args.includes('apt-get')).length, 2);
      } finally { fixture.cleanup(); }
    }
  }
});

test('CI fails closed and restores service policy when installation fails or prerequisites stay missing', () => {
  const step = ciPrerequisiteStep(); const previousPolicy = '#!/bin/sh\nexit 0\n';
  for (const installation of ['error', 'still-missing']) {
    const fixture = ciPrerequisiteFixture({ missing: 'sshd', previousPolicy, installation });
    try {
      const result = fixture.execute(step);
      assert.equal(result.status, installation === 'error' ? 42 : 1, result.stderr);
      assert.equal(readFileSync(fixture.policyFile, 'utf8'), previousPolicy);
      assert.equal(existsSync(path.join(fixture.root, 'installed')), false);
    } finally { fixture.cleanup(); }
  }
});

function workflowFixture(root) {
  const bin = path.join(root, 'bin'); mkdirSync(bin);
  const log = path.join(root, 'calls.jsonl');
  const spy = `#!${process.execPath}
const fs = require('node:fs'); const cp = require('node:child_process'); const path = require('node:path');
const tool = path.basename(process.argv[1]); const args = process.argv.slice(2); let sshArgs = args;
if (tool === 'scp') {
  sshArgs = []; let i = 0;
  while (i < args.length && args[i].startsWith('-')) {
    const option = args[i++]; const value = args[i++]; sshArgs.push(option === '-P' ? '-p' : option, value);
  }
  sshArgs.push(args.at(-1).split(':')[0]);
}
const p = cp.spawnSync('/usr/bin/ssh', ['-G', ...sshArgs], { encoding: 'utf8' });
const policy = Object.fromEntries(p.stdout.trim().split('\\n').map(line => { const at=line.indexOf(' '); return [line.slice(0,at),line.slice(at+1)]; }));
fs.appendFileSync(process.env.SSH_CALL_LOG, JSON.stringify({tool,args,status:p.status,policy})+'\\n');
if(p.status !== 0){process.stderr.write(p.stderr);process.exit(p.status||1);}
const command=args.at(-1);
if(command.includes('test -f') && process.env.SSH_SCENARIO === 'timeout')process.exit(1);
if(command.includes('cat ') && command.includes('.status')) process.stdout.write('0\\n');
if(command.includes('cat ') && command.includes('.result')) process.stdout.write(process.env.SSH_SCENARIO === 'rollback' ? 'rolled_back\\n' : 'confirmed\\n');
`;
  for (const tool of ['ssh', 'scp']) writeFileSync(path.join(bin, tool), spy, { mode: 0o755 });
  for (const tool of ['tar', 'du', 'sleep', 'openssl']) writeFileSync(path.join(bin, tool), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
  writeFileSync(path.join(bin, 'ssh-keyscan'), '#!/bin/bash\necho "Untrusted network discovery attempted" >&2\nexit 99\n', { mode: 0o755 });
  return { bin, log };
}

test('parsed deployment and TLS workflow paths use the effective pinned policy for ship, SCP, confirmation, rollback and journal', () => {
  const root = temporary('ssh-workflow-policy-');
  try {
    const deploy = workflow('deploy'); const tls = workflow('tls-renewal');
    const ship = deploy.jobs.deploy.steps.find(step => step.id === 'ship');
    const configure = tls.jobs.renew.steps.find(step => step.name === 'Configure SSH access');
    assert.ok(ship.run.includes('scripts/setup-deployment-ssh.sh'), 'ship must establish repository-pinned trust');
    assert.ok(configure.run.includes('scripts/setup-deployment-ssh.sh'), 'TLS must establish repository-pinned trust');
    assert.match(tls.jobs.renew.steps[0].uses, /^actions\/checkout@[0-9a-f]{40}$/);
    const { bin, log } = workflowFixture(root);
    const env = { PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: root, SSH_CALL_LOG: log, VPS_HOST: '217.149.30.35', VPS_PORT: '2222', VPS_USER: 'fixture-user', VPS_SSH_KEY: 'synthetic-client-key-only', APP_DIR: '/synthetic-app', GITHUB_RUN_ID: '12345', GITHUB_RUN_ATTEMPT: '1' };
    const execute = (step, scenario = 'confirmed') => {
      const code = step.run.replace(/\$\{\{\s*github\.run_id\s*\}\}/g, '12345').replace(/\$\{\{\s*github\.run_attempt\s*\}\}/g, '1').replace(/\$\{\{\s*github\.sha\s*\}\}/g, 'a'.repeat(40));
      return run('bash', ['-c', code], { ...env, SSH_SCENARIO: scenario });
    };
    assert.equal(execute(ship).status, 0);
    assert.equal(execute(ship, 'timeout').status, 124);
    assert.equal(execute(deploy.jobs.deploy.steps.find(step => step.name === 'Confirm deployed release')).status, 0);
    assert.equal(execute(deploy.jobs.deploy.steps.find(step => step.name === 'Roll back release if a deployed check failed'), 'rollback').status, 0);
    assert.equal(execute(configure).status, 0);
    assert.equal(execute(tls.jobs.renew.steps.find(step => step.name === 'Enable Caddy automatic HTTPS')).status, 0);
    assert.equal(execute(tls.jobs.renew.steps.find(step => step.name === 'Verify the certificate served to visitors')).status, 1);
    const calls = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.ok(calls.filter(call => call.tool === 'scp').length >= 4);
    assert.ok(calls.some(call => call.args.at(-1).includes('.confirmed')));
    assert.ok(calls.some(call => call.args.at(-1).includes('.abort')));
    assert.ok(calls.some(call => call.args.at(-1).includes('journalctl')));
    for (const call of calls) {
      assert.equal(call.status, 0);
      assertPolicy(call.policy, path.join(root, 'blizhniy-ssh'));
      assert.equal(call.policy.port, '2222');
      assert.equal(call.policy.hostname, '217.149.30.35');
      assert.ok(call.args.includes('StrictHostKeyChecking=yes'), 'critical call must explicitly require strict checking');
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

async function reservePort() {
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
function syntheticKey(file) {
  const result = run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', file]); assert.equal(result.status, 0, result.stderr);
  const publicKey = readFileSync(`${file}.pub`, 'utf8').trim().split(/\s+/).slice(0, 2).join(' ');
  const pinFile = `${file}.pin.pub`; writeFileSync(pinFile, publicKey + '\n'); return pinFile;
}

test('loopback readiness observes a listening socket without binding the sshd-owned port', async () => {
  const ts = require('typescript');
  const { EventEmitter } = require('node:events');
  const source = readFileSync(new URL(import.meta.url), 'utf8');
  const ast = ts.createSourceFile('actual-ssh-test.mjs', source, ts.ScriptTarget.Latest, true);
  const actualTest = ast.statements.find(node => ts.isExpressionStatement(node)
    && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === 'test'
    && ts.isStringLiteral(node.expression.arguments[0])
    && node.expression.arguments[0].text.startsWith('real loopback OpenSSH'));
  assert.ok(actualTest, 'inspect the actual sshd test, not a copied readiness algorithm');
  let callback;
  const visit = node => {
    if (!callback && ts.isNewExpression(node) && node.expression.getText(ast) === 'Promise') callback = node.arguments[0];
    if (!callback) ts.forEachChild(node, visit);
  };
  visit(actualTest.expression.arguments[1]);
  assert.ok(callback, 'the actual startup callback must exist');
  let bindings = 0, connections = 0, destroyed = 0;
  await new Promise((resolve, reject) => {
    new Function('server', 'serverErrors', 'port', 'createServer', 'createConnection', 'setTimeout', 'resolve', 'reject',
      `(${callback.getText(ast)})(resolve, reject);`)(
      { exitCode: null }, '', 12345,
      () => { bindings += 1; assert.fail('A readiness probe must not compete with sshd for its listening port'); },
      options => {
        assert.deepEqual(options, { host: '127.0.0.1', port: 12345 });
        const socket = new EventEmitter();
        socket.setTimeout = () => socket;
        socket.destroy = () => { destroyed += 1; };
        const attempt = ++connections;
        queueMicrotask(() => attempt === 1
          ? socket.emit('error', Object.assign(new Error('Synthetic not-yet-listening'), { code: 'ECONNREFUSED' }))
          : socket.emit('connect'));
        return socket;
      }, setTimeout, resolve, reject,
    );
  });
  assert.equal(bindings, 0);
  assert.equal(connections, 2, 'refusal is retried, then a real client-connect event proves readiness');
  assert.equal(destroyed, 2, 'both short-lived probes release their socket');
});

test('real loopback OpenSSH accepts its pinned synthetic host and rejects a mismatching or missing key', async () => {
  const root = temporary('ssh-real-host-pin-'); let server;
  try {
    const host = path.join(root, 'host'); const hostPin = syntheticKey(host);
    const wrongPin = syntheticKey(path.join(root, 'wrong-host'));
    const client = path.join(root, 'client'); syntheticKey(client);
    const port = await reservePort(); const config = path.join(root, 'sshd_config');
    writeFileSync(config, `Port ${port}\nListenAddress 127.0.0.1\nHostKey ${host}\nPidFile ${root}/sshd.pid\nAuthorizedKeysFile ${client}.pub\nStrictModes no\nUsePAM no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nPubkeyAuthentication yes\nForceCommand echo pinned-host-accepted\nLogLevel ERROR\n`);
    server = spawn('/usr/sbin/sshd', ['-D', '-e', '-f', config], { stdio: ['ignore', 'ignore', 'pipe'] });
    let serverErrors = ''; server.stderr.on('data', chunk => { serverErrors += chunk.toString(); });
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 5000;
      const attempt = () => {
        if (server.exitCode !== null) return reject(new Error(serverErrors || 'loopback sshd exited'));
        // Observe sshd as a client. Binding a competing probe to this port can
        // make sshd itself fail with EADDRINUSE before its first listen.
        const probe = createConnection({ host: '127.0.0.1', port });
        let finished = false;
        const retry = error => {
          if (finished) return;
          finished = true; probe.destroy();
          if (server.exitCode !== null) return reject(new Error(serverErrors || 'loopback sshd exited'));
          if (error && !['ECONNREFUSED', 'ECONNRESET'].includes(error.code)) return reject(error);
          if (Date.now() > deadline) reject(new Error(serverErrors || 'loopback sshd startup timed out'));
          else setTimeout(attempt, 30);
        };
        probe.setTimeout(250);
        probe.once('error', retry);
        probe.once('timeout', () => retry());
        probe.once('connect', () => { if (!finished) { finished = true; probe.destroy(); resolve(); } });
      }; attempt();
    });
    const trust = path.join(root, 'trusted'); assert.equal(setup('127.0.0.1', port, trust, hostPin).status, 0);
    const connect = dir => run('/usr/bin/ssh', ['-F', path.join(dir, 'ssh_config'), '-o', 'ConnectTimeout=3', '-i', client, '-p', String(port), `${userInfo().username}@127.0.0.1`, 'true']);
    const accepted = connect(trust); assert.equal(accepted.status, 0, accepted.stderr + serverErrors); assert.match(accepted.stdout, /pinned-host-accepted/);
    const before = readFileSync(path.join(trust, 'known_hosts'), 'utf8');
    const wrong = path.join(root, 'wrong'); assert.equal(setup('127.0.0.1', port, wrong, wrongPin).status, 0);
    const mismatch = connect(wrong); assert.equal(mismatch.status, 255); assert.match(mismatch.stderr, /HOST IDENTIFICATION HAS CHANGED|Host key verification failed/);
    writeFileSync(path.join(wrong, 'known_hosts'), '');
    const missing = connect(wrong); assert.equal(missing.status, 255); assert.match(missing.stderr, /Host key verification failed/);
    assert.equal(readFileSync(path.join(wrong, 'known_hosts'), 'utf8'), '', 'unknown key must not be learned');
    assert.equal(readFileSync(path.join(trust, 'known_hosts'), 'utf8'), before);
  } finally {
    if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
    rmSync(root, { recursive: true, force: true });
  }
});
