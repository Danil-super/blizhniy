import assert from 'node:assert/strict';
import {createHash, createPublicKey, verify} from 'node:crypto';
import {lstatSync, readFileSync, readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const certificate = JSON.parse(readFileSync(join(root, 'docs/selector-upstream-6.1.5.json')));
const require = createRequire(import.meta.url);
const installed = dirname(dirname(require.resolve('postcss-selector-parser')));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('official selector certificate pins registry-signed 6.1.5 integrity', () => {
  assert.equal(certificate.package, 'postcss-selector-parser');
  assert.equal(certificate.version, '6.1.5');
  assert.equal(certificate.gitHead, 'd90b6e38a0c79d07b02bf0d602bc242fe94be6b9');
  assert.equal(certificate.integrity, 'sha512-TEHFzb5KRDKaOgJ4TYE+0jyJtFbjLvkdVOu0fZ2b6MTWzoqZd4Le+61aEppWkvTlYePgOX4ATL1wsAIPMLTw6Q==');
  assert.equal(certificate.tarballSha256, '051db69e7aad989abddc95fef96f19f1da68ef6890ff834d0c40a7fb48b9751d');
  assert.equal(hash(JSON.stringify(certificate.files)), '6034cb20cc35c6abf5e44ad7af707518e0aaebfacebb8301b3f2582e918f55a0');
  const {key, signature} = certificate.registrySignature;
  assert.equal(signature.keyid, key.keyid);
  assert.equal(key.keyid, 'SHA256:DhQ8wR5APBvFHLF/+Tc+AYvPOdTpcIDqOhxsBHRwC7U');
  const publicKey = createPublicKey(`-----BEGIN PUBLIC KEY-----\n${key.key}\n-----END PUBLIC KEY-----`);
  // Registry key IDs use the registry's identity scheme, not SPKI DER hashes.
  assert.equal(hash(publicKey.export({format: 'der', type: 'spki'})), 'fb190a462123443500cbcdb6519623e7179e9f38d84ad4e9362b72d2b68b62c1');
  assert.equal(verify('sha256', Buffer.from(`${certificate.package}@${certificate.version}:${certificate.integrity}`), publicKey, Buffer.from(signature.sig, 'base64')), true);
});

test('the installed selector package contains exactly the signed release files', () => {
  assert.equal(installed, join(root, 'node_modules', 'postcss-selector-parser'));
  assert.ok(lstatSync(installed).isDirectory(), 'The package must be installed as a directory');
  const entries = readdirSync(installed, {recursive: true, withFileTypes: true});
  assert.ok(entries.every(entry => entry.isDirectory() || entry.isFile()), 'No symlink or special file');
  const inventory = entries.filter(entry => entry.isFile())
    .map(entry => join(entry.parentPath, entry.name).slice(installed.length + 1)).sort();
  assert.equal(inventory.length, 37);
  assert.deepEqual(inventory, Object.keys(certificate.files).sort());
  for (const file of inventory) {
    assert.equal(hash(readFileSync(join(installed, file))), certificate.files[file], file);
  }
});
