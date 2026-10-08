import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test, { after, before, beforeEach } from 'node:test';

// Explicit opt-in only. Actual PostgreSQL SQL/grants/RLS/locks, synthetic Auth.
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const { harness } = require('./payment-checkout-intent.test.cjs');
const run = promisify(execFile);
const image = 'sha256:1bea307dfb3ee30541a7acf7de14b58bcd6948da98e5d31a04c627c4d35ec64b';
const container = 'blizhniy-payment-lifecycle-pg17-20261008';
const database = 'blizhniy_payment_lifecycle_fixture';
const labelKey = 'blizhniy.payment-lifecycle';
const labelValue = `publication_restore_followup-${process.pid}`;
const childEnv = { PATH: process.env.PATH, LANG: 'C.UTF-8' };
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1), other = id(2);
let containerId;
const docker = async args => (await run('docker', args, { env: childEnv, timeout: 15_000, maxBuffer: 2 * 1024 * 1024 })).stdout.trim();
const psqlArgs = (params = {}) => ['exec', '-i', containerId, 'psql', '-X', '-q', '-A', '-t',
  '-v', 'ON_ERROR_STOP=1', '-v', `fixture_params=${Buffer.from(JSON.stringify(params)).toString('base64')}`,
  '-U', 'postgres', '-d', database];
function sql(statement, params = {}, role = 'service_role', actor = owner) {
  assert.ok(['postgres', 'service_role', 'anon', 'authenticated'].includes(role));
  assert.match(actor, /^[a-f0-9-]{36}$/);
  return new Promise((resolve, reject) => {
    const child = spawn('docker', psqlArgs(params), { env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', errors = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Owned fixture statement timed out')); }, 10_000);
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { errors += data; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); if (code === 0) resolve(output.trim()); else reject(new Error(errors.trim())); });
    child.stdin.end(`set statement_timeout='6s'; set role ${role}; set request.jwt.claim.sub='${actor}';\n${statement}\n`);
  });
}
const json = async (statement, params, role, actor) => JSON.parse(await sql(statement, params, role, actor));
const arg = "select convert_from(decode(:'fixture_params','base64'),'UTF8')::jsonb as p";
const prepareSql = `with args as (${arg}) select json_agg(r) from args, lateral public.prepare_yookassa_checkout_intent(
  (p->>'payment')::uuid,(p->>'owner')::uuid,p->>'type',(p->>'target')::uuid,p->>'key',(p->>'amount')::numeric,
  (p->>'duration')::integer,p->>'merchant',(p->>'isTest')::boolean,p->>'body') r;`;
const authorizeSql = `with args as (${arg}) select json_agg(r) from args, lateral public.authorize_yookassa_checkout_attempt(
  (p->>'payment')::uuid,(p->>'owner')::uuid,p->>'type',(p->>'target')::uuid,p->>'merchant',(p->>'isTest')::boolean) r;`;
const applySql = p => `select row_to_json(r) from public.apply_payment_fulfillment('${p.payment}','${p.provider}') r;`;
const row = (table, target) => json(`select row_to_json(t) from public.${table} t where id='${target}';`);
const intent = payment => json(`select row_to_json(i) from private.payment_checkout_intents i where payment_id='${payment}';`);
const effects = target => json(`select coalesce(json_agg(e),'[]') from private.integration_effects e where target_id='${target}';`);

before(async () => {
  // Resolve all real source files before starting Docker; never silently fetch a sibling tree.
  const fixture = readFileSync(new URL('fixtures/payment-lifecycle-integration.sql', import.meta.url), 'utf8');
  const migrations = [...fixture.matchAll(/^\\ir \.\.\/\.\.\/supabase\/migrations\/(.+)$/gm)].map(match => match[1]);
  assert.equal(migrations.length, 16);
  assert.deepEqual(migrations, [...migrations].sort());
  for (const migration of migrations) readFileSync(new URL(`../supabase/migrations/${migration}`, import.meta.url));
  assert.equal(createHash('sha256').update(readFileSync(new URL('../supabase/migrations/20261008062202_snapshot_yookassa_checkout_intents.sql', import.meta.url))).digest('hex'),
    '33a7c240e9027711f146fbd50ab8dd0f305e300b1495ef427ee3867ee72a56c3');
  containerId = await docker(['run', '--detach', '--pull', 'never', '--network', 'none', '--name', container,
    '--label', `${labelKey}=${labelValue}`, '--tmpfs', '/var/lib/postgresql/data', '--mount', `type=bind,source=${root},target=/work,readonly`,
    '-e', `POSTGRES_DB=${database}`, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', image, '-c', 'listen_addresses=', '-c', 'timezone=UTC']);
  assert.match(containerId, /^[a-f0-9]{64}$/);
  const deadline = performance.now() + 8000;
  for (;;) { try { await sql('select 1;', {}, 'postgres'); break; } catch (error) { if (performance.now() > deadline) throw error; } }
  assert.match(await sql('show server_version;', {}, 'postgres'), /^17\./);
  await docker([...psqlArgs(), '-f', '/work/tests/fixtures/payment-lifecycle-integration.sql']);
});
after(async () => {
  if (!containerId) return;
  assert.equal(await docker(['inspect', '--format', `{{index .Config.Labels "${labelKey}"}}`, containerId]), labelValue);
  await docker(['rm', '--force', containerId]);
});
beforeEach(async () => {
  // Owner-only TRUNCATE is a disposable fixture reset, never an operational purge.
  await sql(`drop trigger if exists integration_notification_failure on public.notifications;
    truncate private.payment_checkout_intents, public.payments, public.notifications, public.listings,
      public.vacancies, public.work_requests, public.applications, public.fair_applications, public.ad_marquee_placements cascade;
    truncate private.integration_effects;`, {}, 'postgres');
});

async function listing(target = id(10), author = owner) {
  await sql(`insert into public.listings(id,author_id,listing_type,category_id,region_id,city_id,title,description,status,contact_phone,address)
    select '${target}','${author}','sell','${id(3)}',region_id,id,'Synthetic listing','Fixture only','pending_payment',
      'Synthetic private phone','Synthetic private street' from public.cities limit 1;`);
  return target;
}
async function newPayment(type, target, n = 100, payer = owner, action = 'listing_publication', duration) {
  const payment = id(n), provider = `synthetic-integration-${n}`;
  await sql(`insert into public.payments(id,user_id,tariff_id,target_type,target_id,provider,amount,status,purchased_duration_days)
    select '${payment}','${payer}',id,'${type}','${target}','yookassa',price,'created',${duration === undefined ? 'duration_days' : duration ?? 'null'}
    from public.tariffs where action='${action}';`);
  const stored = await row('payments', payment);
  assert.ok(stored, 'actual purchased offer must exist');
  const p = { payment, provider, owner: payer, type, target, key: action.replaceAll('_', '-'), amount: stored.amount,
    duration: stored.purchased_duration_days, merchant: '999999', isTest: true };
  p.body = JSON.stringify({ amount: { value: Number(p.amount).toFixed(2), currency: 'RUB' }, capture: true,
    confirmation: { type: 'redirect', return_url: `https://synthetic.example.invalid/oplata/${payment}` },
    description: 'Synthetic checkout', metadata: { localPaymentId: payment, targetType: type, targetId: target, tariffId: p.key },
    receipt: { customer: { email: 'synthetic-payer@example.invalid' }, internet: true, items: [{
      amount: { value: Number(p.amount).toFixed(2), currency: 'RUB' }, description: 'Synthetic service',
      payment_mode: 'full_payment', payment_subject: 'service', quantity: 1, vat_code: 1 }] } });
  return p;
}
async function prepare(p) { return (await json(prepareSql, p))[0]; }
async function authorize(p) { return (await json(authorizeSql, p))[0]; }
async function adopt(p) { await sql(`update public.payments set provider_payment_id='${p.provider}',status='pending' where id='${p.payment}';`); }
async function settle(p, capture = 'clock_timestamp()') {
  // Synthetic already-verified provider boundary; fulfillment never invents success.
  await sql(`update public.payments set status='succeeded',paid_at=${capture} where id='${p.payment}';`);
}
const fulfill = p => json(applySql(p));
const targetKinds = {
  listing: { type: 'listing', table: 'listings', action: 'listing_publication' },
  vacancy: { type: 'vacancy', table: 'vacancies', action: 'vacancy_publication' },
  workRequest: { type: 'workRequest', table: 'work_requests', action: 'work_request_publication' },
  fair: { type: 'fair_application', table: 'fair_applications', action: 'fair_participation' },
  marquee: { type: 'ad_marquee', table: 'ad_marquee_placements', action: 'ad_marquee' },
  vacancyResponse: { type: 'application', table: 'applications', action: 'job_response', parent: 'vacancy' },
  workResponse: { type: 'application', table: 'applications', action: 'job_response', parent: 'workRequest' },
};
const restoreName = { listing: 'restore_listing_within_paid_window', vacancy: 'restore_vacancy_within_paid_window', workRequest: 'restore_work_request_within_paid_window' };
const restoreSql = (kind, target, actor = owner) => `select coalesce(json_agg(json_build_object('id',r.id)),'[]') from public.${restoreName[kind]}('${target}','${actor}') r;`;
const restore = (kind, target, actor) => json(restoreSql(kind, target, actor));
const reconcile = () => json("select coalesce(json_agg(json_build_object('id',r.id)),'[]') from public.reconcile_ad_marquee_queue() r;");
const moderateSql = (target, state = 'pending_payment') => `select public.moderate_ad_marquee_placement('${target}','${state}',0,null);`;
async function complete(p, capture) { await prepare(p); await adopt(p); await settle(p, capture); return fulfill(p); }
async function createTarget(kind, n = 10, { approve = true, author = owner, nearExpiryParent = false } = {}) {
  const target = id(n), spec = targetKinds[kind];
  assert.ok(spec);
  if (kind === 'listing') await listing(target, author);
  else if (kind === 'vacancy') await sql(`insert into public.vacancies(id,author_id,organization_name,title,description,region_id,city_id,status,contact_phone,address)
    select '${target}','${author}','Synthetic employer','Synthetic vacancy','Fixture only',region_id,id,'pending_payment',
      'Synthetic private phone','Synthetic private street' from public.cities limit 1;`);
  else if (kind === 'workRequest') await sql(`insert into public.work_requests(id,author_id,title,description,region_id,city_id,status,contact_phone,address)
    select '${target}','${author}','Synthetic work','Fixture only',region_id,id,'pending_payment',
      'Synthetic private phone','Synthetic private street' from public.cities limit 1;`);
  else if (kind === 'fair') await sql(`insert into public.fair_applications(id,user_id,participant_name,fair_category,description,contact_phone,email,status,address)
    values('${target}','${author}','Synthetic participant','Synthetic category','Fixture only','Synthetic private phone',
      'synthetic-fair@example.invalid','pending_payment','Synthetic private street');`);
  else if (kind === 'marquee') {
    await sql(`insert into public.ad_marquee_placements(id,user_id,text) values('${target}','${author}','Synthetic integrated marquee');`);
    if (approve) assert.equal((await json(moderateSql(target))).changed, true);
  } else {
    const parent = await createTarget(spec.parent, n + 200);
    const parentSpec = targetKinds[spec.parent];
    const parentPayment = await newPayment(parentSpec.type, parent, n + 300, owner, parentSpec.action);
    const parentCapture = nearExpiryParent ? `clock_timestamp()-${parentPayment.duration}*interval '24 hours'+interval '2 seconds'` : undefined;
    assert.equal((await complete(parentPayment, parentCapture)).fulfillment_status, 'applied');
    await sql(`insert into public.applications(id,applicant_user_id,${spec.parent === 'vacancy' ? 'vacancy_id' : 'work_request_id'},message,specialist_phone)
      values('${target}','${other}','${parent}','Synthetic response','Synthetic response private phone');`);
  }
  return target;
}

const rpcSignatures = [
  'apply_payment_fulfillment(uuid,text)', 'reconcile_ad_marquee_queue()', 'moderate_ad_marquee_placement(uuid,text,integer,text)',
  'restore_work_request_within_paid_window(uuid,uuid)', 'restore_listing_within_paid_window(uuid,uuid)', 'restore_vacancy_within_paid_window(uuid,uuid)',
  'prepare_yookassa_checkout_intent(uuid,uuid,text,uuid,text,numeric,integer,text,boolean,text)',
  'authorize_yookassa_checkout_attempt(uuid,uuid,text,uuid,text,boolean)',
];
const rpcCalls = [applySql({ payment: id(100), provider: 'synthetic' }), 'select public.reconcile_ad_marquee_queue();', moderateSql(id(10)),
  restoreSql('workRequest', id(10)), restoreSql('listing', id(10)), restoreSql('vacancy', id(10)), prepareSql, authorizeSql];

test('combined ordered bootstrap preserves legacy unknowns without creating checkout history', async () => {
  const before = await json('select row_to_json(h) from private.integration_history_before h;');
  const after = await json('select row_to_json(h) from private.integration_history_after h;');
  assert.deepEqual(Object.fromEntries(Object.entries(after.work_request).filter(([key]) => !['is_paid','expires_at'].includes(key))), before.work_request);
  assert.equal(after.work_request.is_paid, false); assert.equal(after.work_request.expires_at, null);
  assert.equal(after.payment.paid_at, null); assert.equal(after.payment.purchased_duration_days, null);
  assert.equal(await sql('select count(*) from private.payment_checkout_intents;'), '0');
});

test('first real combined lifecycle commits exact intent, adoption, financial truth and one listing fulfillment', async () => {
  const target = await listing(), p = await newPayment('listing', target);
  assert.equal((await prepare(p)).decision, 'post');
  const original = await intent(p.payment);
  assert.equal(original.request_body, p.body);
  assert.equal(original.request_sha256, createHash('sha256').update(p.body).digest('hex'));
  await adopt(p); assert.equal((await authorize(p)).decision, 'recover');
  assert.equal((await fulfill(p)).applied_now, false); assert.equal((await row('listings', target)).status, 'pending_payment');
  await settle(p);
  const first = await fulfill(p), replay = await fulfill(p);
  assert.equal(first.applied_now, true); assert.equal(first.fulfillment_status, 'applied');
  assert.equal(replay.applied_now, false); assert.equal(replay.target_applied_at, first.target_applied_at);
  assert.equal((await row('listings', target)).published_at, first.paid_at);
  assert.equal((await effects(target)).length, 1);
  assert.deepEqual(await intent(p.payment), original);
});

test('all eight real public RPCs remain invoker/empty-search-path/service-only after combined migrations', async () => {
  assert.equal(rpcSignatures.length, 8);
  for (const signature of rpcSignatures) {
    const meta = await json(`select row_to_json(m) from (select p.prosecdef,p.proconfig,
      has_function_privilege('service_role',p.oid,'EXECUTE') service,
      has_function_privilege('authenticated',p.oid,'EXECUTE') browser,
      has_function_privilege('anon',p.oid,'EXECUTE') anon
      from pg_proc p where oid='public.${signature}'::regprocedure) m;`);
    assert.equal(meta.prosecdef, false); assert.ok(meta.proconfig.includes('search_path=""'));
    assert.equal(meta.service, true); assert.equal(meta.browser, false); assert.equal(meta.anon, false);
  }
  for (const role of ['anon', 'authenticated']) for (const call of rpcCalls) {
    await assert.rejects(sql(call, {}, role), /permission denied for function/);
  }
  assert.deepEqual(await reconcile(), []); // Normal service positive, not only catalog metadata.
});

test('actual RLS preserves own-payment browser SELECT without exposing another owner or private snapshot', async () => {
  const p = await newPayment('listing', await listing()); await prepare(p);
  assert.equal(await sql(`select auth.uid();`, {}, 'authenticated', owner), owner);
  assert.equal(await sql(`select count(*) from public.payments where id='${p.payment}';`, {}, 'authenticated', owner), '1');
  assert.equal(await sql(`select count(*) from public.payments where id='${p.payment}';`, {}, 'authenticated', other), '0');
  const browserRow = await json(`select row_to_json(p) from public.payments p where id='${p.payment}';`, {}, 'authenticated', owner);
  for (const secret of ['request_body', 'request_sha256', 'merchant_shop_id', 'first_attempt_authorized_at', 'receipt']) assert.equal(Object.hasOwn(browserRow, secret), false);
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(sql('select request_body from private.payment_checkout_intents;', {}, role), /permission denied/);
    await assert.rejects(sql('insert into private.payment_checkout_intents(payment_id) values(null);', {}, role), /permission denied/);
    await assert.rejects(sql(`update public.payments set status='succeeded' where id='${p.payment}';`, {}, role), /permission denied/);
  }
  assert.equal(await sql(`select count(*) from information_schema.columns where table_schema='public' and table_name='payments'
    and column_name in ('request_body','request_sha256','merchant_shop_id','first_attempt_authorized_at');`, {}, 'postgres'), '0');
});

for (const kind of Object.keys(targetKinds)) test(`combined intent→adoption→settlement→fulfillment/replay: ${kind}`, async () => {
  const spec = targetKinds[kind], target = await createTarget(kind);
  const p = await newPayment(spec.type, target, 100, spec.parent ? other : owner, spec.action);
  await prepare(p); const originalIntent = await intent(p.payment);
  await adopt(p); assert.equal((await authorize(p)).decision, 'recover');
  assert.equal((await fulfill(p)).applied_now, false);
  // Start the fulfillment observation AFTER real moderation, which itself writes.
  await sql(`delete from private.integration_effects where target_id='${target}';`);
  await settle(p, "clock_timestamp() - interval '1 minute'");
  // A new offer is not financial evidence for this already-committed checkout.
  await sql(`update public.tariffs set price=price+123,duration_days=365 where action='${spec.action}';`);
  try {
    const first = await fulfill(p), firstTarget = await row(spec.table, target), firstPayment = await row('payments', p.payment);
    assert.equal(first.applied_now, true); assert.equal(first.fulfillment_status, 'applied');
    assert.equal((await authorize(p)).financial_status, 'succeeded');
    assert.equal(firstTarget.status, spec.parent ? 'sent' : kind === 'marquee' ? 'paid' : 'published');
    if (['listing', 'vacancy', 'workRequest'].includes(kind)) {
      assert.equal(firstTarget.published_at, first.paid_at);
      assert.equal(await sql(`select t.expires_at=p.paid_at+p.purchased_duration_days*interval '24 hours'
        from public.${spec.table} t join public.payments p on p.target_id=t.id where p.id='${p.payment}';`), 't');
    }
    if (spec.parent) {
      const notices = await json(`select json_agg(n) from public.notifications n where payment_id='${p.payment}';`);
      assert.equal(notices.length, 1); assert.equal(notices[0].user_id, owner); assert.equal(notices[0].event, 'application_paid');
      assert.equal(firstTarget.sent_at, first.paid_at);
    }
    const effectsBefore = await effects(target);
    assert.equal(effectsBefore.length, 1);
    assert.equal((await fulfill(p)).applied_now, false);
    assert.deepEqual(await row(spec.table, target), firstTarget); assert.deepEqual(await row('payments', p.payment), firstPayment);
    assert.deepEqual(await effects(target), effectsBefore); assert.deepEqual(await intent(p.payment), originalIntent);
    if (restoreName[kind]) {
      await sql(`update public.${spec.table} set status='${kind === 'listing' ? 'sold' : 'archived'}' where id='${target}';`);
      const beforeRestore = await row(spec.table, target);
      assert.deepEqual(await restore(kind, target), [{ id: target }]);
      const restored = await row(spec.table, target);
      assert.equal(restored.status, 'published'); assert.equal(restored.expires_at, beforeRestore.expires_at);
      if (kind === 'workRequest') assert.equal(restored.published_at, beforeRestore.published_at);
      else assert.ok(Date.parse(restored.published_at) > Date.parse(beforeRestore.published_at));
      assert.deepEqual(await row('payments', p.payment), firstPayment); assert.deepEqual(await intent(p.payment), originalIntent);
      const restoredEffects = await effects(target);
      assert.deepEqual(await restore(kind, target), []); assert.deepEqual(await effects(target), restoredEffects);
    } else if (kind === 'marquee') {
      assert.equal(firstTarget.starts_at, null); assert.equal(firstTarget.ends_at, null);
      assert.deepEqual(await reconcile(), [{ id: target }]);
      const active = await row(spec.table, target);
      assert.equal(active.status, 'active');
      assert.equal(await sql(`select ends_at=starts_at+${p.duration}*interval '24 hours' from public.ad_marquee_placements where id='${target}';`), 't');
      await reconcile(); await fulfill(p);
      assert.deepEqual(await row(spec.table, target), active); assert.deepEqual(await intent(p.payment), originalIntent);
    }
  } finally {
    await sql(`update public.tariffs set price=${p.amount},duration_days=${p.duration ?? 'null'} where action='${spec.action}';`);
  }
});

test('published raw contacts/location stay denied to both browser roles under actual privacy grants', async () => {
  for (const [index, kind] of ['listing', 'vacancy', 'workRequest', 'fair'].entries()) {
    const spec = targetKinds[kind], target = await createTarget(kind, 10 + index);
    await complete(await newPayment(spec.type, target, 100 + index, owner, spec.action));
    const paid = await row(spec.table, target);
    assert.equal(paid.status, 'published'); assert.equal(paid.contact_phone, 'Synthetic private phone');
  }
  for (const table of ['listings', 'vacancies', 'work_requests', 'fair_applications', 'specialist_profiles']) {
    for (const role of ['anon', 'authenticated']) {
      assert.equal(await sql(`select has_table_privilege('${role}','public.${table}','SELECT');`, {}, 'postgres'), 'f');
      await assert.rejects(sql(`select contact_phone,address from public.${table} where status='published';`, {}, role), /permission denied/);
    }
    assert.equal(await sql(`select has_table_privilege('service_role','public.${table}','SELECT');`, {}, 'postgres'), 't');
  }
});

test('container name collision leaves the running owned fixture ID and label untouched', async () => {
  const inspect = () => docker(['inspect', '--format', '{{.Id}} {{.State.Running}}', containerId]);
  const original = await inspect();
  await assert.rejects(docker(['run', '--detach', '--pull', 'never', '--network', 'none', '--name', container, image]), error => {
    assert.match(error.stderr, /already in use/); return true;
  });
  assert.equal(await inspect(), original);
  assert.equal(await docker(['inspect', '--format', `{{index .Config.Labels "${labelKey}"}}`, containerId]), labelValue);
});

for (const [name, type, patch, capture, duration, reason] of [
  ['unknown capture', 'listing', null, 'null', undefined, 'payment_missing_paid_at'],
  ['unknown duration', 'listing', null, 'clock_timestamp()', null, 'duration_missing'],
  ['elapsed captured window', 'listing', null, "clock_timestamp()-interval '400 days'", undefined, 'entitlement_expired'],
  ['changed current owner', 'listing', `author_id='${other}'`, 'clock_timestamp()', undefined, 'target_owner_mismatch'],
  ['moderation rejection', 'listing', "status='rejected'", 'clock_timestamp()', undefined, 'target_not_eligible'],
  ['removed target', 'listing', 'delete', 'clock_timestamp()', undefined, 'target_missing'],
  ['unsupported specialist', 'specialist', null, 'clock_timestamp()', undefined, 'unsupported_target_type'],
]) test(`complete checkout remains financially succeeded/sticky-blocked for ${name}`, async () => {
  const target = await listing(), p = await newPayment(type, target, 100, owner, 'listing_publication', duration);
  await prepare(p); const originalIntent = await intent(p.payment);
  await adopt(p); await settle(p, capture);
  if (patch) await sql(patch === 'delete' ? `delete from public.listings where id='${target}';` : `update public.listings set ${patch} where id='${target}';`);
  const targetBefore = patch === 'delete' ? null : await row('listings', target);
  await sql(`delete from private.integration_effects where target_id='${target}';`);
  const result = await fulfill(p), blocked = await row('payments', p.payment);
  assert.equal(result.financial_status, 'succeeded'); assert.equal(result.fulfillment_status, 'blocked'); assert.equal(result.fulfillment_reason, reason);
  assert.equal(result.target_applied_at, null); assert.equal(result.applied_now, false);
  // Ordinary stale settlement cannot invent a capture, reset blocked or republish.
  await sql(`update public.payments set status='pending',paid_at=clock_timestamp(),fulfillment_status='pending',fulfillment_reason=null
    where id='${p.payment}';`);
  assert.equal((await fulfill(p)).applied_now, false); assert.deepEqual(await row('payments', p.payment), blocked);
  if (targetBefore) assert.deepEqual(await row('listings', target), targetBefore);
  assert.deepEqual(await effects(target), []); assert.deepEqual(await intent(p.payment), originalIntent);
});

test('input freeze and settlement guard coexist without allowing ledger replacement or resetting applied truth', async () => {
  const target = await listing(), p = await newPayment('listing', target);
  await complete(p);
  const beforePayment = await row('payments', p.payment), beforeTarget = await row('listings', target), originalIntent = await intent(p.payment);
  for (const patch of ['amount=900', `user_id='${other}'`, `target_id='${id(99)}'`, 'purchased_duration_days=365', "provider='mock'"]) {
    await assert.rejects(sql(`update public.payments set ${patch} where id='${p.payment}';`), /immutable/);
  }
  await assert.rejects(sql('update private.payment_checkout_intents set payment_id=payment_id;'), /immutable/);
  await assert.rejects(sql('delete from private.payment_checkout_intents;'), /permission denied/);
  await assert.rejects(sql(`delete from public.payments where id='${p.payment}';`), /foreign key constraint/);
  await sql(`update public.payments set status='pending',paid_at=clock_timestamp()+interval '1 day',target_applied_at=null,
    fulfillment_status='pending',fulfillment_reason=null where id='${p.payment}';`);
  assert.deepEqual(await row('payments', p.payment), beforePayment); assert.deepEqual(await row('listings', target), beforeTarget);
  assert.deepEqual(await intent(p.payment), originalIntent);
  await assert.rejects(json(applySql({ ...p, provider: 'wrong-provider-binding' })), /provider binding mismatch/);
  assert.deepEqual(await row('payments', p.payment), beforePayment);
});

test('work restore keeps its applied financial provenance gate after intent integration and refund', async () => {
  const target = await createTarget('workRequest'), p = await newPayment('workRequest', target, 100, owner, 'work_request_publication');
  await complete(p); await sql(`update public.work_requests set status='archived' where id='${target}';`);
  await sql(`update public.payments set status='refunded' where id='${p.payment}';`);
  const originalIntent = await intent(p.payment), before = await row('work_requests', target), refunded = await row('payments', p.payment);
  assert.deepEqual(await restore('workRequest', target), []); assert.deepEqual(await row('work_requests', target), before);
  assert.equal((await fulfill(p)).financial_status, 'refunded'); assert.deepEqual(await row('payments', p.payment), refunded);
  assert.deepEqual(await intent(p.payment), originalIntent);
});

test('notification SQL failure rolls back target/notice/marker while committed financial success and intent survive', async () => {
  const target = await createTarget('workResponse'), p = await newPayment('application', target, 100, other, 'job_response');
  await prepare(p); await adopt(p); await settle(p);
  const originalIntent = await intent(p.payment), paidBefore = await row('payments', p.payment), targetBefore = await row('applications', target);
  await sql(`create trigger integration_notification_failure before insert on public.notifications
    for each row execute function private.fail_integration_notification();`, {}, 'postgres');
  await assert.rejects(fulfill(p), /synthetic integration notification failure/);
  assert.deepEqual(await row('payments', p.payment), paidBefore); assert.deepEqual(await row('applications', target), targetBefore);
  assert.equal(await sql(`select count(*) from public.notifications where payment_id='${p.payment}';`), '0');
  assert.deepEqual(await effects(target), []); assert.deepEqual(await intent(p.payment), originalIntent);
  await sql('drop trigger integration_notification_failure on public.notifications;', {}, 'postgres');
  assert.equal((await fulfill(p)).applied_now, true); assert.equal((await fulfill(p)).applied_now, false);
  assert.equal(await sql(`select count(*) from public.notifications where payment_id='${p.payment}';`), '1');
});

async function waitDatabaseClock(predicate) {
  const deadline = performance.now() + 4500;
  while (await sql(`select ${predicate};`) !== 't') assert.ok(performance.now() < deadline, 'fixture database clock must reach the real deadline');
}
for (const kind of ['listing', 'vacancy', 'workRequest']) test(`actual maintenance expires ${kind} without changing original dates or financial/private history`, async () => {
  const spec = targetKinds[kind], target = await createTarget(kind), p = await newPayment(spec.type, target, 100, owner, spec.action);
  assert.equal((await complete(p, `clock_timestamp()-${p.duration}*interval '24 hours'+interval '2 seconds'`)).applied_now, true);
  const before = await row(spec.table, target), beforePayment = await row('payments', p.payment), originalIntent = await intent(p.payment);
  await waitDatabaseClock(`clock_timestamp()>=(select expires_at from public.${spec.table} where id='${target}')`);
  await docker([...psqlArgs(), '--single-transaction', '-c', 'set role service_role;', '-f', '/work/supabase/maintenance/reconcile-expired-publications.sql']);
  const expired = await row(spec.table, target);
  assert.equal(expired.status, 'expired'); assert.equal(expired.expires_at, before.expires_at); assert.equal(expired.published_at, before.published_at);
  assert.deepEqual(await row('payments', p.payment), beforePayment); assert.deepEqual(await intent(p.payment), originalIntent);
  assert.deepEqual(await restore(kind, target), []);
});

test('six actual paid marquee checkouts retain capacity and original windows without guard bypass', async () => {
  const originalIntents = [], payments = [];
  for (let index = 0; index < 6; index++) {
    const target = await createTarget('marquee', 10 + index), p = await newPayment('ad_marquee', target, 100 + index, owner, 'ad_marquee');
    assert.equal((await complete(p)).applied_now, true); originalIntents.push(await intent(p.payment)); payments.push(p);
  }
  const first = await reconcile(); assert.equal(first.length, 5);
  const active = await Promise.all(first.map(t => row('ad_marquee_placements', t.id)));
  const waiting = payments.find(p => !first.some(t => t.id === p.target));
  assert.equal((await row('ad_marquee_placements', waiting.target)).status, 'paid');
  assert.equal((await row('ad_marquee_placements', waiting.target)).starts_at, null);
  await json(moderateSql(first[0].id, 'archived'));
  const next = await reconcile(); assert.equal(next.length, 5); assert.ok(next.some(t => t.id === waiting.target));
  for (const original of active) {
    const current = await row('ad_marquee_placements', original.id);
    assert.equal(current.starts_at, original.starts_at); assert.equal(current.ends_at, original.ends_at);
  }
  for (const [index, p] of payments.entries()) assert.deepEqual(await intent(p.payment), originalIntents[index]);
  assert.equal(await sql("select tgenabled from pg_trigger where tgname='ad_marquee_queue_guard';"), 'O');
});

function connection(name, params = {}) {
  assert.match(name, /^[a-z0-9_-]+$/);
  const child = spawn('docker', psqlArgs(params), { env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] });
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
  const failed = error => { if (pending) { clearTimeout(pending.timer); pending.reject(error); pending = undefined; } };
  child.on('error', failed);
  child.on('exit', code => failed(new Error(`Independent fixture connection exited ${code}: ${errors}`)));
  return {
    command(statement) {
      assert.equal(Boolean(pending), false); output = '';
      return new Promise((resolve, reject) => {
        const marker = `__LIFECYCLE_BARRIER_${++sequence}__`;
        const timer = setTimeout(() => { failed(new Error(`Independent fixture barrier timed out: ${errors}`)); child.kill('SIGTERM'); }, 8500);
        pending = { marker, timer, resolve, reject }; child.stdin.write(`${statement}\n\\echo ${marker}\n`);
      });
    },
    start() { return this.command(`set application_name='${name}'; set statement_timeout='6s'; begin; set local role service_role;`); },
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      await new Promise(resolve => { child.once('exit', resolve); child.stdin.end('\\q\n'); });
    },
  };
}
async function waitForLock(name) {
  const deadline = performance.now() + 4000;
  for (;;) {
    const waiting = await json(`select coalesce(json_agg(json_build_object('pid',pid,'blockers',pg_blocking_pids(pid))),'[]')
      from pg_stat_activity where datname='${database}' and application_name='${name}' and wait_event_type='Lock';`, {}, 'postgres');
    if (waiting.length) { assert.ok(waiting[0].blockers.length > 0); return waiting[0].pid; }
    assert.ok(performance.now() < deadline, `${name} must reach an actual PostgreSQL lock wait`);
  }
}
const queueSql = "select coalesce(json_agg(json_build_object('id',r.id)),'[]') from public.reconcile_ad_marquee_queue() r;";

for (const commit of [true, false]) test(`independent prepare visibility/authorize wait observes ${commit ? 'commit' : 'rollback'} without target writes`, async () => {
  const target = await listing(), p = await newPayment('listing', target);
  const a = connection('intent-author', p), b = connection('intent-reader', p);
  try {
    await a.start(); await a.command(prepareSql);
    assert.equal(await sql(`select count(*) from private.payment_checkout_intents where payment_id='${p.payment}';`), '0');
    await b.start(); const waiting = b.command(authorizeSql); await waitForLock('intent-reader');
    await a.command(commit ? 'commit;' : 'rollback;');
    const result = JSON.parse(await waiting)[0];
    assert.equal(result.decision, commit ? 'post' : 'manual');
    if (commit) assert.equal(result.request_body, p.body); else assert.equal(result.request_body, null);
    await b.command('commit;'); assert.deepEqual(await effects(target), []);
    assert.equal((await row('listings', target)).status, 'pending_payment');
  } finally { await Promise.all([a.close(), b.close()]); }
});

test('authorize waits for actual fulfillment commit and sees durable financial/intent truth', async () => {
  const target = await listing(), p = await newPayment('listing', target);
  await prepare(p); await adopt(p); await settle(p);
  const originalIntent = await intent(p.payment), a = connection('finance-commit'), b = connection('authorize-finance', p);
  try {
    await a.start(); assert.equal(JSON.parse(await a.command(applySql(p))).applied_now, true);
    assert.equal((await row('payments', p.payment)).fulfillment_status, 'pending');
    assert.equal((await row('listings', target)).status, 'pending_payment');
    await b.start(); const waiting = b.command(authorizeSql); await waitForLock('authorize-finance');
    await a.command('commit;'); const result = JSON.parse(await waiting)[0]; await b.command('commit;');
    assert.equal(result.financial_status, 'succeeded'); assert.equal(result.decision, 'recover'); assert.equal(result.request_body, p.body);
    assert.equal((await row('payments', p.payment)).fulfillment_status, 'applied');
    assert.deepEqual(await intent(p.payment), originalIntent); assert.equal((await effects(target)).length, 1);
  } finally { await Promise.all([a.close(), b.close()]); }
});

for (const kind of ['listing', 'vacancy', 'workRequest']) for (const direction of ['finance-first', 'restore-first']) {
  test(`combined locks interoperate: ${kind} ${direction}`, async () => {
    const spec = targetKinds[kind], target = await createTarget(kind), p = await newPayment(spec.type, target, 100, owner, spec.action);
    await prepare(p); await adopt(p); await settle(p);
    const originalIntent = await intent(p.payment);
    const finance = connection('interop-finance'), restoring = connection('interop-restore');
    let second;
    try {
      if (direction === 'finance-first' && kind !== 'workRequest') {
        await finance.start(); assert.equal(JSON.parse(await finance.command(applySql(p))).applied_now, true);
        await finance.command(`update public.${spec.table} set status='archived' where id='${target}';`);
        await restoring.start(); const waiting = restoring.command(restoreSql(kind, target)); await waitForLock('interop-restore');
        await finance.command('commit;'); assert.deepEqual(JSON.parse(await waiting), [{ id: target }]); await restoring.command('commit;');
      } else {
        await fulfill(p); await sql(`update public.${spec.table} set status='archived' where id='${target}';`);
        const paid = await row('payments', p.payment), archived = await row(spec.table, target);
        if (kind !== 'workRequest') {
          second = await newPayment(spec.type, target, 101, owner, spec.action); await prepare(second); await adopt(second); await settle(second);
        }
        if (direction === 'finance-first') {
          await finance.start(); assert.equal(JSON.parse(await finance.command(applySql(p))).applied_now, false);
          await restoring.start(); const waiting = restoring.command(restoreSql(kind, target)); await waitForLock('interop-restore');
          await finance.command('commit;'); assert.deepEqual(JSON.parse(await waiting), [{ id: target }]); await restoring.command('commit;');
        } else {
          await restoring.start(); assert.deepEqual(JSON.parse(await restoring.command(restoreSql(kind, target))), [{ id: target }]);
          await finance.start(); const waiting = finance.command(applySql(second ?? p)); await waitForLock('interop-finance');
          await restoring.command('commit;'); const result = JSON.parse(await waiting); await finance.command('commit;');
          assert.equal(result.applied_now, false); assert.equal(result.fulfillment_status, second ? 'blocked' : 'applied');
          if (second) { assert.equal(result.financial_status, 'succeeded'); assert.equal(result.fulfillment_reason, 'target_not_eligible'); }
        }
        const restored = await row(spec.table, target);
        assert.equal(restored.expires_at, archived.expires_at); assert.deepEqual(await row('payments', p.payment), paid);
        if (kind === 'workRequest') assert.equal(restored.published_at, archived.published_at);
      }
      assert.equal((await row(spec.table, target)).status, 'published');
      assert.deepEqual(await intent(p.payment), originalIntent);
      if (second) assert.equal((await intent(second.payment)).request_body, second.body);
    } finally { await Promise.all([finance.close(), restoring.close()]); }
  });
}

for (const kind of ['listing', 'vacancy', 'workRequest']) for (const expiring of [false, true]) {
  test(`${expiring ? 'post-lock expiry crossing refuses' : 'healthy lock-wait restores'} ${kind} with stable owner/window/history`, async () => {
    const spec = targetKinds[kind], target = await createTarget(kind), p = await newPayment(spec.type, target, 100, owner, spec.action);
    assert.equal((await complete(p, expiring ? `clock_timestamp()-${p.duration}*interval '24 hours'+interval '2 seconds'` : 'clock_timestamp()')).applied_now, true);
    await sql(`update public.${spec.table} set status='archived' where id='${target}';`);
    const before = await row(spec.table, target), beforePayment = await row('payments', p.payment), originalIntent = await intent(p.payment), beforeEffects = await effects(target);
    const blocker = connection('expiry-blocker'), restoring = connection('expiry-restore');
    try {
      await blocker.start(); await blocker.command(`select id from public.${spec.table} where id='${target}' for update;`);
      await restoring.start(); const waiting = restoring.command(restoreSql(kind, target)); await waitForLock('expiry-restore');
      if (expiring) await waitDatabaseClock(`clock_timestamp()>=(select expires_at from public.${spec.table} where id='${target}')`);
      await blocker.command('commit;'); assert.deepEqual(JSON.parse(await waiting), expiring ? [] : [{ id: target }]); await restoring.command('commit;');
      const after = await row(spec.table, target);
      if (expiring) { assert.deepEqual(after, before); assert.deepEqual(await effects(target), beforeEffects); }
      else { assert.equal(after.status, 'published'); assert.equal(after.expires_at, before.expires_at); }
      assert.deepEqual(await row('payments', p.payment), beforePayment); assert.deepEqual(await intent(p.payment), originalIntent);
    } finally { await Promise.all([blocker.close(), restoring.close()]); }
  });
}

for (const kind of ['listing', 'vacancy', 'workRequest']) for (const change of ['owner', 'moderation', 'delete']) {
  test(`${kind} restore rechecks ${change} committed during an actual target lock wait`, async () => {
    const spec = targetKinds[kind], target = await createTarget(kind), p = await newPayment(spec.type, target, 100, owner, spec.action);
    await complete(p); await sql(`update public.${spec.table} set status='archived' where id='${target}';`);
    const originalIntent = await intent(p.payment), beforePayment = await row('payments', p.payment), beforeEffects = await effects(target);
    const blocker = connection('state-blocker'), restoring = connection('state-restore');
    try {
      await blocker.start(); await blocker.command(`select id from public.${spec.table} where id='${target}' for update;`);
      await restoring.start(); const waiting = restoring.command(restoreSql(kind, target)); await waitForLock('state-restore');
      const mutation = change === 'delete' ? `delete from public.${spec.table} where id='${target}';` :
        `update public.${spec.table} set ${change === 'owner' ? `author_id='${other}'` : "status='rejected'"} where id='${target}';`;
      await blocker.command(`${mutation} commit;`); assert.deepEqual(JSON.parse(await waiting), []); await restoring.command('commit;');
      assert.equal((await effects(target)).length, beforeEffects.length + (change === 'delete' ? 0 : 1));
      assert.deepEqual(await row('payments', p.payment), beforePayment); assert.deepEqual(await intent(p.payment), originalIntent);
      if (change === 'delete') assert.equal(await sql(`select count(*) from public.${spec.table} where id='${target}';`), '0');
      else assert.equal((await row(spec.table, target))[change === 'owner' ? 'author_id' : 'status'], change === 'owner' ? other : 'rejected');
    } finally { await Promise.all([blocker.close(), restoring.close()]); }
  });
}

for (const direction of ['finance-first', 'queue-first']) test(`private-intent financial replay/actual queue locks interoperate ${direction}`, async () => {
  const target = await createTarget('marquee'), p = await newPayment('ad_marquee', target, 100, owner, 'ad_marquee');
  await complete(p);
  const originalIntent = await intent(p.payment), beforePayment = await row('payments', p.payment), beforeEffects = await effects(target);
  const finance = connection('queue-finance'), queue = connection('queue-worker');
  try {
    if (direction === 'finance-first') {
      await finance.start(); assert.equal(JSON.parse(await finance.command(applySql(p))).applied_now, false);
      await queue.start(); const waiting = queue.command(queueSql), waiter = await waitForLock('queue-worker');
      assert.equal(await sql(`select exists(select 1 from pg_locks where pid=${waiter} and locktype='advisory' and granted);`, {}, 'postgres'), 't');
      await finance.command('commit;'); assert.deepEqual(JSON.parse(await waiting), [{ id: target }]); await queue.command('commit;');
    } else {
      await queue.start(); assert.deepEqual(JSON.parse(await queue.command(queueSql)), [{ id: target }]);
      await finance.start(); const waiting = finance.command(applySql(p)), waiter = await waitForLock('queue-finance');
      assert.equal(await sql(`select exists(select 1 from pg_locks where pid=${waiter} and locktype='advisory');`, {}, 'postgres'), 'f');
      await queue.command('commit;'); assert.equal(JSON.parse(await waiting).applied_now, false); await finance.command('commit;');
    }
    assert.equal((await row('ad_marquee_placements', target)).status, 'active');
    assert.equal((await effects(target)).length, beforeEffects.length + 1);
    assert.deepEqual(await row('payments', p.payment), beforePayment); assert.deepEqual(await intent(p.payment), originalIntent);
  } finally { await Promise.all([finance.close(), queue.close()]); }
});

for (const direction of ['approval-first', 'finance-first']) test(`actual moderation/finance locks observe ${direction} with durable intent and sticky outcome`, async () => {
  const target = await createTarget('marquee', 10, { approve: false }), p = await newPayment('ad_marquee', target, 100, owner, 'ad_marquee');
  await prepare(p); await adopt(p); await settle(p);
  const originalIntent = await intent(p.payment), admin = connection('moderation-worker'), finance = connection('moderation-finance');
  try {
    if (direction === 'approval-first') {
      await admin.start(); assert.equal(JSON.parse(await admin.command(moderateSql(target))).changed, true);
      await finance.start(); const waiting = finance.command(applySql(p)); await waitForLock('moderation-finance');
      await admin.command('commit;'); assert.equal(JSON.parse(await waiting).applied_now, true); await finance.command('commit;');
      assert.deepEqual(await reconcile(), [{ id: target }]);
    } else {
      await finance.start(); assert.equal(JSON.parse(await finance.command(applySql(p))).fulfillment_status, 'blocked');
      await admin.start(); const waiting = admin.command(moderateSql(target)); await waitForLock('moderation-worker');
      await finance.command('commit;'); assert.equal(JSON.parse(await waiting).changed, true); await admin.command('commit;');
      assert.equal((await fulfill(p)).fulfillment_status, 'blocked'); assert.deepEqual(await reconcile(), []);
      assert.equal((await row('ad_marquee_placements', target)).starts_at, null);
    }
    assert.equal((await row('payments', p.payment)).status, 'succeeded'); assert.deepEqual(await intent(p.payment), originalIntent);
  } finally { await Promise.all([admin.close(), finance.close()]); }
});

for (const kind of ['vacancyResponse', 'workResponse']) for (const expiring of [false, true]) {
  test(`actual application parent lock ${expiring ? 'expiry refusal' : 'healthy delivery'}: ${kind}`, async () => {
    const spec = targetKinds[kind], target = await createTarget(kind, 10, { nearExpiryParent: expiring });
    const p = await newPayment('application', target, 100, other, 'job_response'); await prepare(p); await adopt(p); await settle(p);
    const originalIntent = await intent(p.payment), application = await row('applications', target), parentSpec = targetKinds[spec.parent];
    const parent = application[spec.parent === 'vacancy' ? 'vacancy_id' : 'work_request_id'];
    const blocker = connection('parent-blocker'), finance = connection('parent-finance');
    try {
      await blocker.start(); await blocker.command(`select id from public.${parentSpec.table} where id='${parent}' for update;`);
      await finance.start(); const waiting = finance.command(applySql(p)); await waitForLock('parent-finance');
      if (expiring) await waitDatabaseClock(`clock_timestamp()>=(select expires_at from public.${parentSpec.table} where id='${parent}')`);
      await blocker.command('commit;'); const result = JSON.parse(await waiting); await finance.command('commit;');
      assert.equal(result.applied_now, !expiring); assert.equal(result.fulfillment_status, expiring ? 'blocked' : 'applied');
      if (expiring) { assert.equal(result.fulfillment_reason, 'parent_not_eligible'); assert.deepEqual(await row('applications', target), application); }
      assert.equal(await sql(`select count(*) from public.notifications where payment_id='${p.payment}';`), expiring ? '0' : '1');
      assert.equal((await row('payments', p.payment)).status, 'succeeded'); assert.deepEqual(await intent(p.payment), originalIntent);
    } finally { await Promise.all([blocker.close(), finance.close()]); }
  });
}

test('two independent application fulfillers produce one physical delivery and one notification with private intent unchanged', async () => {
  const target = await createTarget('workResponse'), p = await newPayment('application', target, 100, other, 'job_response');
  await prepare(p); await adopt(p); await settle(p); const originalIntent = await intent(p.payment);
  const first = connection('application-first'), second = connection('application-second');
  try {
    await first.start(); assert.equal(JSON.parse(await first.command(applySql(p))).applied_now, true);
    assert.equal((await row('applications', target)).status, 'pending_payment');
    assert.equal(await sql(`select count(*) from public.notifications where payment_id='${p.payment}';`), '0');
    await second.start(); const waiting = second.command(applySql(p)); await waitForLock('application-second');
    await first.command('commit;'); assert.equal(JSON.parse(await waiting).applied_now, false); await second.command('commit;');
    assert.equal((await effects(target)).length, 1); assert.equal(await sql(`select count(*) from public.notifications where payment_id='${p.payment}';`), '1');
    assert.deepEqual(await intent(p.payment), originalIntent);
  } finally { await Promise.all([first.close(), second.close()]); }
});

test('independent queue activation rollback preserves paid truth and no half-written purchased interval', async () => {
  const target = await createTarget('marquee'), p = await newPayment('ad_marquee', target, 100, owner, 'ad_marquee');
  await complete(p);
  const before = await row('ad_marquee_placements', target), beforePayment = await row('payments', p.payment), originalIntent = await intent(p.payment);
  const queue = connection('queue-rollback');
  try {
    await queue.start(); assert.deepEqual(JSON.parse(await queue.command(queueSql)), [{ id: target }]);
    assert.deepEqual(await row('ad_marquee_placements', target), before);
    await queue.command('rollback;'); assert.deepEqual(await row('ad_marquee_placements', target), before);
    assert.deepEqual(await row('payments', p.payment), beforePayment); assert.deepEqual(await intent(p.payment), originalIntent);
    assert.deepEqual(await reconcile(), [{ id: target }]);
    assert.equal(await sql(`select ends_at=starts_at+${p.duration}*interval '24 hours' from public.ad_marquee_placements where id='${target}';`), 't');
  } finally { await queue.close(); }
});

// Strict REST wire translation only. All eligibility, provider validation,
// ledger/hash authorization and settlement behavior run in actual modules/SQL.
// This adapter is NOT a PostgREST or HTTP/Auth-server implementation.
function wireFilters(url, fields, alias = 't') {
  const params = {}, clauses = [];
  for (const [key, value] of url.searchParams) {
    assert.ok(['select', 'order', 'limit', 'status', ...fields].includes(key), `Unsupported REST query key ${key}`);
    if (key === 'select') continue;
    if (key === 'order') { assert.ok(['created_at.desc', 'price.asc'].includes(value)); continue; }
    if (key === 'limit') { assert.equal(value, '1'); continue; }
    if (value.startsWith('eq.')) {
      assert.ok(fields.includes(key)); params[key] = value.slice(3); clauses.push(`${alias}.${key}::text=p->>'${key}'`);
    } else {
      assert.ok(['id', 'status'].includes(key)); assert.match(value, /^in\.\([a-zA-Z0-9_,-]+\)$/);
      params[key] = value.slice(4, -1).split(','); clauses.push(`${alias}.${key}::text in (select jsonb_array_elements_text(p->'${key}'))`);
    }
  }
  return { params, where: clauses.length ? clauses.join(' and ') : 'true', limit: url.searchParams.has('limit') ? 'limit 1' : '' };
}
function queueRequest(request) {
  assert.equal(request.useServiceRole, true); assert.equal(request.attempts, 1);
  assert.ok(Number.isInteger(request.timeoutMs) && request.timeoutMs > 0 && request.timeoutMs <= 8000);
}
function actualRest(observed = { queue: [], reads: [] }) {
  return async (resource, request = {}, state) => {
    const url = new URL(resource, 'http://fixture.invalid'), method = request.method ?? 'GET', b = request.body;
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      assert.equal(method, 'POST'); assert.equal(request.useServiceRole, true);
      if (url.pathname.endsWith('/apply_payment_fulfillment')) return json(`with args as (${arg})
        select json_agg(r) from args,lateral public.apply_payment_fulfillment((p->>'p_payment_id')::uuid,p->>'p_expected_provider_payment_id') r;`, b);
      if (url.pathname === '/rest/v1/rpc/reconcile_ad_marquee_queue') {
        assert.equal(url.search, ''); assert.deepEqual(b, {}); queueRequest(request);
        // A separate SQL connection must see durable finance/fulfillment BEFORE
        // the actual queue RPC. It is not part of the payment/target transaction.
        const committed = await row('payments', state.row.id);
        assert.equal(committed.status, 'succeeded'); assert.equal(committed.fulfillment_status, 'applied');
        assert.ok(committed.target_applied_at);
        const call = { payment: committed, timeoutMs: request.timeoutMs }; observed.queue.push(call);
        try { return await json(`set application_name='module-event-queue'; ${queueSql}`); }
        catch (error) { call.error = error.message; throw error; }
      }
      const params = { payment: b.p_payment_id, owner: b.p_user_id, type: b.p_target_type, target: b.p_target_id,
        merchant: b.p_merchant_shop_id, isTest: b.p_is_test, key: b.p_tariff_key, amount: b.p_amount,
        duration: b.p_purchased_duration_days, body: b.p_request_body };
      if (url.pathname.endsWith('/prepare_yookassa_checkout_intent')) return json(prepareSql, params);
      if (url.pathname.endsWith('/authorize_yookassa_checkout_attempt')) return json(authorizeSql, params);
      assert.fail(`Unsupported actual RPC boundary ${url.pathname}`);
    }
    if (url.pathname === '/rest/v1/ad_marquee_placements') {
      assert.equal(method, 'GET'); queueRequest(request);
      assert.deepEqual([...url.searchParams.keys()].sort(), ['select','id','user_id','payment_id','payment_status','or','limit'].sort());
      assert.equal(url.searchParams.get('select'), 'id,user_id,payment_id,payment_status,status,starts_at,ends_at');
      assert.equal(url.searchParams.get('payment_status'), 'eq.succeeded'); assert.equal(url.searchParams.get('limit'), '1');
      assert.equal(url.searchParams.get('or'), '(status.eq.paid,and(status.eq.active,starts_at.lte.now,ends_at.gt.now))');
      const params = {};
      for (const key of ['id','user_id','payment_id']) {
        const value = url.searchParams.get(key); assert.match(value, /^eq\.[a-f0-9-]{36}$/); params[key] = value.slice(3);
      }
      observed.reads.push({ params, timeoutMs: request.timeoutMs });
      // Exact wire predicates only, not copied queue eligibility. The timestamp
      // literal is converted by PostgreSQL in this fresh GET statement.
      return json(`with args as (${arg}) select coalesce(json_agg(r),'[]') from (
        select t.id,t.user_id,t.payment_id,t.payment_status,t.status,t.starts_at,t.ends_at
        from public.ad_marquee_placements t cross join args
        where t.id=(p->>'id')::uuid and t.user_id=(p->>'user_id')::uuid and t.payment_id=(p->>'payment_id')::uuid
          and t.payment_status='succeeded' and (t.status='paid' or (t.status='active'
            and t.starts_at<='now'::timestamptz and t.ends_at>'now'::timestamptz)) limit 1) r;`, params);
    }
    let rows;
    if (url.pathname === '/rest/v1/payments' && method === 'POST') rows = await json(`with args as (${arg}), changed as (
      insert into public.payments(id,user_id,tariff_id,target_type,target_id,provider,amount,status,purchased_duration_days)
      select (p->>'id')::uuid,(p->>'user_id')::uuid,(p->>'tariff_id')::uuid,p->>'target_type',(p->>'target_id')::uuid,
        p->>'provider',(p->>'amount')::numeric,(p->>'status')::public.payment_status,(p->>'purchased_duration_days')::integer
      from args returning *) select json_agg(changed) from changed;`, b);
    else if (url.pathname === '/rest/v1/payments' && method === 'PATCH') {
      const filter = wireFilters(url, ['id']); assert.ok(filter.params.id);
      rows = await json(`with args as (${arg}), changed as (update public.payments set provider=p->>'provider',
        provider_payment_id=p->>'provider_payment_id',status=(p->>'status')::public.payment_status,paid_at=(p->>'paid_at')::timestamptz
        from args where id=(p->>'filterId')::uuid returning public.payments.*) select json_agg(changed) from changed;`, { ...b, filterId: filter.params.id });
    } else {
      assert.equal(method, 'GET');
      const table = url.pathname.slice('/rest/v1/'.length);
      assert.ok(['tariffs', 'payments', 'applications', 'fair_applications'].includes(table));
      const filter = wireFilters(url, table === 'payments' ? ['id','user_id','target_id','target_type','provider','provider_payment_id'] : ['id','action']);
      if (table === 'applications') rows = await json(`with args as (${arg}) select coalesce(json_agg(r),'[]') from (
        select a.id,a.specialist_name,case when v.id is null then null else json_build_object('title',v.title) end vacancies,
          case when w.id is null then null else json_build_object('title',w.title) end work_requests
        from public.applications a left join public.vacancies v on v.id=a.vacancy_id
          left join public.work_requests w on w.id=a.work_request_id cross join args
        where ${filter.where.replaceAll('t.', 'a.')} ${filter.limit}) r;`, filter.params);
      else rows = await json(`with args as (${arg}) select coalesce(json_agg(r),'[]') from (
        select t.* from public.${table} t cross join args where ${filter.where}
        ${url.searchParams.has('order') ? `order by ${url.searchParams.get('order').replace('.', ' ')}` : ''} ${filter.limit}) r;`, filter.params);
    }
    if (url.pathname === '/rest/v1/payments' && rows?.[0]) state.row = rows[0];
    return rows ?? [];
  };
}

for (const kind of Object.keys(targetKinds)) test(`whole actual provider/store graph with combined SQL and safe payment DTO: ${kind}`, async () => {
  const spec = targetKinds[kind], target = await createTarget(kind), payment = id(100), provider = id(500), payer = spec.parent ? other : owner;
  const email = 'module-payer@example.invalid', beforeEffects = await effects(target);
  const observed = { queue: [], reads: [] };
  let committedAtPost, capturedAt, privateSnapshot;
  const h = harness({ clock: { Date, performance, now: () => Date.now(), setTimeout, clearTimeout }, rest: actualRest(observed),
    vendor: async (entry) => {
      privateSnapshot = await intent(payment); // Independent real transaction at the external boundary.
      const originalBody = JSON.parse(privateSnapshot.request_body);
      if (entry.method === 'POST') {
        committedAtPost = privateSnapshot;
        assert.equal(privateSnapshot.request_body, entry.body); assert.equal(entry.key, payment);
      } else capturedAt = await sql("select to_char(clock_timestamp(),'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"');");
      return new Response(JSON.stringify({ id: provider, status: entry.method === 'POST' ? 'pending' : 'succeeded',
        paid: entry.method !== 'POST', test: true, amount: originalBody.amount, metadata: originalBody.metadata,
        ...(capturedAt ? { captured_at: capturedAt } : {}),
        confirmation: { type: 'redirect', confirmation_url: `https://yoomoney.ru/checkout?orderId=${provider}` } }));
    } });
  const graph = h.server({}, { paymentId: payment });
  const created = await graph.provider.createPayment({ tariffId: spec.action.replaceAll('_', '-'), targetType: spec.type,
    targetId: target, userId: payer, targetTitle: 'Actual module synthetic title', customerEmail: email });
  assert.equal(created.status, 'pending'); assert.equal(created.providerPaymentId, provider);
  assert.equal((await row(spec.table, target)).status, 'pending_payment');
  const result = await graph.provider.confirmPayment(payment);
  assert.equal(result.payment.status, 'succeeded'); assert.equal(result.payment.fulfillmentStatus, 'applied');
  assert.equal(result.nextStatus, kind === 'marquee' ? 'active' : spec.parent ? 'sent' : 'published');
  assert.equal(await sql(`select paid_at='${capturedAt}'::timestamptz from public.payments where id='${payment}';`), 't');
  assert.equal((await effects(target)).length, beforeEffects.length + (kind === 'marquee' ? 2 : 1));
  assert.equal(observed.queue.length, kind === 'marquee' ? 1 : 0); assert.equal(observed.reads.length, observed.queue.length);
  if (kind === 'marquee') {
    assert.equal((await row(spec.table, target)).status, 'active');
    assert.equal(await sql(`select t.ends_at=t.starts_at+p.purchased_duration_days*interval '24 hours'
      from public.ad_marquee_placements t join public.payments p on p.id=t.payment_id where t.id='${target}';`), 't');
    assert.ok(observed.reads[0].timeoutMs < observed.queue[0].timeoutMs);
  }
  assert.deepEqual(await intent(payment), committedAtPost);
  const publicDto = JSON.stringify([created, result.payment, await graph.store.getStoredPayment(payment), await graph.store.listStoredPaymentsForUser(payer)]);
  for (const secret of [email, 'request_body', 'requestBody', 'request_sha256', 'merchant_shop_id', 'first_attempt_authorized_at', 'receipt']) assert.equal(publicDto.includes(secret), false);
  const immutableTarget = await row(spec.table, target), marker = await row('payments', payment);
  const replay = await h.server({}, { paymentId: payment }).provider.confirmPayment(payment);
  assert.equal(replay.payment.fulfillmentStatus, 'applied'); assert.equal(replay.nextStatus, kind === 'marquee' ? 'active' : undefined);
  assert.equal(observed.queue.length, kind === 'marquee' ? 2 : 0); assert.equal(observed.reads.length, observed.queue.length);
  assert.equal((await effects(target)).length, beforeEffects.length + (kind === 'marquee' ? 2 : 1));
  assert.deepEqual(await row(spec.table, target), immutableTarget); assert.deepEqual(await row('payments', payment), marker);
  assert.deepEqual(await intent(payment), committedAtPost);
});

async function moduleMarqueeCheckout() {
  const target = await createTarget('marquee'), payment = id(100), provider = id(500);
  const observed = { queue: [], reads: [] }, beforeEffects = await effects(target);
  const h = harness({ clock: { Date, performance, now: () => Date.now(), setTimeout, clearTimeout }, rest: actualRest(observed),
    vendor: async entry => {
      const original = await intent(payment), body = JSON.parse(original.request_body);
      if (entry.method === 'POST') { assert.equal(entry.body, original.request_body); assert.equal(entry.key, payment); }
      const capture = entry.method === 'GET' ? await sql("select to_char(clock_timestamp(),'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"');") : undefined;
      return new Response(JSON.stringify({ id: provider, status: capture ? 'succeeded' : 'pending', paid: Boolean(capture), test: true,
        amount: body.amount, metadata: body.metadata, ...(capture ? { captured_at: capture } : {}),
        confirmation: { type: 'redirect', confirmation_url: `https://yoomoney.ru/checkout?orderId=${provider}` } }));
    } });
  const graph = h.server({}, { paymentId: payment });
  const created = await graph.provider.createPayment({ tariffId: 'ad-marquee', targetType: 'ad_marquee', targetId: target,
    userId: owner, targetTitle: 'Synthetic event marquee', customerEmail: 'event-payer@example.invalid' });
  assert.equal(created.status, 'pending'); assert.equal(created.providerPaymentId, provider);
  return { target, payment, observed, beforeEffects, h, graph, originalIntent: await intent(payment) };
}

test('actual marquee event with five occupied slots preserves paid waiting state and every established interval on replay', async () => {
  for (let n = 0; n < 5; n++) {
    const target = await createTarget('marquee', 20 + n), p = await newPayment('ad_marquee', target, 200 + n, owner, 'ad_marquee');
    assert.equal((await complete(p)).applied_now, true);
  }
  assert.equal((await reconcile()).length, 5);
  const occupiedSql = `select json_agg(t order by id) from public.ad_marquee_placements t where id<> '${id(10)}';`;
  const occupied = await json(occupiedSql), c = await moduleMarqueeCheckout();
  const result = await c.graph.provider.confirmPayment(c.payment);
  assert.equal(result.payment.status, 'succeeded'); assert.equal(result.payment.fulfillmentStatus, 'applied'); assert.equal(result.nextStatus, 'paid');
  const target = await row('ad_marquee_placements', c.target), financial = await row('payments', c.payment);
  assert.equal(target.status, 'paid'); assert.equal(target.starts_at, null); assert.equal(target.ends_at, null);
  assert.equal((await effects(c.target)).length, c.beforeEffects.length + 1);
  const replay = await c.h.server({}, { paymentId: c.payment }).provider.confirmPayment(c.payment);
  assert.equal(replay.nextStatus, 'paid'); assert.equal(c.observed.queue.length, 2); assert.equal(c.observed.reads.length, 2);
  assert.deepEqual(await row('ad_marquee_placements', c.target), target); assert.deepEqual(await row('payments', c.payment), financial);
  assert.deepEqual(await json(occupiedSql), occupied); assert.deepEqual(await intent(c.payment), c.originalIntent);
  assert.equal((await effects(c.target)).length, c.beforeEffects.length + 1);
  assert.equal(c.h.state.providerRequests.filter(entry => entry.method === 'POST').length, 1);
});

test('actual marquee event advisory-lock timeout leaves queue unknown but durable finance safe; retry activates once', async () => {
  const c = await moduleMarqueeCheckout(), blocker = connection('module-event-blocker');
  try {
    await blocker.start(); await blocker.command('select pg_advisory_xact_lock(1112295754,1);');
    const confirming = c.graph.provider.confirmPayment(c.payment);
    await waitForLock('module-event-queue'); // Actual blocked RPC backend, not a sleep/proxy promise.
    const unknown = await confirming;
    assert.equal(unknown.payment.status, 'succeeded'); assert.equal(unknown.payment.fulfillmentStatus, 'applied'); assert.equal(unknown.nextStatus, undefined);
    const outcome = c.graph.load('src/lib/payment-confirmation-outcome.ts').getPaymentConfirmationOutcome(unknown);
    assert.equal(outcome.kind, 'queue_pending'); assert.equal(outcome.tone, 'warning'); assert.equal(outcome.canRetry, true);
    assert.match(c.observed.queue[0].error, /canceling statement due to lock timeout/); assert.equal(c.observed.reads.length, 0);
    const paid = await row('ad_marquee_placements', c.target), financial = await row('payments', c.payment);
    assert.equal(paid.status, 'paid'); assert.equal(paid.starts_at, null); assert.equal(paid.ends_at, null);
    assert.equal((await effects(c.target)).length, c.beforeEffects.length + 1);
    assert.deepEqual(await intent(c.payment), c.originalIntent);
    await blocker.command('commit;');
    const repaired = await c.h.server({}, { paymentId: c.payment }).provider.confirmPayment(c.payment);
    assert.equal(repaired.nextStatus, 'active');
    const active = await row('ad_marquee_placements', c.target);
    assert.equal(active.status, 'active'); assert.ok(active.starts_at); assert.ok(active.ends_at);
    assert.equal((await effects(c.target)).length, c.beforeEffects.length + 2);
    const replay = await c.h.server({}, { paymentId: c.payment }).provider.confirmPayment(c.payment);
    assert.equal(replay.nextStatus, 'active'); assert.equal(c.observed.queue.length, 3); assert.equal(c.observed.reads.length, 2);
    assert.deepEqual(await row('ad_marquee_placements', c.target), active); assert.deepEqual(await row('payments', c.payment), financial);
    assert.deepEqual(await intent(c.payment), c.originalIntent); assert.equal((await effects(c.target)).length, c.beforeEffects.length + 2);
    assert.equal(c.h.state.providerRequests.filter(entry => entry.method === 'POST').length, 1);
  } finally { await blocker.close(); }
});

test('two independent actual preparers cannot replace the winning body after parent/intent locks serialize', async () => {
  const target = await listing(), p = await newPayment('listing', target);
  const a = connection('prepare-winner', p), b = connection('prepare-loser', { ...p, body: p.body.replace('Synthetic checkout', 'Changed checkout') });
  try {
    await a.start(); await a.command(prepareSql);
    await b.start(); const rejected = assert.rejects(b.command(prepareSql), /snapshot is immutable/); await waitForLock('prepare-loser');
    await a.command('commit;'); await rejected;
    assert.equal((await intent(p.payment)).request_body, p.body); assert.deepEqual(await effects(target), []);
    assert.equal((await authorize(p)).decision, 'post');
  } finally { await Promise.all([a.close(), b.close()]); }
});
