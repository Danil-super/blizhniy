const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const typescript = require('typescript');

function loadRoute() {
  const writes = [];
  const mediaChecks = [];
  const stubs = {
    'next/server': {
      NextResponse: { json: (body, options = {}) => ({ body, status: options.status ?? 200 }) },
    },
    '@/lib/specialist-profile-store': {
      getSpecialistProfileCompleteness: () => ({ complete: true, missing: [] }),
      getStoredSpecialistProfileForUser: async () => ({ id: 'draft-specialist', status: 'draft' }),
      upsertStoredSpecialistProfileForUser: async (...args) => {
        writes.push(args);
        return { id: 'draft-specialist', status: args[1].status ?? 'draft' };
      },
    },
    '@/lib/server-auth': {
      getAuthenticatedRequestUser: async () => ({ user: { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.test' } }),
      isSupabaseServerConfigured: () => true,
    },
    '@/lib/supabase-rest': { isSupabaseServiceRoleConfigured: () => true },
    '@/lib/storage-upload': {
      validateMediaStoragePathsForUser: (...args) => {
        mediaChecks.push(args);
        return args[0];
      },
    },
  };
  const filename = path.join(__dirname, '../src/app/api/cabinet/specialist/route.ts');
  const js = typescript.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)((name) => {
    if (!(name in stubs)) throw new Error(`Unexpected dependency ${name}`);
    return stubs[name];
  }, module, module.exports);
  return { PATCH: module.exports.PATCH, writes, mediaChecks };
}

function patchRequest(body) {
  return new Request('https://example.test/api/cabinet/specialist', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('an authenticated specialist cannot directly activate an unpaid profile', async () => {
  const { PATCH, writes, mediaChecks } = loadRoute();
  for (const body of [
    { action: 'activate' },
    { action: 'activate', name: 'Иван Иванов', profession: 'Электрик', skills: 'Монтаж проводки', description: 'Полностью заполненная анкета опытного специалиста', phone: '+79991112233' },
    { action: 'activate', status: 'published', paymentId: 'forged-payment-id', photoPath: 'specialists/forged/portrait.png' },
  ]) {
    const response = await PATCH(patchRequest(body));
    assert.equal(response.status, 409);
    assert.match(response.body.error, /Публикация анкеты временно недоступна/);
  }

  assert.equal(writes.length, 0, 'activation must not reach the persistence layer');
  assert.equal(mediaChecks.length, 0, 'activation must stop before processing uploaded media');
});

test('saving a draft ignores a forged published status; deactivation stays available', async () => {
  const { PATCH, writes } = loadRoute();
  const saved = await PATCH(patchRequest({ action: 'save', status: 'published', name: 'Иван Иванов' }));
  assert.equal(saved.status, 200);
  assert.equal(writes[0][1].status, undefined);
  assert.equal(saved.body.specialist.status, 'draft');

  const deactivated = await PATCH(patchRequest({ action: 'deactivate', status: 'published' }));
  assert.equal(deactivated.status, 200);
  assert.equal(writes[1][1].status, 'draft');
});

function loadAdminStatusRoute() {
  const reads = [];
  const writes = [];
  const notifications = [];
  const stubs = {
    'next/cache': { revalidatePath: () => {} },
    'next/server': { NextResponse: { json: (body, options = {}) => ({ body, status: options.status ?? 200 }) } },
    '@/lib/notification-store': { createStoredNotification: async (input) => notifications.push(input) },
    '@/lib/server-auth': { isAdminRequest: async () => true, isDemoAdminBypassEnabled: () => false },
    '@/lib/supabase-rest': {
      isSupabaseRestConfigured: () => true,
      isUuid: (value) => /^[0-9a-f-]{36}$/.test(value),
      supabaseRest: async (url, options = {}) => {
        if (options.method === 'PATCH') {
          writes.push({ url, body: options.body });
          return [{ id: '22222222-2222-4222-8222-222222222222' }];
        }
        reads.push(url);
        return [{ id: '22222222-2222-4222-8222-222222222222', status: 'pending_payment', user_id: 'owner-id', author_id: 'owner-id', name: 'Иван', title: 'Объявление' }];
      },
    },
  };
  const filename = path.join(__dirname, '../src/app/api/admin/publications/status/route.ts');
  const js = typescript.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)((name) => {
    if (!(name in stubs)) throw new Error(`Unexpected dependency ${name}`);
    return stubs[name];
  }, module, module.exports);
  return { POST: module.exports.POST, reads, writes, notifications };
}

function adminStatusRequest(entityType, status) {
  return new Request('https://example.test/api/admin/publications/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entityType, status, id: '22222222-2222-4222-8222-222222222222' }),
  });
}

test('an authenticated admin cannot publish an unpaid specialist through the status endpoint', async () => {
  const { POST, reads, writes, notifications } = loadAdminStatusRoute();
  const response = await POST(adminStatusRequest('specialist', 'published'));
  assert.equal(response.status, 409);
  assert.match(response.body.error, /Публикация анкеты специалиста временно недоступна/);
  assert.deepEqual(reads, []);
  assert.deepEqual(writes, []);
  assert.deepEqual(notifications, []);
});

test('admin specialist deactivation and ordinary listing publication remain possible', async () => {
  const { POST, writes } = loadAdminStatusRoute();
  assert.equal((await POST(adminStatusRequest('specialist', 'draft'))).status, 200);
  assert.equal((await POST(adminStatusRequest('listing', 'published'))).status, 200);
  assert.deepEqual(writes.map(({ body }) => body.status), ['draft', 'published']);
});
