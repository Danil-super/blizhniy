import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const { loadLocalPrimaryModule: load } = createRequire(import.meta.url)('../scripts/local-primary-modules.cjs');
const { createAccountExportTrial, createApprovedAccountExport } = load('production-account-export-trial');
const origin = 'https://xn----9sbphbgks4a4a.xn--p1ai';
const owner = { id: '6d38cb19-e4fe-4895-be4f-8f49c2c08b83', email: 'test@blizhniy.invalid' };
const token = 'b'.repeat(64);
const archive = Buffer.from([0x1f, 0x8b, 0x08, 0, 0, 0]);
const request = (action, session = token, from = origin) => new Request(origin + '/api/account/export', {
  method: 'POST', headers: {
    host: new URL(origin).host, origin: from, 'x-blizhniy-request': '1',
    'content-type': 'application/json', 'x-real-ip': '127.0.0.1',
    cookie: session ? '__Host-blizhniy_session=' + session : '',
  }, body: JSON.stringify({ action }),
});

test('a reviewed TEST archive is exposed only to the current eligible owner for fifteen minutes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'account-export-trial-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await chmod(directory, 0o750);
  const file = join(directory, owner.id + '_' + createHash('sha256').update(owner.email).digest('hex') + '.tar.gz');
  let principal = owner;
  let allowed = true;
  const handle = createAccountExportTrial({ origin, directory, ownerId: owner.id, authorityUid: process.getuid(),
    resolve: async (presented) => presented === token ? principal : null, allow: async () => allowed });

  assert.deepEqual(await (await handle(request('available'))).json(), { available: false });
  await writeFile(file, archive, { mode: 0o440 });
  assert.equal((await handle(request('download', null))).status, 401);
  assert.equal((await handle(request('download', token, 'https://other.invalid'))).status, 403);
  assert.equal((await handle(request('download', 'c'.repeat(64)))).status, 401);
  allowed = false;
  assert.equal((await handle(request('download'))).status, 429);
  allowed = true;
  principal = { ...owner, id: '4b0abe09-9579-4039-95a0-87099126e493' };
  assert.equal((await handle(request('available'))).status, 404);
  principal = { ...owner, email: 'changed@blizhniy.invalid' };
  assert.equal((await handle(request('download'))).status, 404);
  principal = owner;
  assert.deepEqual(await (await handle(request('available'))).json(), { available: true });
  const downloaded = await handle(request('download'));
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.headers.get('cache-control'), 'private, no-store');
  assert.equal(downloaded.headers.get('content-disposition'), 'attachment; filename="blizhniy-account.tar.gz"');
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), archive);

  const expired = new Date(Date.now() - 16 * 60_000);
  await utimes(file, expired, expired);
  assert.deepEqual(await (await handle(request('available'))).json(), { available: false });
  assert.equal((await handle(request('download'))).status, 404);
  await rm(file);
  await symlink('/etc/passwd', file);
  assert.equal((await handle(request('download'))).status, 404);
});

test('approved cabinet archives are selected by the current account and verified email', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'account-export-approved-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await chmod(directory, 0o750);
  const second = { id: '4b0abe09-9579-4039-95a0-87099126e493', email: 'peer@blizhniy.invalid' };
  let principal = owner;
  const handle = createApprovedAccountExport({ origin, directory, authorityUid: process.getuid(),
    resolve: async (presented) => presented === token ? principal : null, allow: async () => true });
  const name = account => join(directory, account.id + '_' + createHash('sha256').update(account.email).digest('hex') + '.tar.gz');
  const large = Buffer.concat([archive, Buffer.alloc(1024*1024, 7)]);
  await writeFile(name(owner), large, { mode: 0o440 });
  const peerContent = Buffer.concat([archive, Buffer.from('peer')]);
  await writeFile(name(second), peerContent, { mode: 0o440 });

  assert.deepEqual(await (await handle(request('available'))).json(), { available: true });
  const first = await handle(request('download'));
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(Buffer.from(await first.arrayBuffer()), large);
  principal = second;
  const peer = await handle(request('download'));
  assert.equal(peer.status, 200);
  assert.deepEqual(Buffer.from(await peer.arrayBuffer()), peerContent);
  principal = { ...owner, email: second.email };
  assert.deepEqual(await (await handle(request('available'))).json(), { available: false });
  assert.equal((await handle(request('download'))).status, 404);
  principal = { ...owner, id: '../' + owner.id };
  assert.equal((await handle(request('download'))).status, 404);
  assert.equal((await handle(request('download', null))).status, 401);
  const expired = new Date(Date.now() - 16 * 60_000);
  await utimes(name(owner), expired, expired);
  principal = owner;
  assert.equal((await handle(request('download'))).status, 404);
});
