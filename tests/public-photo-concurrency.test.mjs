import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {test} from 'node:test';
import * as http from '../src/lib/auth-http.ts';
import * as proxy from '../src/lib/trusted-proxy-ip.ts';
import * as ids from '../src/lib/listing-draft-contract.ts';
import {createProductionMediaHandler, productionMediaAdmission} from '../src/lib/production-media-http.ts';

const require = createRequire(import.meta.url), ts = require('typescript');
const publication = '10000000-0000-4000-8000-000000000001';
const file = '10000000-0000-4000-8000-000000000002';
const origin = 'https://example.invalid';
const loaded = new Map();
function loadPublicModule(name = 'production-public-work-photo-http') {
  if (loaded.has(name)) return loaded.get(name);
  const exports = {}, dependencies = {
    'node:crypto': require('node:crypto'),
    './auth-http': http, './auth-http.ts': http,
    './trusted-proxy-ip': proxy, './trusted-proxy-ip.ts': proxy,
    './listing-draft-contract': ids, './listing-draft-contract.ts': ids,
    './production-media-http': {productionMediaAdmission},
    './production-media-http.ts': {productionMediaAdmission},
  };
  const source = readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  }).outputText;
  new Function('require', 'exports', output)(dependency => {
    if (dependency === './media-read-admission' || dependency === './media-read-admission.ts') {
      return loadPublicModule('media-read-admission');
    }
    assert.ok(Object.hasOwn(dependencies, dependency), `Unapproved public photo test import: ${dependency}`);
    return dependencies[dependency];
  }, exports);
  loaded.set(name, exports);
  return exports;
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}

function fixture() {
  assert.equal(productionMediaAdmission.reads, 0, 'previous request released every shared slot');
  const events = [], pending = [], reads = [], requests = [];
  const access = {
    record: {id: file, mimeType: 'image/webp', width: 2, height: 2, size: 12, sha256: 'b'.repeat(64)},
    revision: '2', expiresAt: '2099-01-01T00:00:00.000001Z',
  };
  const state = {visible: true, hold: true, lookups: 0, runtimes: 0, onRead: undefined, onLookup: undefined};
  const runtime = {
    store: {photoRecord: async (resource, media) => {
      assert.equal(resource, publication); assert.equal(media, file);
      state.lookups++;
      state.onLookup?.(state.lookups);
      return state.visible ? structuredClone(access) : undefined;
    }},
    files: {read: async record => {
      assert.deepEqual(record, access.record);
      const gate = deferred();
      reads.push(gate);
      for (const waiter of pending.splice(0)) waiter.resolve();
      if (state.hold) await gate.promise;
      state.onRead?.(reads.length);
      return state.bytes ?? Buffer.alloc(12);
    }},
  };
  const {createProductionPublicWorkPhotoHandler} = loadPublicModule();
  const createHandler = () => createProductionPublicWorkPhotoHandler({origin}, () => {
    state.runtimes++;
    state.onRuntime?.();
    return runtime;
  }, event => { events.push(event); state.onAudit?.(event); });
  const handler = createHandler();
  function start({signal, handle = handler, ip = '192.0.2.1'} = {}) {
    const request = new Request(`${origin}/api/work-publications/${publication}/photos/${file}`, {
      signal, headers: {host: 'example.invalid', 'x-real-ip': ip},
    });
    const result = handle(request, publication, file);
    requests.push(result);
    return result;
  }
  async function waitForReads(count) {
    while (reads.length < count) {
      const waiter = deferred(); pending.push(waiter);
      let timer;
      try {
        await Promise.race([waiter.promise, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Expected ${count} physical reads; got ${reads.length}`)), 1000);
        })]);
      } finally { clearTimeout(timer); }
    }
  }
  return {
    access, state, events, reads, start, createHandler, waitForReads,
    release: index => reads[index].resolve(),
    async occupyFour() {
      const first = Array.from({length: 4}, () => start());
      await waitForReads(4);
      assert.equal(productionMediaAdmission.reads, 4);
      return first;
    },
    async close({assertEmpty = true} = {}) {
      state.hold = false;
      state.onRead = undefined; state.onLookup = undefined; state.onRuntime = undefined; state.onAudit = undefined;
      for (const read of reads) read.resolve();
      await Promise.allSettled(requests);
      if (assertEmpty) assert.equal(productionMediaAdmission.reads, 0);
    },
  };
}

test('F13: a fifth permitted public GET waits for one of four physical reads and succeeds', async () => {
  const f = fixture();
  try {
    const first = await f.occupyFour();
    let settled = false;
    const fifth = f.start().then(response => { settled = true; return response; });
    await nextTurn();
    if (settled) assert.equal((await fifth).status, 200, 'permitted fifth GET must survive a short four-read burst');
    assert.equal(settled, false, 'a short authorized burst must wait instead of returning immediate 503');
    assert.equal(f.reads.length, 4);
    f.release(0);
    assert.equal((await first[0]).status, 200);
    await f.waitForReads(5);
    assert.equal(productionMediaAdmission.reads, 4);
    f.release(4);
    const response = await fifth;
    assert.equal(response.status, 200);
    assert.equal((await response.arrayBuffer()).byteLength, 12);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    for (let index = 1; index < 4; index++) f.release(index);
    assert.deepEqual((await Promise.all(first)).map(result => result.status), [200, 200, 200, 200]);
    assertPrivateAudit(f.events);
  } finally { await f.close(); }
});

test('an already cancelled public GET performs no runtime, SQL or filesystem work', async () => {
  const f = fixture(), controller = new AbortController();
  try {
    controller.abort(new Error('private preflight cancellation /secret'));
    const response = await f.start({signal: controller.signal});
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {error: {code: 'MEDIA_UNAVAILABLE'}});
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(f.state.runtimes, 0);
    assert.equal(f.state.lookups, 0);
    assert.equal(f.reads.length, 0);
    assert.equal(productionMediaAdmission.reads, 0);
    assertPrivateAudit(f.events);
  } finally { await f.close(); }
});

test('cancelling an active GET retains its slot until physical filesystem work settles', async () => {
  const f = fixture(), controller = new AbortController();
  try {
    const active = f.start({signal: controller.signal});
    for (let index = 1; index < 4; index++) f.start();
    await f.waitForReads(4);
    let settled = false;
    const queued = f.start().then(response => { settled = true; return response; });
    controller.abort(new Error('private active cancellation /secret'));
    await nextTurn();
    assert.equal(settled, false);
    assert.equal(f.reads.length, 4, 'aborting a client does not finish its physical read');
    assert.equal(productionMediaAdmission.reads, 4);
    f.release(0);
    const cancelled = await active;
    assert.equal(cancelled.status, 503);
    assert.deepEqual(await cancelled.json(), {error: {code: 'MEDIA_UNAVAILABLE'}});
    await f.waitForReads(5);
    assert.equal(productionMediaAdmission.reads, 4);
    f.release(4);
    assert.equal((await queued).status, 200);
    assertPrivateAudit(f.events);
  } finally { await f.close(); }
});

test('a cancelled queued public GET performs no runtime, SQL or filesystem work and leaves no slot', async () => {
  const f = fixture(), controller = new AbortController();
  try {
    await f.occupyFour();
    const queued = f.start({signal: controller.signal});
    await nextTurn();
    assert.equal(f.state.runtimes, 4);
    assert.equal(f.state.lookups, 4);
    assert.equal(f.reads.length, 4);
    controller.abort(new Error('private cancellation detail /secret'));
    const response = await queued;
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {error: {code: 'MEDIA_UNAVAILABLE'}});
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(productionMediaAdmission.reads, 4);
    f.release(0);
    await nextTurn();
    assert.equal(f.state.lookups, 5, 'only the original request rechecks authorization');
    assert.equal(f.reads.length, 4, 'the cancelled queue entry must never enter the filesystem');
    const replacement = f.start();
    await f.waitForReads(5);
    f.release(4);
    assert.equal((await replacement).status, 200);
    assertPrivateAudit(f.events);
  } finally { await f.close(); }
});

for (const hiddenAt of ['before queuing', 'while queued']) {
  test(`a resource hidden ${hiddenAt} returns 404 without accessing its file after admission`, async () => {
    const f = fixture();
    try {
      await f.occupyFour();
      if (hiddenAt === 'before queuing') f.state.visible = false;
      let settled = false;
      const queued = f.start().then(response => { settled = true; return response; });
      await nextTurn();
      assert.equal(settled, false);
      assert.equal(f.state.lookups, 4, 'queued work cannot retain an earlier authorization');
      f.state.visible = false;
      f.release(0);
      const response = await queued;
      assert.equal(response.status, 404);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(f.reads.length, 4);
      assertPrivateAudit(f.events);
    } finally { await f.close(); }
  });
}

for (const change of ['withdrawal', 'revision', 'expiry']) {
  test(`public photo rechecks ${change} after the physical read and returns no bytes`, async () => {
    const f = fixture();
    try {
      const responsePromise = f.start();
      await f.waitForReads(1);
      if (change === 'withdrawal') f.state.visible = false;
      if (change === 'revision') f.access.revision = '3';
      if (change === 'expiry') f.access.expiresAt = '2000-01-01T00:00:00.000001Z';
      f.release(0);
      const response = await responsePromise;
      assert.equal(response.status, 404);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('content-type').startsWith('application/json'), true);
      const body = await response.text();
      assert.equal(body.includes(f.access.record.sha256), false);
      assert.equal(productionMediaAdmission.reads, 0);
      assertPrivateAudit(f.events);
    } finally { await f.close(); }
  });
}

for (const failure of ['runtime', 'initial SQL', 'filesystem', 'invalid bytes', 'recheck SQL']) {
  test(`public photo releases its slot after ${failure} failure and hides internal errors`, async () => {
    const f = fixture();
    try {
      f.state.hold = false;
      const secret = `private SQL path /secret/${file} hash ${f.access.record.sha256}`;
      if (failure === 'runtime') f.state.onRuntime = () => { throw new Error(secret); };
      if (failure === 'initial SQL') f.state.onLookup = () => { throw new Error(secret); };
      if (failure === 'recheck SQL') f.state.onLookup = count => { if (count === 2) throw new Error(secret); };
      if (failure === 'filesystem') f.state.onRead = () => { throw new Error(secret); };
      if (failure === 'invalid bytes') f.state.bytes = Buffer.alloc(13);
      const response = await f.start();
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {error: {code: 'MEDIA_UNAVAILABLE'}});
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(productionMediaAdmission.reads, 0);
      f.state.onRuntime = undefined; f.state.onLookup = undefined; f.state.onRead = undefined; f.state.bytes = undefined;
      assert.equal((await f.start()).status, 200);
      assert.equal(productionMediaAdmission.reads, 0);
      assert.equal(f.events.length, 2);
      assert.deepEqual(f.events.map(event => event.status), [503, 200]);
      assertPrivateAudit(f.events);
    } finally { await f.close(); }
  });
}

test('separate public handler instances share four physical read slots', async () => {
  const f = fixture(), other = f.createHandler();
  try {
    for (let index = 0; index < 4; index++) f.start({handle: index % 2 ? other : undefined});
    await f.waitForReads(4);
    let settled = false;
    const fifth = f.start({handle: other}).then(response => { settled = true; return response; });
    await nextTurn();
    assert.equal(settled, false);
    assert.equal(f.reads.length, 4);
    assert.equal(productionMediaAdmission.reads, 4);
    f.release(2);
    await f.waitForReads(5);
    assert.equal(productionMediaAdmission.reads, 4);
    f.release(4);
    assert.equal((await fifth).status, 200);
  } finally { await f.close(); }
});

function assertPrivateAudit(events) {
  const json = JSON.stringify(events);
  for (const value of [publication, file, 'b'.repeat(64), '/secret', '192.0.2.1']) {
    assert.equal(json.includes(value), false, 'audit cannot expose resource IDs, hashes, paths or client IP');
  }
  for (const event of events) {
    assert.equal(typeof event.requestId, 'string');
    assert.equal(Number.isInteger(event.status), true);
    assert.equal(Number.isFinite(event.durationMs) && event.durationMs >= 0, true);
  }
}

function privateFixture() {
  const state = {revoked: false, hold: true, identities: 0, reads: 0, uploads: 0, physical: 0};
  const readStarted = deferred(), uploadStarted = deferred(), readGate = deferred(), uploadGate = deferred();
  const events = [], requests = [];
  const record = {id: file, mimeType: 'image/webp', width: 2, height: 2, size: 12};
  const token = 'a'.repeat(64);
  const runtime = {
    identity: {resolveSession: async provided => {
      state.identities++; assert.equal(provided, token);
      return state.revoked ? null : {id: publication};
    }},
    limiter: {allowProduction: async () => true},
    repository: {readOwned: async (provided, media) => {
      assert.equal(provided, token); assert.equal(media, file); state.reads++;
      if (state.revoked) throw Object.assign(new Error(`private revoked session /secret/${publication}`), {code: 'MEDIA_ACCESS_DENIED'});
      state.physical++; readStarted.resolve();
      try {
        if (state.hold) await readGate.promise;
        return {record, bytes: Buffer.alloc(12)};
      } finally { state.physical--; }
    }},
    upload: {upload: async (provided, intent) => {
      assert.equal(provided, token); assert.equal(intent, file);
      state.uploads++; uploadStarted.resolve();
      if (state.hold) await uploadGate.promise;
      return record;
    }},
  };
  const handle = createProductionMediaHandler({origin}, async () => runtime, event => events.push(event));
  return {
    state, events, readStarted: readStarted.promise, uploadStarted: uploadStarted.promise,
    start(operation = 'read', {ip = '192.0.2.1'} = {}) {
      const upload = operation === 'upload';
      const request = new Request(`${origin}/api/account/media${upload ? '' : '/read'}`, {
        method: 'POST',
        headers: {
          host: 'example.invalid', origin, 'x-blizhniy-request': '1', 'x-real-ip': ip,
          cookie: `__Host-blizhniy_session=${token}`,
          'content-type': upload ? 'image/jpeg' : 'application/json',
          ...(upload ? {'x-blizhniy-owner': publication, 'x-blizhniy-intent': file} : {}),
        },
        body: upload ? Buffer.from([1, 2]) : JSON.stringify({expectedOwnerId: publication, fileId: file}),
      });
      const response = handle(request, operation); requests.push(response); return response;
    },
    releaseRead: () => readGate.resolve(), releaseUpload: () => uploadGate.resolve(),
    async close() {
      state.hold = false; readGate.resolve(); uploadGate.resolve();
      await Promise.allSettled(requests);
    },
  };
}

async function closeMixed(publicReader, privateReader) {
  privateReader.state.hold = false;
  privateReader.releaseRead(); privateReader.releaseUpload();
  await Promise.all([publicReader.close({assertEmpty: false}), privateReader.close()]);
  assert.equal(productionMediaAdmission.reads, 0);
  assert.equal(productionMediaAdmission.upload, false);
}

test('three public reads and one actual private reader share capacity across separately loaded helper bundles', async () => {
  const f = fixture(), privateReader = privateFixture();
  try {
    const publicRequests = Array.from({length: 3}, () => f.start());
    await f.waitForReads(3);
    const privateRequest = privateReader.start();
    await privateReader.readStarted;
    assert.equal(privateReader.state.physical, 1);
    assert.equal(productionMediaAdmission.reads, 4);
    let settled = false;
    const fifth = f.start().then(response => { settled = true; return response; });
    await nextTurn();
    assert.equal(settled, false);
    assert.equal(f.reads.length, 3);
    privateReader.releaseRead();
    const privateResponse = await privateRequest;
    assert.equal(privateResponse.status, 200);
    assert.equal((await privateResponse.arrayBuffer()).byteLength, 12);
    await f.waitForReads(4);
    assert.equal(privateReader.state.physical, 0);
    assert.equal(productionMediaAdmission.reads, 4);
    f.release(3);
    assert.equal((await fifth).status, 200);
    publicRequests.forEach((_, index) => f.release(index));
    assert.deepEqual((await Promise.all(publicRequests)).map(response => response.status), [200, 200, 200]);
    assertPrivateAudit([...f.events, ...privateReader.events]);
  } finally { await closeMixed(f, privateReader); }
});

test('a private read queued behind four public reads rejects repository authorization revoked during its wait', async () => {
  const f = fixture(), privateReader = privateFixture();
  try {
    await f.occupyFour();
    let settled = false;
    const queued = privateReader.start().then(response => { settled = true; return response; });
    await nextTurn();
    assert.equal(settled, false);
    assert.equal(privateReader.state.identities, 1, 'initial identity authorization preceded admission');
    assert.equal(privateReader.state.reads, 0, 'repository must run after admission');
    privateReader.state.revoked = true;
    f.release(0);
    const response = await queued;
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {error: {code: 'MEDIA_ACCESS_DENIED'}});
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(privateReader.state.reads, 1);
    assert.equal(privateReader.state.physical, 0, 'a revoked session cannot receive private bytes');
    assert.equal(productionMediaAdmission.reads, 3);
    assertPrivateAudit([...f.events, ...privateReader.events]);
  } finally { await closeMixed(f, privateReader); }
});

test('one upload remains independent of four shared reads and a second upload stays busy', async () => {
  const f = fixture(), privateReader = privateFixture();
  try {
    const upload = privateReader.start('upload');
    await privateReader.uploadStarted;
    assert.equal(productionMediaAdmission.upload, true);
    assert.equal(productionMediaAdmission.reads, 0);
    await f.occupyFour();
    assert.equal(productionMediaAdmission.upload, true);
    assert.equal(productionMediaAdmission.reads, 4);
    const blockedUpload = await privateReader.start('upload');
    assert.equal(blockedUpload.status, 503);
    assert.deepEqual(await blockedUpload.json(), {error: {code: 'MEDIA_BUSY'}});
    assert.equal(privateReader.state.uploads, 1);
    let settled = false;
    const queued = f.start().then(response => { settled = true; return response; });
    privateReader.releaseUpload();
    assert.equal((await upload).status, 200);
    await nextTurn();
    assert.equal(productionMediaAdmission.upload, false);
    assert.equal(productionMediaAdmission.reads, 4);
    assert.equal(settled, false, 'finishing an upload cannot reserve a fifth physical read');
    f.release(0);
    await f.waitForReads(5);
    f.release(4);
    assert.equal((await queued).status, 200);
    assertPrivateAudit([...f.events, ...privateReader.events]);
  } finally { await closeMixed(f, privateReader); }
});

test('cancellation immediately after a queued slot grant releases the reservation before runtime work', async () => {
  const f = fixture(), controller = new AbortController();
  try {
    await f.occupyFour();
    const queued = f.start({signal: controller.signal});
    await nextTurn();
    let cancelledAtGrant = false;
    f.state.onAudit = event => {
      if (event.status === 200 && !cancelledAtGrant) {
        assert.equal(productionMediaAdmission.reads, 4, 'the waiting request already owns the released reservation');
        cancelledAtGrant = true;
        controller.abort(new Error('private slot-grant cancellation /secret'));
      }
    };
    f.release(0);
    const response = await queued;
    assert.equal(cancelledAtGrant, true);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {error: {code: 'MEDIA_UNAVAILABLE'}});
    assert.equal(f.state.runtimes, 4, 'an aborted granted slot cannot initialize a new runtime');
    assert.equal(f.state.lookups, 5, 'only the successful original request performs a SQL recheck');
    assert.equal(f.reads.length, 4);
    assert.equal(productionMediaAdmission.reads, 3);
    assertPrivateAudit(f.events);
  } finally { await f.close(); }
});

test('mixed public and private bundles rotate waiting client IPs before draining one gallery', async () => {
  const f = fixture(), privateReader = privateFixture();
  try {
    await f.occupyFour();
    const firstGallery = f.start({ip: '192.0.2.10'});
    const secondGallery = f.start({ip: '192.0.2.10'});
    const independent = privateReader.start('read', {ip: '192.0.2.11'});
    await nextTurn();
    assert.equal(f.reads.length, 4);
    assert.equal(privateReader.state.reads, 0);
    f.release(0);
    await f.waitForReads(5);
    assert.equal(privateReader.state.reads, 0, 'the first waiting gallery request keeps FIFO position');
    f.release(4);
    assert.equal((await firstGallery).status, 200);
    await privateReader.readStarted;
    assert.equal(f.reads.length, 5, 'another IP is served before the second request from one gallery');
    assert.equal(productionMediaAdmission.reads, 4);
    assert.equal(privateReader.state.physical, 1);
    privateReader.releaseRead();
    assert.equal((await independent).status, 200);
    await f.waitForReads(6);
    assert.equal(productionMediaAdmission.reads, 4);
    f.release(5);
    assert.equal((await secondGallery).status, 200);
  } finally { await closeMixed(f, privateReader); }
});
