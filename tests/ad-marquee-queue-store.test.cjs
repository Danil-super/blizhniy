const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const placementId = '00000000-0000-4000-8000-000000000014';
const baseRow = { id: placementId, user_id: 'owner', text: 'Synthetic marquee text', status: 'pending_payment',
  payment_status: 'created', sort_order: 0, created_at: '2020-01-01T00:00:00Z', updated_at: '2020-01-01T00:00:00Z' };

function load(relative, stubs, mutate = (source) => source) {
  const filename = path.join(__dirname, '..', relative);
  const source = mutate(fs.readFileSync(filename, 'utf8'));
  const js = ts.transpileModule(source, { fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)((name) => {
    assert.ok(name in stubs, `Unexpected dependency ${name}`);
    return stubs[name];
  }, module, module.exports);
  return module.exports;
}

function storeHarness({ configured = true, result = { placement: baseRow, changed: true, outcome: 'updated' }, queueError,
  active = [{ id: 'active-id' }], placementRows = [] } = {}) {
  const calls = [];
  const notices = [];
  const store = load('src/lib/ad-marquee-store.ts', {
    '@/lib/ad-marquee': { defaultAdMarqueeMessages: [], maxActiveAdMarqueePlacements: 5 },
    '@/lib/notification-store': { createStoredNotification: async (notice) => { notices.push(notice); } },
    '@/lib/tariff-store': { getPublicTariffs: async () => { throw new Error('Current tariff is not a purchased snapshot'); } },
    '@/lib/supabase-rest': {
      isSupabaseRestConfigured: () => configured,
      isUuid: (value) => typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value),
      supabaseRest: async (url, options = {}) => {
        calls.push({ url, options });
        if (url === '/rest/v1/rpc/reconcile_ad_marquee_queue') {
          if (queueError) throw queueError;
          return active;
        }
        if (url === '/rest/v1/rpc/moderate_ad_marquee_placement') return result;
        if (url.includes('payment_id=eq.')) return placementRows;
        if (options.method === 'PATCH') return [baseRow];
        if (url.includes('status=eq.paid')) return [{ id: placementId }];
        return [];
      },
    },
  });
  return { store, calls, notices, active };
}

test('queue refresh delegates one atomic transaction and returns its committed active IDs', async () => {
  const { store, calls, active } = storeHarness();
  assert.deepEqual(await store.refreshAdMarqueeQueue(), active);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/rest/v1/rpc/reconcile_ad_marquee_queue');
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(calls[0].options.body, {});
});

test('post-payment current-state read is narrow, owner/payment-bound and single-attempt', async () => {
  const userId = '33333333-3333-4333-8333-333333333333';
  const paymentId = '11111111-1111-4111-8111-111111111111';
  const { store, calls } = storeHarness({ active: [], placementRows: [{ id: placementId, user_id: userId,
    payment_id: paymentId, payment_status: 'succeeded', status: 'paid', starts_at: null, ends_at: null }] });
  assert.equal(await store.reconcilePaidAdMarqueePlacement({ id: placementId, userId, paymentId }), 'paid');
  assert.equal(calls.length, 2);
  const query = new URL(`https://fixture.invalid${calls[1].url}`).searchParams;
  assert.equal(query.get('id'), `eq.${placementId}`);
  assert.equal(query.get('user_id'), `eq.${userId}`);
  assert.equal(query.get('payment_id'), `eq.${paymentId}`);
  assert.equal(query.get('payment_status'), 'eq.succeeded');
  assert.equal(query.get('or'), '(status.eq.paid,and(status.eq.active,starts_at.lte.now,ends_at.gt.now))');
  assert.equal(query.get('limit'), '1');
  assert.doesNotMatch(query.get('select'), /\*|text|href|admin_comment/);
  for (const call of calls) {
    assert.equal(call.options.attempts, 1);
    assert.equal(call.options.useServiceRole, true);
    assert.ok(call.options.timeoutMs > 0 && call.options.timeoutMs <= 8000);
  }
});

test('post-payment read refuses malformed bindings or expired deadline before any queue write', async () => {
  const { store, calls } = storeHarness();
  assert.equal(await store.reconcilePaidAdMarqueePlacement({ id: placementId, userId: 'bad', paymentId: placementId }), undefined);
  await assert.rejects(store.reconcilePaidAdMarqueePlacement({ id: placementId, userId: placementId, paymentId: placementId }, performance.now()), /deadline/);
  assert.deepEqual(calls, []);
});

test('queue refresh without configuration is a no-write empty result', async () => {
  const { store, calls } = storeHarness({ configured: false });
  assert.deepEqual(await store.refreshAdMarqueeQueue(), []);
  assert.deepEqual(calls, []);
});

test('RPC failure never falls back to unlocked REST activation or tariff duration', async () => {
  const { store, calls } = storeHarness({ queueError: new Error('synthetic rollback') });
  await assert.rejects(store.refreshAdMarqueeQueue(), /synthetic rollback/);
  assert.equal(calls.length, 1);
});

test('two source-level refreshes cannot reuse a stale last-slot count to activate different queued rows', async () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({ id: `synthetic-${i}`, status: i < 4 ? 'active' : 'paid' }));
  let queuedReads = 0;
  let releaseFirstActivation;
  const firstActivation = new Promise((resolve) => { releaseFirstActivation = resolve; });
  const store = load('src/lib/ad-marquee-store.ts', {
    '@/lib/ad-marquee': { defaultAdMarqueeMessages: [], maxActiveAdMarqueePlacements: 5 },
    '@/lib/notification-store': { createStoredNotification: async () => {} },
    '@/lib/tariff-store': { getPublicTariffs: async () => [{ action: 'ad_marquee', durationDays: 7 }] },
    '@/lib/supabase-rest': { isUuid: () => true, isSupabaseRestConfigured: () => true,
      supabaseRest: async (url, options = {}) => {
        if (url === '/rest/v1/rpc/reconcile_ad_marquee_queue') {
          // A transaction boundary fake: no await between count and activation.
          const slots = 5 - rows.filter((r) => r.status === 'active').length;
          for (const row of rows.filter((r) => r.status === 'paid').slice(0, slots)) row.status = 'active';
          return rows.filter((r) => r.status === 'active').map((r) => ({ id: r.id }));
        }
        if (options.method === 'PATCH' && url.includes('id=eq.')) {
          const row = rows.find((r) => url.endsWith(r.id));
          row.status = options.body.status;
          releaseFirstActivation();
          return [];
        }
        if (options.method === 'PATCH') return [];
        if (url.includes('status=eq.active')) return rows.filter((r) => r.status === 'active').map((r) => ({ id: r.id }));
        if (url.includes('status=eq.paid')) {
          // Both callers already counted four. The second caller reads its
          // next paid row only after the first activated a DIFFERENT row.
          if (++queuedReads === 2) await firstActivation;
          return rows.filter((r) => r.status === 'paid').slice(0, 1).map((r) => ({ id: r.id }));
        }
        assert.fail(`Unexpected persistence boundary ${url}`);
      } },
  });
  await Promise.all([store.refreshAdMarqueeQueue(), store.refreshAdMarqueeQueue()]);
  assert.equal(rows.filter((r) => r.status === 'active').length, 5);
  assert.equal(rows.filter((r) => r.status === 'paid').length, 1);
});

test('moderation uses a committed outcome then reconciles separately and notifies the real transition', async () => {
  const { store, calls, notices } = storeHarness();
  const placement = await store.updateAdMarqueePlacementForAdmin({ id: placementId, status: 'pending_payment', sortOrder: 7, adminComment: ' ok ' });
  assert.equal(placement.id, placementId);
  assert.equal(calls[0].url, '/rest/v1/rpc/moderate_ad_marquee_placement');
  assert.deepEqual(calls[0].options.body, { p_id: placementId, p_status: 'pending_payment', p_sort_order: 7, p_admin_comment: 'ok' });
  assert.equal(calls[1].url, '/rest/v1/rpc/reconcile_ad_marquee_queue');
  assert.equal(notices.length, 1);
});

test('approval replay preserves response and produces no duplicate notification', async () => {
  const { store, notices } = storeHarness({ result: { placement: baseRow, changed: false, outcome: 'unchanged' } });
  assert.equal((await store.updateAdMarqueePlacementForAdmin({ id: placementId, status: 'pending_payment' })).id, placementId);
  assert.deepEqual(notices, []);
});

test('conflicting moderation cannot notify or reconcile after a rejected transition', async () => {
  const { store, calls, notices } = storeHarness({ result: { placement: { ...baseRow, status: 'active' }, changed: false, outcome: 'conflict' } });
  await assert.rejects(store.updateAdMarqueePlacementForAdmin({ id: placementId, status: 'pending_payment' }),
    (error) => error.name === 'AdMarqueeTransitionConflictError');
  assert.equal(calls.length, 1);
  assert.deepEqual(notices, []);
});

test('missing placement returns undefined without notifications or queue writes', async () => {
  const { store, calls, notices } = storeHarness({ result: { placement: null, changed: false, outcome: 'not_found' } });
  assert.equal(await store.updateAdMarqueePlacementForAdmin({ id: placementId, status: 'archived' }), undefined);
  assert.equal(calls.length, 1);
  assert.deepEqual(notices, []);
});

function routeHarness({ admin = true, conflict = false } = {}) {
  const writes = [];
  class AdMarqueeTransitionConflictError extends Error {}
  const route = load('src/app/api/admin/ad-marquee/route.ts', {
    'next/server': { NextResponse: { json: (body, options = {}) => ({ body, status: options.status ?? 200 }) } },
    '@/lib/ad-marquee-store': { AdMarqueeTransitionConflictError,
      listAdMarqueePlacementsForAdmin: async () => [],
      updateAdMarqueePlacementForAdmin: async (input) => {
        writes.push(input);
        if (conflict) throw new AdMarqueeTransitionConflictError('Transition conflict');
        return { id: placementId };
      } },
    '@/lib/server-auth': { isDemoAdminBypassEnabled: () => false,
      isSupabaseServerConfigured: () => true, isAdminRequest: async () => admin },
    '@/lib/supabase-rest': { isUuid: (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/.test(value) },
  });
  return { route, writes };
}
const request = (body) => new Request('https://example.invalid/api/admin/ad-marquee',
  { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('admin API returns 409 for monotonic transition conflicts and preserves normal response shape', async () => {
  const { route } = routeHarness({ conflict: true });
  assert.equal((await route.PATCH(request({ id: placementId, status: 'pending_payment' }))).status, 409);
  const normal = routeHarness();
  assert.deepEqual((await normal.route.PATCH(request({ id: placementId, status: 'archived' }))).body,
    { placement: { id: placementId }, placements: [] });
});

test('admin API rejects malformed primitive types and out-of-range sort order before mutation', async () => {
  const { route, writes } = routeHarness();
  for (const extra of [{ id: {} }, { id: 'not-uuid' }, { adminComment: {} }, { adminComment: 'x'.repeat(2001) },
    { sortOrder: '1' }, { sortOrder: 0.5 }, { sortOrder: 2147483648 }]) {
    assert.equal((await route.PATCH(request({ id: placementId, status: 'archived', ...extra }))).status, 400);
  }
  assert.deepEqual(writes, []);
});

test('admin API never reaches the service RPC boundary for an unauthorised caller', async () => {
  const { route, writes } = routeHarness({ admin: false });
  assert.equal((await route.PATCH(request({ id: placementId, status: 'archived' }))).status, 403);
  assert.deepEqual(writes, []);
});

test('existing public draft POST binds verified owner and cannot accept browser payment/status fields', async () => {
  const creations = [];
  const route = load('src/app/api/ad-marquee/route.ts', {
    'next/server': { NextResponse: { json: (body, options = {}) => ({ body, status: options.status ?? 200 }) } },
    '@/lib/ad-marquee-store': { createAdMarqueePlacement: async (input) => { creations.push(input); return { id: placementId }; },
      listAdMarqueePlacementsForUser: async () => [] },
    '@/lib/server-auth': { isSupabaseServerConfigured: () => true,
      getAuthenticatedRequestUser: async () => ({ user: { id: 'verified-owner' } }) },
  });
  const response = await route.POST(request({ text: 'Synthetic user draft', userId: 'forged-owner', status: 'active',
    starts_at: '2090-01-01', payment_status: 'succeeded' }));
  assert.equal(response.status, 201);
  assert.deepEqual(creations, [{ text: 'Synthetic user draft', href: undefined, userId: 'verified-owner' }]);
});
