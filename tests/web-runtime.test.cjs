const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { test } = require('node:test');
const config = '/etc/blizhniy/web-runtime.json';
const binary = '/opt/blizhniy-node22/bin/node';
const release = '/var/www/blizhniy-releases/20261015050000-aaaaaaaaaaaa';
const entry = (directory, uid = 0, gid = 0, mode = directory ? 0o755 : 0o600) => ({ uid, gid, mode, nlink: 1, size: 100,
  isDirectory: () => directory, isFile: () => !directory, isSymbolicLink: () => false });
function fixture() {
  const entries = new Map();
  for (const p of ['/etc', '/etc/blizhniy', '/opt', '/opt/blizhniy-node22', '/opt/blizhniy-node22/bin', '/var', '/var/www', '/var/www/blizhniy-releases', release, release + '/.next']) entries.set(p, entry(true));
  entries.set(config, entry(false)); entries.set(binary, entry(false, 0, 0, 0o755));
  entries.set('/var/lib/blizhniy-web', entry(true, 994, 985, 0o700));
  entries.set(release + '/.env.local', entry(false)); entries.set(release + '/.next/cache', entry(true));
  const changes = [], state = { body: JSON.stringify({ version: 1, user: 'blizhniy-web', nodePath: binary }), uid: 994, gid: 985, version: 'v22.23.3\n', caller: 0 };
  const stat = p => { if (!entries.has(p)) throw Object.assign(new Error('Synthetic private filesystem detail'), { code: 'ENOENT' }); return entries.get(p); };
  const fake = { constants: fs.constants, openSync: (p, flags) => { assert.equal(p, config); assert.ok(flags & fs.constants.O_NOFOLLOW); stat(p); return 7; }, closeSync: fd => assert.equal(fd, 7),
    fstatSync: () => stat(config), readFileSync: () => state.body, lstatSync: stat, realpathSync: p => p,
    renameSync: (from, to) => { changes.push(['rename', from, to]); entries.set(to, stat(from)); entries.delete(from); },
    mkdirSync: (p, options) => { changes.push(['mkdir', p]); entries.set(p, entry(true, 0, 0, options.mode)); },
    chownSync: (p, uid, gid) => { changes.push(['chown', p, uid, gid]); Object.assign(stat(p), { uid, gid }); },
    chmodSync: (p, mode) => { changes.push(['chmod', p, mode]); stat(p).mode = mode; } };
  const deps = { 'node:fs': fake, 'node:path': path, 'node:child_process': { execFileSync: (command, args, options) => {
    assert.equal(options.shell, false); assert.ok(options.timeout <= 3000);
    if (command === binary) { assert.deepEqual(Array.from(args), ['--version']); return state.version; }
    assert.equal(command, '/usr/bin/id'); assert.equal(args[1], 'blizhniy-web'); return String(args[0] === '-u' ? state.uid : state.gid);
  } } };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync('scripts/web-runtime.cjs', 'utf8'), { module, exports: module.exports, process: { getuid: () => state.caller, argv: [] },
    require: name => { if (!(name in deps)) throw new Error('Unexpected runtime import'); return deps[name]; } });
  return { ...module.exports, entries, changes, state };
}
const denied = action => assert.throws(action, error => error.message === 'Web runtime unavailable' && !error.cause);
test('missing operator configuration preserves the existing runtime without file mutations', () => {
  const app = fixture(); app.entries.delete(config); assert.equal(app.getWebRuntime(), null); app.prepareWebRelease(release); assert.deepEqual(app.changes, []);
});
test('operator-pinned Node22 and dedicated UID/GID are returned without private configuration fields', () => {
  const app = fixture(); assert.deepEqual({ ...app.getWebRuntime() }, { uid: 994, gid: 985, interpreter: binary });
});
test('malformed, widened or non-root configuration fails closed instead of silently restoring root', () => {
  for (const change of [a => a.state.body = '{', a => a.state.body = JSON.stringify({ version: 1, user: 'root', nodePath: binary }),
    a => a.entries.get(config).mode = 0o644, a => a.entries.get(config).uid = 994, a => a.entries.get(config).nlink = 2,
    a => a.entries.get('/etc/blizhniy').mode = 0o777, a => a.state.caller = 994, a => a.state.uid = 0,
    a => a.state.version = 'v20.20.2\n', a => a.entries.get(binary).mode = 0o777,
    a => a.entries.get('/opt/blizhniy-node22/bin').uid = 1000, a => a.entries.get(binary).uid = 1000]) {
    const app = fixture(); change(app); denied(() => app.getWebRuntime()); assert.deepEqual(app.changes, []);
  }
});
test('release preparation preserves env bytes, keeps code root-owned and replaces only the build cache directory', () => {
  const app = fixture(); app.prepareWebRelease(release);
  assert.equal(app.entries.get(release + '/.env.local').uid, 0); assert.equal(app.entries.get(release + '/.env.local').gid, 985);
  assert.equal(app.entries.get(release + '/.env.local').mode, 0o640); assert.equal(app.entries.get(release).uid, 0);
  assert.equal(app.entries.get(release + '/.next/cache').uid, 994); assert.equal(app.entries.get(release + '/.next/cache').mode, 0o700);
  assert.equal(app.entries.get(release + '/.next/build-cache').uid, 0);
  const count = app.changes.length; app.prepareWebRelease(release); assert.equal(app.changes.filter(c => c[0] === 'rename').length, 1); assert.ok(app.changes.length >= count);
});
test('foreign release roots, symlinks, shared cache and widened env permissions are rejected before mutation', () => {
  for (const change of [a => a.entries.get(release).uid = 994, a => a.entries.get(release).mode = 0o700,
    a => a.entries.get(release + '/.env.local').isSymbolicLink = () => true,
    a => a.entries.get(release + '/.env.local').mode = 0o644, a => a.entries.get(release + '/.next/cache').uid = 995]) {
    const app = fixture(); change(app); denied(() => app.prepareWebRelease(release)); assert.deepEqual(app.changes, []);
  }
  const app = fixture(); denied(() => app.prepareWebRelease('/var/www')); assert.deepEqual(app.changes, []);
});
test('PM2 declares managed UID and interpreter; deployment prepares permissions before replacing the service', () => {
  const source = fs.readFileSync('ecosystem.config.cjs', 'utf8'), script = fs.readFileSync('scripts/deploy-release.sh', 'utf8');
  assert.match(source, /getWebRuntime/); assert.match(source, /\.\.\.webRuntime/);
  assert.ok(script.indexOf('scripts/web-runtime.cjs') > script.indexOf('npm --prefix "$RELEASE_DIR" run build'));
  assert.ok(script.indexOf('scripts/web-runtime.cjs') < script.indexOf('SERVICE_REPLACED=true'));
  for (const runtime of [null, { uid: 994, gid: 985, interpreter: binary }]) {
    const module = { exports: {} };
    vm.runInNewContext(source, { __dirname: release, module, process: { execPath: '/usr/bin/node', env: {} }, require: name => {
      if (name === 'node:fs') return { existsSync: () => false };
      assert.equal(name, './scripts/web-runtime.cjs'); return { getWebRuntime: () => runtime };
    } });
    const app = module.exports.apps[0];
    assert.equal(app.name, 'blizhniy'); assert.equal(app.interpreter, runtime?.interpreter ?? '/usr/bin/node');
    assert.equal(app.uid, runtime?.uid); assert.equal(app.gid, runtime?.gid); assert.equal(app.instances, 1);
    assert.equal(app.env.NODE_ENV, 'production'); assert.equal(app.env.PORT, '3000');
  }
});
