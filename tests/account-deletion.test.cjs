const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const typescript = require('typescript');

const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let rows = [];

function loadTs(relativePath, stubs) {
  const filename = path.join(__dirname, '..', relativePath);
  const content = fs.readFileSync(filename, 'utf8');
  const js = typescript.transpileModule(content, {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)((name) => {
    if (!(name in stubs)) throw new Error(`Unexpected dependency: ${name}`);
    return stubs[name];
  }, module, module.exports);
  return module.exports;
}

const rest = {
  isUuid(value) {
    return typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value);
  },
  isSupabaseServiceRoleConfigured() { return true; },
  async supabaseRest(url, options = {}) {
    if (url.startsWith('/rest/v1/profiles')) {
      return [{ id: userA, email: 'a@example.test' }, { id: userB, email: 'b@example.test' }];
    }
    if (options.method === 'POST') {
      if (!rows.some((row) => row.user_id === options.body.user_id)) {
        const row = { id, user_id: options.body.user_id, status: 'requested', requested_at: '2026-09-25T12:00:00Z', review_started_at: null, resolved_at: null, resolution: null };
        rows.push(row);
        return [row];
      }
      return [];
    }
    if (options.method === 'PATCH') {
      const item = rows.find((row) => url.includes(`id=eq.${row.id}`) && row.status === 'requested');
      if (!item) return [];
      Object.assign(item, options.body);
      return [item];
    }
    if (url.includes('user_id=eq.')) {
      const requestedUser = new URL('https://example.test' + url).searchParams.get('user_id').slice(3);
      return rows.filter((row) => row.user_id === requestedUser);
    }
    return rows;
  },
};

const store = loadTs('src/lib/account-deletion-store.ts', { '@/lib/supabase-rest': rest });
const serverAuth = {
  isSupabaseServerConfigured() { return true; },
  async getVerifiedRequestUser(request) {
    const user = request.headers.get('authorization');
    return user === 'A' || user === 'blocked-A' ? { user: { id: userA } } : user === 'B' ? { user: { id: userB } } : null;
  },
  async isAdminRequest(request) { return request.headers.get('authorization') === 'admin'; },
};
const NextResponse = { json(body, options = {}) { return { body, status: options.status ?? 200, headers: options.headers }; } };

const cabinet = loadTs('src/app/api/cabinet/account-deletion/route.ts', {
  'next/server': { NextResponse },
  '@/lib/account-deletion-store': store,
  '@/lib/server-auth': serverAuth,
  '@/lib/supabase-rest': rest,
});
const admin = loadTs('src/app/api/admin/account-deletion-requests/route.ts', {
  'next/server': { NextResponse },
  '@/lib/account-deletion-store': store,
  '@/lib/server-auth': serverAuth,
  '@/lib/supabase-rest': rest,
});

function request(token, method = 'GET', payload) {
  return new Request('https://example.test', {
    method,
    headers: token ? { Authorization: token } : {},
    body: payload ? JSON.stringify(payload) : undefined,
  });
}

test('the account request cannot be forged or read from another account', async () => {
  rows = [];
  assert.equal((await cabinet.POST(request('', 'POST'))).status, 401);

  const submitted = await cabinet.POST(request('blocked-A', 'POST', { user_id: userB, status: 'resolved' }));
  assert.equal(submitted.status, 202);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, userA);
  assert.equal(rows[0].status, 'requested');
  assert.equal('user_id' in submitted.body.request, false);

  assert.equal((await cabinet.GET(request('B'))).body.request, null);
  assert.equal((await cabinet.GET(request('A'))).body.request.id, id);
  assert.equal((await cabinet.POST(request('A', 'POST'))).status, 202);
  assert.equal(rows.length, 1);
});

test('only a verified administrator can see or advance pending reviews', async () => {
  assert.equal((await admin.GET(request('A'))).status, 403);
  assert.equal((await admin.PATCH(request('A', 'PATCH', { requestId: id }))).status, 403);

  const list = await admin.GET(request('admin'));
  assert.equal(list.status, 200);
  assert.equal(list.body.requests[0].email, 'a@example.test');

  const started = await admin.PATCH(request('admin', 'PATCH', { requestId: id, status: 'resolved' }));
  assert.equal(started.status, 200);
  assert.equal(rows[0].status, 'in_review');
  assert.equal(rows[0].resolution, null);
  assert.equal((await admin.PATCH(request('admin', 'PATCH', { requestId: id }))).status, 409);
});
