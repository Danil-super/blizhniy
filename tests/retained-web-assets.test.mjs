import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {retainWebAssets} from '../scripts/retain-web-assets.mjs';

test('publishes both verified static directories before a switch and keeps the pair on a collision', t => {
  const parent = mkdtempSync(join(tmpdir(), 'retained-assets-'));
  t.after(() => rmSync(parent, {recursive: true, force: true}));
  const directory = join(parent, 'web-static');
  mkdirSync(directory, {mode: 0o755});
  const releases = ['blue', 'green'].map(name => {
    const release = join(parent, name);
    const root = join(release, '.next', 'static');
    mkdirSync(root, {recursive: true, mode: 0o755});
    writeFileSync(join(release, '.next', 'BUILD_ID'), name, {mode: 0o644});
    writeFileSync(join(root, name + '.js'), name, {mode: 0o644});
    writeFileSync(join(root, 'shared.js'), 'shared', {mode: 0o644});
    return release;
  });
  retainWebAssets(directory, '', releases[0]);
  assert.equal(readlinkSync(join(directory, 'running')), readlinkSync(join(directory, 'incoming')));
  retainWebAssets(directory, ...releases);
  assert.equal(readFileSync(join(directory, 'running/blue.js'), 'utf8'), 'blue');
  assert.equal(readFileSync(join(directory, 'incoming/green.js'), 'utf8'), 'green');
  retainWebAssets(directory, releases[1], releases[0]);
  const readPair = () => ['running', 'incoming'].map(key => readlinkSync(join(directory, key)));
  const pair = releases.map(r => join(r, '.next/static')).reverse();
  assert.deepEqual(readPair(), pair);
  writeFileSync(join(releases[1], '.next/static/shared.js'), 'changed');
  assert.throws(() => retainWebAssets(directory, ...releases), /collision/);
  assert.deepEqual(readPair(), pair);
  writeFileSync(join(releases[1], '.next/static/shared.js'), 'shared');
  rmSync(join(directory, 'incoming'));
  writeFileSync(join(directory, 'incoming'), 'existing file');
  assert.throws(() => retainWebAssets(directory, ...releases), /Unexpected static slot/);
  assert.equal(readlinkSync(join(directory, 'running')), pair[0]);
  assert.equal(readFileSync(join(directory, 'incoming'), 'utf8'), 'existing file');
  const alias = join(parent, 'alias');
  symlinkSync(directory, alias);
  assert.throws(() => retainWebAssets(alias, ...releases), /Untrusted/);
});

test('the Caddy route selects an incoming file before its unconditional running root', () => {
  const template = readFileSync(new URL('../deploy/Caddyfile.example', import.meta.url), 'utf8');
  assert.match(template, /root @incoming \/var\/www\/blizhniy-static\/incoming\s+root \* \/var\/www\/blizhniy-static\/running/);
});
