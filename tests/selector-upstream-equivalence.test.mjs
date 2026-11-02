import assert from 'node:assert/strict';
import {createHash, createPublicKey, verify} from 'node:crypto';
import {readFileSync, readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const certificate = JSON.parse(readFileSync(join(root, 'docs/selector-upstream-6.1.5.json')));
const require = createRequire(import.meta.url);
const installed = dirname(dirname(require.resolve('postcss-selector-parser')));
const vendor = join(root, 'vendor/postcss-selector-parser');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function insertOnce(source, anchor, insertion) {
  assert.equal(source.split(anchor).length, 2, 'Expected one exact upstream insertion site');
  return source.replace(anchor, insertion + anchor);
}

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

for (const [label, directory] of [['vendored', vendor], ['installed', installed]]) {
  test(`${label} selector executable files equal official 6.1.5, with only two exact comments restored`, () => {
    const entries = readdirSync(directory, {recursive: true, withFileTypes: true});
    assert.ok(entries.every(entry => entry.isDirectory() || entry.isFile()), 'No symlink or special-file bypass');
    const inventory = entries
      .filter(entry => entry.isFile())
      .map(entry => join(entry.parentPath, entry.name).slice(directory.length + 1))
      .filter(file => file !== 'SECURITY-PROVENANCE.json').sort();
    assert.deepEqual(inventory, Object.keys(certificate.files).sort());
    assert.equal(inventory.length, 37);
    for (const file of inventory) {
      if (file === 'CHANGELOG.md' || file === 'package.json') continue;
      let bytes = readFileSync(join(directory, file));
      if (file === 'dist/parser.js') {
        let source = bytes.toString('utf8');
        source = insertOnce(source, '  return Array.from(new Set(Array.prototype.concat.apply([], arguments)));',
          '  // A Set keeps the first-occurrence order the previous filter/indexOf pass\n  // produced, without its quadratic cost on long index lists.\n');
        source = insertOnce(source, '    var classIndexes = new Set(hasClass);',
          '    // Membership tests are built once. Scanning the arrays per index would\n    // make a flat selector such as `.a.a.a...` quadratic in its number of\n    // class/id indexes, which is enough to pin a CPU core on\n    // attacker-supplied input.\n');
        bytes = Buffer.from(source);
      }
      assert.equal(hash(bytes), certificate.files[file], `${label} ${file}`);
    }
  });

  test(`${label} selector manifest differs from official only by version and absent prepare hook`, () => {
    const source = readFileSync(join(directory, 'package.json'), 'utf8');
    const manifest = JSON.parse(source);
    assert.equal(manifest.version, '6.1.4');
    assert.equal(manifest.scripts.prepare, undefined);
    const restored = insertOnce(source.replace('"version": "6.1.4"', '"version": "6.1.5"'),
      '    "lintfix":',
      '    "prepare": "del-cli dist && BABEL_ENV=publish babel src --out-dir dist --ignore /__tests__/",\n');
    assert.equal(hash(restored), certificate.files['package.json']);
  });
}
