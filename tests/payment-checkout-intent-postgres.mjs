import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test, { before, beforeEach, after } from 'node:test';

// Explicit medium/offline suite: its PostgreSQL17 process is isolated, cached,
// network=none and uniquely owned. No live Supabase/Auth/provider assurance.
const require = createRequire(import.meta.url);
const { harness, ids, input, originalBody, hash } = require('./payment-checkout-intent.test.cjs');
const root = fileURLToPath(new URL('../', import.meta.url));
const run = promisify(execFile);
const container = 'blizhniy-checkout-snapshot-pg17-20261008';
const database = 'checkout_snapshot_fixture';
const label = 'blizhniy.checkout-snapshot-test=ui_recovery';
let owned = false;
const roleNames = new Set(['service_role', 'authenticated', 'anon', 'postgres']);

async function docker(args) {
  return (await run('docker', args, { timeout: 15_000, maxBuffer: 1024 * 1024 })).stdout.trim();
}
function psqlArgs(parameters = {}) {
  const encoded = Buffer.from(JSON.stringify(parameters)).toString('base64');
  return ['exec', '-i', container, 'psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
    '-v', `fixture_params=${encoded}`, '-U', 'postgres', '-d', database];
}
function psql(statement, parameters = {}, role = 'service_role') {
  assert.ok(roleNames.has(role));
  return new Promise((resolve, reject) => {
    const child = spawn('docker', psqlArgs(parameters), { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', errors = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Owned PG fixture statement timed out')); }, 9000);
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { errors += data; });
    child.on('error', reject);
    child.on('exit', code => {
      clearTimeout(timer);
      if (code === 0) resolve(output.trim());
      else reject(new Error(errors.trim()));
    });
    child.stdin.end(`set statement_timeout = '6s'; set role ${role};\n${statement}\n`);
  });
}
const param = "select convert_from(decode(:'fixture_params', 'base64'), 'UTF8')::jsonb as p";
const json = async (statement, parameters, role) => JSON.parse(await psql(statement, parameters, role));
const prepareSql = `with args as (${param}) select coalesce(json_agg(r), '[]'::json) from args,
  lateral public.prepare_yookassa_checkout_intent((p->>'p_payment_id')::uuid, (p->>'p_user_id')::uuid,
    p->>'p_target_type', (p->>'p_target_id')::uuid, p->>'p_tariff_key', (p->>'p_amount')::numeric,
    (p->>'p_purchased_duration_days')::integer, p->>'p_merchant_shop_id', (p->>'p_is_test')::boolean, p->>'p_request_body') r;`;
const authorizeSql = `with args as (${param}) select coalesce(json_agg(r), '[]'::json) from args,
  lateral public.authorize_yookassa_checkout_attempt((p->>'p_payment_id')::uuid, (p->>'p_user_id')::uuid,
    p->>'p_target_type', (p->>'p_target_id')::uuid, p->>'p_merchant_shop_id', (p->>'p_is_test')::boolean) r;`;
function bindings(overrides = {}) {
  return { p_payment_id: ids.payment, p_user_id: ids.owner, p_target_type: 'listing', p_target_id: ids.target,
    p_merchant_shop_id: '999999', p_is_test: true, ...overrides };
}
const prepare = (overrides = {}) => json(prepareSql, { ...bindings(), p_tariff_key: input.tariffId,
  p_amount: 199.99, p_purchased_duration_days: 9, p_request_body: originalBody(), ...overrides });
const authorize = (overrides = {}) => json(authorizeSql, bindings(overrides));
const snapshot = () => json(`select row_to_json(i) from private.payment_checkout_intents i where payment_id = '${ids.payment}';`);

before(async () => {
  await docker(['run', '--detach', '--pull', 'never', '--network', 'none', '--name', container,
    '--label', label, '--tmpfs', '/var/lib/postgresql/data', '--mount', `type=bind,source=${root},target=/work,readonly`,
    '-e', `POSTGRES_DB=${database}`, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17-alpine',
    '-c', 'listen_addresses=', '-c', 'timezone=UTC']);
  owned = true;
  const deadline = performance.now() + 8000;
  for (;;) {
    try { await psql('select 1;', {}, 'postgres'); break; }
    catch (error) { if (performance.now() > deadline) throw error; }
  }
  assert.match(await psql('show server_version;', {}, 'postgres'), /^17\./);
  await docker([...psqlArgs(), '-f', '/work/tests/fixtures/payment-checkout-intent.sql']);
});
after(async () => {
  if (!owned) return;
  assert.equal(await docker(['inspect', '--format', '{{index .Config.Labels "blizhniy.checkout-snapshot-test"}}', container]), 'ui_recovery');
  await docker(['rm', '--force', container]);
});
beforeEach(async () => {
  // TRUNCATE/reset is restricted to this disposable owned fixture owner.
  await psql(`truncate public.payments cascade;
    insert into auth.users (id, email) values ('${ids.owner}', 'checkout@example.invalid') on conflict do nothing;
    insert into public.profiles (id, email, display_name) values ('${ids.owner}', 'checkout@example.invalid', 'Synthetic checkout owner') on conflict do nothing;
    insert into public.tariffs (id, action, name, price, duration_days, active)
      values ('${ids.tariff}', 'listing_publication', 'Synthetic offer', 199.99, 9, true)
      on conflict (action) do update set price = 199.99, duration_days = 9, active = true;
    insert into public.payments (id, user_id, tariff_id, target_type, target_id, provider, amount, status, purchased_duration_days)
      select '${ids.payment}', '${ids.owner}', id, 'listing', '${ids.target}', 'yookassa', 199.99, 'created', 9
      from public.tariffs where action = 'listing_publication';`, {}, 'postgres');
});

test('real SQL snapshot commits exact body/hash/original financial and merchant bindings', async () => {
  const [result] = await prepare();
  const stored = await snapshot();
  assert.equal(stored.request_body, originalBody());
  assert.equal(stored.request_sha256, hash(originalBody()));
  assert.equal(stored.amount, 199.99);
  assert.equal(stored.purchased_duration_days, 9);
  assert.equal(stored.merchant_shop_id, '999999');
  assert.equal(stored.is_test, true);
  assert.equal(result.decision, 'post');
  assert.ok(Number(result.remaining_ms) > 0 && Number(result.remaining_ms) <= (23 * 60 + 55) * 60_000);
});

test('actual anon/authenticated roles cannot read snapshots or invoke either service RPC', async () => {
  await prepare();
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(psql('select request_body from private.payment_checkout_intents;', {}, role), /permission denied/);
    await assert.rejects(psql(authorizeSql, bindings(), role), /permission denied/);
    await assert.rejects(psql(prepareSql, { ...bindings(), p_request_body: originalBody() }, role), /permission denied/);
  }
  assert.equal(await psql("select has_table_privilege('authenticated', 'public.payments', 'SELECT');", {}, 'postgres'), 't');
  assert.equal(await psql("select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'payments' and column_name in ('request_body','request_sha256','merchant_shop_id');", {}, 'postgres'), '0');
  assert.equal(await psql("select bool_and(not prosecdef and proconfig @> array['search_path=\"\"']) from pg_proc where oid in ('public.prepare_yookassa_checkout_intent(uuid,uuid,text,uuid,text,numeric,integer,text,boolean,text)'::regprocedure,'public.authorize_yookassa_checkout_attempt(uuid,uuid,text,uuid,text,boolean)'::regprocedure);", {}, 'postgres'), 't');
});

test('service UPDATE/DELETE and owner snapshot replacements cannot reset bytes or time', async () => {
  await prepare();
  const before = await snapshot();
  await assert.rejects(psql('update private.payment_checkout_intents set payment_id = payment_id;'), /immutable|permission denied/);
  await assert.rejects(psql('delete from private.payment_checkout_intents;'), /immutable|permission denied/);
  for (const expression of ["request_body = '{}'", "first_attempt_authorized_at = clock_timestamp()", "merchant_shop_id = '888888'", 'is_test = false']) {
    await assert.rejects(psql(`update private.payment_checkout_intents set ${expression};`, {}, 'postgres'), /immutable/);
  }
  await assert.rejects(psql('delete from private.payment_checkout_intents;', {}, 'postgres'), /immutable/);
  assert.deepEqual(await snapshot(), before);
});

test('wrong owner/target/amount/duration preparation rolls back and leaves no private snapshot', async () => {
  for (const patch of [{ p_user_id: ids.target }, { p_target_id: ids.owner }, { p_amount: 900 }, { p_purchased_duration_days: 30 }]) {
    await assert.rejects(prepare(patch), /binding|snapshot|amount|duration/);
    assert.equal(await psql('select count(*) from private.payment_checkout_intents;'), '0');
  }
});

test('invalid full body/receipt and UTF8 request beyond 16KiB fail before insertion', async () => {
  const wrongReceipt = JSON.parse(originalBody());
  wrongReceipt.receipt.items[0].amount.value = '900.00';
  const wrongId = JSON.parse(originalBody());
  wrongId.metadata.localPaymentId = ids.owner;
  for (const body of ['{broken', JSON.stringify(wrongReceipt), JSON.stringify(wrongId), JSON.stringify({ ...wrongId, padding: 'я'.repeat(9000) })]) {
    await assert.rejects(prepare({ p_request_body: body }), /snapshot|body|receipt|json|binding|size/i);
    assert.equal(await psql('select count(*) from private.payment_checkout_intents;'), '0');
  }
});

test('merchant/test mismatch is rejected by actual SQL before recovery authorization', async () => {
  await prepare();
  await psql(`update public.payments set provider_payment_id = '${ids.provider}', status = 'pending';`);
  for (const patch of [{ p_merchant_shop_id: '888888' }, { p_is_test: false }]) {
    await assert.rejects(authorize(patch), /merchant.*binding|binding.*mismatch/i);
  }
});

test('receipt VAT rejects missing/null/non-numeric/noninteger/out-of-range JSON before snapshot commit', async () => {
  for (const value of [undefined, null, '1', 1.5, 0, 13]) {
    const body = JSON.parse(originalBody());
    if (value === undefined) delete body.receipt.items[0].vat_code;
    else body.receipt.items[0].vat_code = value;
    await assert.rejects(prepare({ p_request_body: JSON.stringify(body) }), /receipt|integer/i);
    assert.equal(await psql('select count(*) from private.payment_checkout_intents;'), '0');
  }
  await prepare();
  assert.equal(JSON.parse((await snapshot()).request_body).receipt.items[0].vat_code, 1);
});

test('first time is immutable and a repeated preparer cannot extend the replay interval', async () => {
  await prepare();
  const before = await snapshot();
  await prepare();
  assert.equal((await snapshot()).first_attempt_authorized_at, before.first_attempt_authorized_at);
  const changed = JSON.parse(originalBody()); changed.description = 'Another preparer title';
  await assert.rejects(prepare({ p_request_body: JSON.stringify(changed) }), /immutable|snapshot|binding/);
  assert.deepEqual(await snapshot(), before);
});

test('payment input freeze does not block financial updates, provider-ID adoption or settlement markers', async () => {
  await prepare();
  for (const expression of ["amount = 900", `user_id = '${ids.target}'`, `target_id = '${ids.owner}'`, "provider = 'mock'", "created_at = clock_timestamp() + interval '1 day'"]) {
    await assert.rejects(psql(`update public.payments set ${expression} where id = '${ids.payment}';`), /binding|immutable/);
  }
  await psql(`update public.payments set provider_payment_id = '${ids.provider}', status = 'succeeded', paid_at = clock_timestamp() where id = '${ids.payment}';`);
  const [result] = await authorize();
  assert.equal(result.decision, 'recover');
  assert.equal(result.financial_status, 'succeeded');
  assert.equal(result.provider_payment_id, ids.provider);
  const stored = await snapshot();
  assert.equal(stored.amount, 199.99);
  assert.equal(stored.purchased_duration_days, 9);
});

test('snapshot freeze preserves actual owner-bound fulfillment transaction and replay marker', async () => {
  await psql(`insert into public.listings (id, author_id, listing_type, region_id, city_id, category_id, title, description, status)
    select '${ids.target}', '${ids.owner}', 'sell', c.region_id, c.id, k.id, 'Synthetic target', 'Synthetic target detail', 'pending_payment'
    from public.cities c cross join public.categories k limit 1
    on conflict (id) do update set author_id = excluded.author_id, status = 'pending_payment', is_paid = false, published_at = null;`, {}, 'postgres');
  assert.equal(await psql(`select count(*) from public.listings where id = '${ids.target}';`, {}, 'postgres'), '1');
  await prepare();
  await psql(`update public.payments set provider_payment_id = '${ids.provider}', status = 'succeeded', paid_at = clock_timestamp() where id = '${ids.payment}';`);
  const sql = `select row_to_json(r) from public.apply_payment_fulfillment('${ids.payment}', '${ids.provider}') r;`;
  const first = await json(sql);
  const replay = await json(sql);
  assert.equal(first.applied_now, true);
  assert.equal(first.fulfillment_status, 'applied');
  assert.equal(replay.applied_now, false);
  assert.equal(replay.target_applied_at, first.target_applied_at);
  assert.equal((await snapshot()).request_body, originalBody());
});

// Test-only historical seeding by the isolated fixture owner. The actual
// immutable trigger is restored inside the same transaction before any RPC.
async function ageIntent(age = '25 hours') {
  await psql(`begin; alter table private.payment_checkout_intents disable trigger yookassa_checkout_intent_immutable;
    with args as (${param}) update private.payment_checkout_intents set first_attempt_authorized_at = clock_timestamp() - (p->>'age')::interval from args;
    alter table private.payment_checkout_intents enable trigger yookassa_checkout_intent_immutable; commit;`, { age }, 'postgres');
}

test('real database past-window UNKNOWN stays manual, but a known ID remains GET recoverable', async () => {
  await prepare(); await ageIntent();
  const [unknown] = await authorize();
  assert.equal(unknown.decision, 'manual');
  assert.ok(Number(unknown.remaining_ms) <= 0);
  assert.equal(await psql(`select status from public.payments where id = '${ids.payment}';`), 'created');
  await psql(`update public.payments set provider_payment_id = '${ids.provider}', status = 'pending';`);
  assert.equal((await authorize())[0].decision, 'recover');
});

test('actual legacy UNKNOWN is manual; legacy known-ID read-only exception does not invent a ledger', async () => {
  assert.equal((await authorize())[0].decision, 'manual');
  await psql(`update public.payments set provider_payment_id = '${ids.provider}', status = 'pending';`);
  assert.equal((await authorize())[0].decision, 'legacy_recover');
  assert.equal(await psql('select count(*) from private.payment_checkout_intents;'), '0');
});

function connection(name) {
  const child = spawn('docker', psqlArgs(), { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', errors = '', pending, sequence = 0;
  child.stdout.on('data', data => {
    output += data;
    if (pending && output.includes(pending.marker)) {
      const [result, tail] = output.split(pending.marker); output = tail;
      clearTimeout(pending.timer); pending.resolve(result.trim()); pending = undefined;
    }
  });
  child.stderr.on('data', data => { errors += data; });
  child.stdin.on('error', () => {});
  child.on('exit', code => { if (pending) { clearTimeout(pending.timer); pending.reject(new Error(`PG barrier exited ${code}: ${errors}`)); pending = undefined; } });
  return {
    command(statement) {
      assert.equal(Boolean(pending), false);
      output = ''; const marker = `__CHECKOUT_BARRIER_${++sequence}__`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`PG barrier timed out: ${errors}`)), 7500);
        pending = { marker, resolve, reject, timer }; child.stdin.write(`${statement}\n\\echo ${marker}\n`);
      });
    },
    async start() { await this.command(`set application_name = '${name}'; set statement_timeout = '6s'; begin; set local role service_role;`); },
    close() { child.stdin.end('\\q\n'); },
  };
}
async function waitForLock(name) {
  const deadline = performance.now() + 4000;
  while (performance.now() < deadline) {
    if (await psql(`select exists(select 1 from pg_stat_activity where datname = '${database}' and application_name = '${name}' and wait_event_type = 'Lock');`, {}, 'postgres') === 't') return;
  }
  assert.fail('Independent PG connection did not reach its lock barrier');
}

test('snapshot transaction rollback is invisible to an independent connection', async () => {
  const a = connection('snapshot-rollback');
  try {
    await a.start();
    await a.command(`select * from public.prepare_yookassa_checkout_intent('${ids.payment}', '${ids.owner}', 'listing', '${ids.target}', 'listing-publication', 199.99, 9, '999999', true, convert_from(decode('${Buffer.from(originalBody()).toString('base64')}', 'base64'), 'UTF8'));`);
    assert.equal(await psql('select count(*) from private.payment_checkout_intents;'), '0');
    await a.command('rollback;');
    assert.equal(await psql('select count(*) from private.payment_checkout_intents;'), '0');
  } finally { a.close(); }
});

test('concurrent preparers serialize on the parent and cannot replace the winning body', async () => {
  const a = connection('snapshot-first'), b = connection('snapshot-second');
  try {
    await a.start(); await b.start();
    const first = `select * from public.prepare_yookassa_checkout_intent('${ids.payment}', '${ids.owner}', 'listing', '${ids.target}', 'listing-publication', 199.99, 9, '999999', true, convert_from(decode('${Buffer.from(originalBody()).toString('base64')}', 'base64'), 'UTF8'));`;
    await a.command(first);
    const changed = originalBody().replace('Original synthetic title', 'Different preparer title');
    const waiting = assert.rejects(b.command(first.replace(Buffer.from(originalBody()).toString('base64'), Buffer.from(changed).toString('base64'))), /immutable/);
    await waitForLock('snapshot-second');
    await a.command('commit;');
    await waiting;
    assert.equal((await snapshot()).request_body, originalBody());
  } finally { a.close(); b.close(); }
});

test('parent input UPDATE waiting on a new snapshot commit observes the freeze and fails closed', async () => {
  const a = connection('snapshot-freeze-winner'), b = connection('snapshot-freeze-mutator');
  try {
    await a.start(); await b.start();
    await a.command(`select * from public.prepare_yookassa_checkout_intent('${ids.payment}', '${ids.owner}', 'listing', '${ids.target}', 'listing-publication', 199.99, 9, '999999', true, convert_from(decode('${Buffer.from(originalBody()).toString('base64')}', 'base64'), 'UTF8'));`);
    const waiting = assert.rejects(b.command(`update public.payments set amount = 900 where id = '${ids.payment}';`), /immutable|binding/);
    await waitForLock('snapshot-freeze-mutator');
    await a.command('commit;');
    await waiting;
    assert.equal((await snapshot()).amount, 199.99);
    assert.equal(await psql(`select amount from public.payments where id = '${ids.payment}';`), '199.99');
  } finally { a.close(); b.close(); }
});

test('preparer waiting on a concurrent parent input change cannot snapshot stale amount or dispatch', async () => {
  const a = connection('snapshot-input-mutator'), b = connection('snapshot-stale-preparer');
  try {
    await a.start(); await b.start();
    await a.command(`update public.payments set amount = 900 where id = '${ids.payment}';`);
    const waiting = assert.rejects(b.command(`select * from public.prepare_yookassa_checkout_intent('${ids.payment}', '${ids.owner}', 'listing', '${ids.target}', 'listing-publication', 199.99, 9, '999999', true, convert_from(decode('${Buffer.from(originalBody()).toString('base64')}', 'base64'), 'UTF8'));`), /binding|mismatch/);
    await waitForLock('snapshot-stale-preparer');
    await a.command('commit;');
    await waiting;
    assert.equal(await psql('select count(*) from private.payment_checkout_intents;'), '0');
  } finally { a.close(); b.close(); }
});

test('post-lock clock rejects authorization when a wait crosses the exclusive cutoff', async () => {
  await prepare(); await ageIntent('23 hours 54 minutes 59 seconds');
  const a = connection('snapshot-lock-holder'), b = connection('snapshot-expiry-waiter');
  try {
    await a.start(); await b.start();
    await a.command(`select id from public.payments where id = '${ids.payment}' for update;`);
    const waiting = b.command(`select decision from public.authorize_yookassa_checkout_attempt('${ids.payment}', '${ids.owner}', 'listing', '${ids.target}', '999999', true);`);
    await waitForLock('snapshot-expiry-waiter');
    const deadline = performance.now() + 3500;
    for (;;) {
      if (await psql("select clock_timestamp() >= first_attempt_authorized_at + interval '23 hours 55 minutes' from private.payment_checkout_intents;", {}, 'postgres') === 't') break;
      assert.ok(performance.now() < deadline, 'fixture database clock must cross the actual deadline');
    }
    await a.command('commit;');
    assert.equal(await waiting, 'manual');
    await b.command('commit;');
  } finally { a.close(); b.close(); }
});

// REST wire-shape adapter only: actual store/provider source executes and RPC
// bodies reach the actual SQL functions, never a copied business handler.
const realClock = () => ({ Date, performance, now: () => Date.now(), setTimeout, clearTimeout });

function actualRest({ onPrepare } = {}) {
  return async (resource, request = {}, state) => {
    const url = new URL(resource, 'http://fixture.invalid');
    const method = request.method ?? 'GET';
    if (url.pathname === '/rest/v1/rpc/prepare_yookassa_checkout_intent') {
      if (onPrepare) await onPrepare(request.body);
      return json(prepareSql, request.body);
    }
    if (url.pathname === '/rest/v1/rpc/authorize_yookassa_checkout_attempt') return json(authorizeSql, request.body);
    if (url.pathname === '/rest/v1/tariffs' && method === 'GET') return json(`select coalesce(json_agg(t), '[]'::json) from public.tariffs t where action = 'listing_publication';`);
    if (url.pathname !== '/rest/v1/payments') throw new Error(`Unsupported actual-PG REST boundary: ${method} ${url.pathname}`);
    let rows;
    if (method === 'POST') {
      rows = await json(`with args as (${param}), inserted as (insert into public.payments
        (id, user_id, tariff_id, target_type, target_id, provider, amount, status, purchased_duration_days)
        select (p->>'id')::uuid, (p->>'user_id')::uuid, (p->>'tariff_id')::uuid, p->>'target_type',
          (p->>'target_id')::uuid, p->>'provider', (p->>'amount')::numeric, (p->>'status')::public.payment_status,
          (p->>'purchased_duration_days')::integer from args returning *) select json_agg(inserted) from inserted;`, request.body);
    } else if (method === 'PATCH') {
      rows = await json(`with args as (${param}), changed as (update public.payments set
        status = (p->>'status')::public.payment_status, provider = p->>'provider',
        provider_payment_id = p->>'provider_payment_id', paid_at = (p->>'paid_at')::timestamptz
        from args where id = '${ids.payment}' returning public.payments.*) select json_agg(changed) from changed;`, request.body);
    } else {
      for (const key of url.searchParams.keys()) assert.ok(['select', 'id', 'user_id', 'target_id', 'target_type', 'status', 'limit', 'order'].includes(key), `Unknown query operator ${key}`);
      for (const key of ['id', 'user_id', 'target_id', 'target_type']) {
        if (url.searchParams.has(key)) assert.match(url.searchParams.get(key), /^eq\.[a-zA-Z0-9_-]+$/);
      }
      if (url.searchParams.has('status')) assert.equal(url.searchParams.get('status'), 'in.(created,pending)');
      if (url.searchParams.has('limit')) assert.equal(url.searchParams.get('limit'), '1');
      if (url.searchParams.has('order')) assert.equal(url.searchParams.get('order'), 'created_at.desc');
      rows = await json(`with args as (${param}) select coalesce(json_agg(t), '[]'::json) from public.payments t, args
        where (not (p ? 'status') or t.status in ('created','pending'))
          and (not (p ? 'id') or t.id::text = substring(p->>'id' from 4))
          and (not (p ? 'user_id') or t.user_id::text = substring(p->>'user_id' from 4))
          and (not (p ? 'target_id') or t.target_id::text = substring(p->>'target_id' from 4))
          and (not (p ? 'target_type') or t.target_type = substring(p->>'target_type' from 4));`, Object.fromEntries(url.searchParams));
    }
    if (rows?.[0]) state.row = rows[0];
    return rows ?? [];
  };
}

test('whole provider/store modules see committed actual PG snapshot from a separate connection at POST', async () => {
  await psql('truncate public.payments cascade;', {}, 'postgres');
  const h = harness({ clock: realClock(), rest: actualRest(), vendor: async (entry, _request, state) => {
    state.visibleSnapshot = await snapshot();
    return new Response(JSON.stringify({ id: ids.provider, status: 'pending', paid: false, test: true,
      amount: { value: '199.99', currency: 'RUB' }, metadata: JSON.parse(entry.body).metadata }));
  } });
  await h.server().provider.createPayment(input);
  assert.equal(h.state.visibleSnapshot.request_body, h.state.providerRequests[0].body);
  assert.equal(h.state.visibleSnapshot.request_sha256, hash(h.state.providerRequests[0].body));
});

test('actual modules plus SQL retain full bytes across a fresh graph and current receipt/title/site drift', async () => {
  await prepare();
  const h = harness({ clock: realClock(), rest: actualRest() });
  await h.server({ YOOKASSA_RECEIPTS_ENABLED: 'false', YOOKASSA_RECEIPT_VAT_CODE: 'invalid', NEXT_PUBLIC_SITE_URL: 'https://different.invalid' })
    .provider.createPayment({ ...input, targetTitle: 'Different title', customerEmail: 'different@example.invalid' });
  assert.equal(h.state.providerRequests[0].body, originalBody());
});

test('new creator vs separate losing graph cannot prepare or reconstruct the winners missing body', async () => {
  await psql('truncate public.payments cascade;', {}, 'postgres');
  let entered, release;
  const observed = new Promise(resolve => { entered = resolve; });
  const barrier = new Promise(resolve => { release = resolve; });
  let preparations = 0;
  const h = harness({ clock: realClock(), rest: actualRest({ onPrepare: async () => {
    preparations++; entered(); await barrier;
  } }) });
  const first = h.server().provider.createPayment(input);
  await observed;
  try {
    await assert.rejects(h.server({}, { paymentId: '66666666-6666-4666-8666-666666666666' })
      .provider.createPayment({ ...input, customerEmail: 'loser@example.invalid', targetTitle: 'Losing graph title' }), /manual|verification/i);
    assert.equal(preparations, 1);
    assert.equal(h.state.providerRequests.length, 0);
    assert.equal(await psql('select count(*) from public.payments;'), '1');
    assert.equal(await psql('select count(*) from private.payment_checkout_intents;'), '0');
  } finally { release(); }
  await first;
  const winningBody = (await snapshot()).request_body;
  await h.server({ YOOKASSA_RECEIPTS_ENABLED: 'false' }, { paymentId: '66666666-6666-4666-8666-666666666666' })
    .provider.createPayment({ ...input, customerEmail: 'loser@example.invalid', targetTitle: 'Losing graph title' });
  assert.equal(preparations, 1);
  assert.equal(h.state.providerRequests[0].body, winningBody);
  assert.equal(h.state.providerRequests.length, 2);
  assert.equal(h.state.providerRequests[1].method, 'GET');
});

test('synthetic remote-created/truncated response then real-PG >24h intent never receives another POST', async () => {
  await psql('truncate public.payments cascade;', {}, 'postgres');
  let lost = true;
  const h = harness({ clock: realClock(), rest: actualRest(), vendor: async (entry, _request, state) => {
    state.remote.set(entry.key, entry.body);
    if (lost) return new Response('{truncated');
    return new Response(JSON.stringify({ id: ids.provider, status: 'pending', paid: false, test: true,
      amount: { value: '199.99', currency: 'RUB' } }));
  } });
  await assert.rejects(h.server().provider.createPayment(input), /invalid JSON|YooKassa/i);
  assert.equal(h.state.providerRequests.length, 1);
  await ageIntent(); lost = false;
  await assert.rejects(h.server().provider.createPayment(input), /manual|verification|reconciliation/i);
  assert.equal(h.state.providerRequests.length, 1);
  assert.equal(await psql('select count(*) from public.payments;'), '1');
  assert.equal(await psql('select status from public.payments;'), 'created');
});
