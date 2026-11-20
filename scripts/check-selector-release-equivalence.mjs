// Operator-run, offline reproduction of the recorded registry archive inventory.
// No installation, dependency lifecycle scripts, network or application writes.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash, createPublicKey, verify} from 'node:crypto';
import {closeSync, constants, fstatSync, openSync, readFileSync, readSync} from 'node:fs';

const certificate = JSON.parse(readFileSync(new URL('../docs/selector-upstream-6.1.5.json', import.meta.url)));
assert.equal(process.argv.length, 3, 'Pass the downloaded official 6.1.5 .tgz');
const descriptor = openSync(process.argv[2], constants.O_RDONLY | constants.O_NONBLOCK);
let archive;
try {
  const info = fstatSync(descriptor);
  assert.ok(info.isFile() && info.size > 0 && info.size < 1024 * 1024, 'Bounded regular archive required');
  // The extra byte detects growth while keeping the read within the archive size limit.
  const bytes = Buffer.alloc(info.size + 1);
  let offset = 0;
  while (offset < bytes.length) {
    const count = readSync(descriptor, bytes, offset, bytes.length - offset, null);
    if (count === 0) break;
    offset += count;
  }
  assert.equal(offset, info.size, 'Archive size changed during read');
  archive = bytes.subarray(0, offset);
} finally {
  closeSync(descriptor);
}
const digest = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);
assert.equal(digest(archive), certificate.tarballSha256);
assert.equal('sha512-' + digest(archive, 'sha512', 'base64'), certificate.integrity);
const {key, signature} = certificate.registrySignature;
const publicKey = createPublicKey(`-----BEGIN PUBLIC KEY-----\n${key.key}\n-----END PUBLIC KEY-----`);
assert.equal(verify('sha256', Buffer.from(`${certificate.package}@${certificate.version}:${certificate.integrity}`), publicKey, Buffer.from(signature.sig, 'base64')), true);

function tar(args) {
  const result = spawnSync('tar', args, {input: archive, timeout: 5000, maxBuffer: 1024 * 1024, env: {PATH: process.env.PATH, LANG: 'C'}});
  assert.equal(result.status, 0, 'Archive inspection failed');
  return result.stdout;
}
const entries = tar(['-tzf', '-']).toString('utf8').trimEnd().split('\n');
assert.deepEqual(entries.slice().sort(), Object.keys(certificate.files).map(path => `package/${path}`).sort());
for (const [path, expected] of Object.entries(certificate.files)) {
  assert.match(path, /^[a-zA-Z0-9._/-]+$/);
  assert.equal(path.split('/').includes('..'), false);
  assert.equal(digest(tar(['-xOzf', '-', '--', `package/${path}`])), expected, path);
}
console.log(`Official selector ${certificate.version}: registry signature, archive digests and all ${entries.length} files verified`);
