const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const configuration = '/etc/blizhniy/web-runtime.json';
const interpreter = '/opt/blizhniy-node22/bin/node';
const unavailable = () => new Error('Web runtime unavailable');
function optionalStat(name) {
  try { return fs.lstatSync(name); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function rootDirectory(name, readable = false) {
  const info = fs.lstatSync(name);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== 0 || (info.mode & 0o022) || fs.realpathSync(name) !== name ||
      (readable && (info.mode & 0o005) !== 0o005)) throw unavailable();
}
function getWebRuntime() {
  let fd;
  try {
    try { fd = fs.openSync(configuration, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (process.getuid() !== 0) throw unavailable();
    rootDirectory('/etc'); rootDirectory('/etc/blizhniy');
    const info = fs.fstatSync(fd);
    if (!info.isFile() || info.uid !== 0 || (info.mode & 0o7777) !== 0o600 || info.nlink !== 1 || info.size > 1024) throw unavailable();
    const value = JSON.parse(fs.readFileSync(fd, 'utf8'));
    if (!value || Object.keys(value).length !== 3 || value.version !== 1 || value.user !== 'blizhniy-web' || value.nodePath !== interpreter) throw unavailable();
    for (const name of ['/opt', '/opt/blizhniy-node22', '/opt/blizhniy-node22/bin']) rootDirectory(name, true);
    const node = fs.lstatSync(interpreter);
    if (!node.isFile() || node.isSymbolicLink() || node.uid !== 0 || (node.mode & 0o022) || !(node.mode & 0o001)) throw unavailable();
    const options = { encoding: 'utf8', timeout: 3000, maxBuffer: 128, shell: false, env: { PATH: '/usr/bin:/bin', LANG: 'C' } };
    if (!/^v22\.(?:1[89]|[2-9]\d)\.\d+\n?$/.test(execFileSync(interpreter, ['--version'], options))) throw unavailable();
    const uid = Number(execFileSync('/usr/bin/id', ['-u', 'blizhniy-web'], options).trim());
    const gid = Number(execFileSync('/usr/bin/id', ['-g', 'blizhniy-web'], options).trim());
    if (![uid, gid].every(id => Number.isSafeInteger(id) && id >= 100 && id < 1000)) throw unavailable();
    const home = fs.lstatSync('/var/lib/blizhniy-web');
    if (!home.isDirectory() || home.isSymbolicLink() || home.uid !== uid || home.gid !== gid || (home.mode & 0o7777) !== 0o700) throw unavailable();
    return { uid, gid, interpreter };
  } catch { throw unavailable(); }
  finally { if (fd !== undefined) { try { fs.closeSync(fd); } catch { throw unavailable(); } } }
}
function prepareWebRelease(release) {
  try {
    const runtime = getWebRuntime(); if (!runtime) return;
    if (typeof release !== 'string' || !/^\/var\/www\/blizhniy-releases\/20\d{12}-[a-f0-9]{12}$/.test(release)) throw unavailable();
    for (const name of ['/var', '/var/www', '/var/www/blizhniy-releases', release, path.join(release, '.next')]) rootDirectory(name, true);
    const envFiles = ['.env', '.env.local', '.env.production', '.env.production.local'].map(name => path.join(release, name));
    for (const name of envFiles) {
      const info = optionalStat(name); if (!info) continue;
      if (!info.isFile() || info.isSymbolicLink() || info.uid !== 0 || info.nlink !== 1 ||
          !((info.mode & 0o7777) === 0o600 || ((info.mode & 0o7777) === 0o640 && info.gid === runtime.gid))) throw unavailable();
    }
    const cache = path.join(release, '.next/cache'), preserved = path.join(release, '.next/build-cache');
    const info = optionalStat(cache);
    if (info && (!info.isDirectory() || info.isSymbolicLink() ||
        !(info.uid === 0 || (info.uid === runtime.uid && info.gid === runtime.gid && (info.mode & 0o7777) === 0o700)))) throw unavailable();
    if (info?.uid === 0 && optionalStat(preserved)) throw unavailable();
    // No recursive chown/chmod and no deletion: application cannot modify the root-owned code tree.
    for (const name of envFiles) if (optionalStat(name)) { fs.chownSync(name, 0, runtime.gid); fs.chmodSync(name, 0o640); }
    if (info?.uid === 0) fs.renameSync(cache, preserved);
    if (!info || info.uid === 0) { fs.mkdirSync(cache, { mode: 0o700 }); fs.chownSync(cache, runtime.uid, runtime.gid); }
  } catch { throw unavailable(); }
}
module.exports = { getWebRuntime, prepareWebRelease };
if (require.main === module) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--prepare') throw unavailable();
    prepareWebRelease(process.argv[3]); process.stdout.write('web runtime: permissions ready\n');
  } catch { process.stderr.write('Web runtime unavailable\n'); process.exitCode = 1; }
}
