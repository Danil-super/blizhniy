import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test, { after, before, beforeEach } from "node:test";

// Deliberately opt-in: the normal offline Node test container has no Docker
// socket. Run this file explicitly using the command in the runbook.
const run = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const container = "blizhniy-fulfillment-pg17-worker-20261007";
const database = "blizhniy_fulfillment_fixture";
const ownerLabel = "blizhniy.fulfillment-test=contact_privacy_fix";
const baseline = process.env.BLIZHNIY_FULFILLMENT_BASELINE === "1";
const id = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const ownerA = id(1);
const ownerB = id(2);
const targets = { listing: 10, vacancy: 11, workRequest: 12, fair_application: 13, ad_marquee: 14, application: 15 };
const parentVacancy = id(21);
const parentWorkRequest = id(22);
let ownedContainer = false;

async function docker(args) {
  return (await run("docker", args, { timeout: 12_000, maxBuffer: 1024 * 1024 })).stdout.trim();
}

function psqlArgs() {
  return ["exec", "-i", container, "psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database];
}

async function sql(statement, service = false) {
  return docker([...psqlArgs(), "-c", `set statement_timeout = '5s'; ${service ? "set role service_role;" : ""} ${statement}`]);
}

async function json(statement, service = false) {
  return JSON.parse(await sql(statement, service));
}

async function rpc(paymentId = id(100), providerId = "synthetic-yookassa-100") {
  return json(`select row_to_json(result) from public.apply_payment_fulfillment('${paymentId}', '${providerId}') result;`, true);
}

async function payment(type = "listing", options = {}) {
  const paymentId = options.id ?? id(100);
  const providerId = options.providerId ?? `synthetic-yookassa-${Number(paymentId.slice(-12))}`;
  const duration = options.duration === undefined ? (type === "ad_marquee" ? 7 : ["application", "fair_application"].includes(type) ? null : 30) : options.duration;
  await sql(`insert into public.payments (id, user_id, target_type, target_id, provider, provider_payment_id,
    amount, status, paid_at${baseline ? "" : ", purchased_duration_days"}) values (
    '${paymentId}', ${options.owner === null ? "null" : `'${options.owner ?? ownerA}'`}, '${type}', '${options.target ?? id(targets[type] ?? 19)}',
    '${options.provider ?? "yookassa"}', '${providerId}', 199, '${options.status ?? "succeeded"}',
    ${options.paidAt === null ? "null" : options.paidAt ? `'${options.paidAt}'` : "clock_timestamp() - interval '1 minute'"}
    ${baseline ? "" : `, ${duration === null ? "null" : duration}`});`);
  return { id: paymentId, providerId };
}

async function storedPayment(paymentId = id(100)) {
  return json(`select row_to_json(p) from public.payments p where id = '${paymentId}';`);
}

function targetTable(type) {
  return { listing: "listings", vacancy: "vacancies", workRequest: "work_requests", fair_application: "fair_applications", application: "applications", ad_marquee: "ad_marquee_placements" }[type];
}

async function targetRow(type, targetId = id(targets[type])) {
  return json(`select row_to_json(t) from public.${targetTable(type)} t where id = '${targetId}';`);
}

async function effectCount(type, targetId = id(targets[type])) {
  return Number(await sql(`select count(*) from private.fulfillment_test_effects where table_name = '${targetTable(type)}' and target_id = '${targetId}';`));
}

// Persistent, independent PostgreSQL connections with explicit SQL barriers.
// No sleeps are used to "hope" that a race happened.
function connection(name) {
  const child = spawn("docker", psqlArgs(), { stdio: ["pipe", "pipe", "pipe"] });
  let buffer = "";
  let errors = "";
  let pending;
  let sequence = 0;
  child.stdout.on("data", (data) => {
    buffer += data;
    if (pending && buffer.includes(pending.marker)) {
      const [output, rest] = buffer.split(pending.marker);
      buffer = rest;
      clearTimeout(pending.timeout);
      pending.resolve(output.trim());
      pending = null;
    }
  });
  child.stderr.on("data", (data) => { errors += data; });
  child.stdin.on("error", () => {}); // Expected when the owned backend is terminated by the crash test.
  child.on("exit", (code) => {
    if (pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`Owned PostgreSQL connection exited ${code}: ${errors}`));
      pending = null;
    }
  });
  return {
    name,
    command(statement) {
      assert.equal(Boolean(pending), false, "one in-flight command per independent connection");
      buffer = "";
      const marker = `__FULFILLMENT_BARRIER_${++sequence}__`;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Owned PostgreSQL barrier timed out: ${errors}`)), 7000);
        pending = { marker, resolve, reject, timeout };
        child.stdin.write(`${statement}\n\\echo ${marker}\n`);
      });
    },
    async begin() {
      await this.command(`set application_name = '${name}'; set statement_timeout = '5s'; begin; set local role service_role;`);
    },
    close() { child.stdin.end("\\q\n"); },
  };
}

async function waitForLock(name) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (await sql(`select exists(select 1 from pg_stat_activity where datname = '${database}' and application_name = '${name}' and wait_event_type = 'Lock');`) === "t") return;
  }
  assert.fail(`The independent connection ${name} never reached the actual lock barrier`);
}

before(async () => {
  // A name collision fails without touching the pre-existing container.
  await docker(["run", "--detach", "--pull", "never", "--network", "none", "--name", container,
    "--label", ownerLabel, "--tmpfs", "/var/lib/postgresql/data",
    "--mount", `type=bind,source=${root},target=/work,readonly`,
    "-e", `POSTGRES_DB=${database}`, "-e", "POSTGRES_HOST_AUTH_METHOD=trust",
    "postgres:17-alpine", "-c", "listen_addresses=", "-c", "timezone=UTC"]);
  ownedContainer = true;
  const deadline = Date.now() + 8000;
  while (true) {
    try { await sql("select 1;"); break; } catch (error) { if (Date.now() > deadline) throw error; }
  }
  assert.match(await sql("show server_version;"), /^17\./);
  await docker([...psqlArgs(), "-v", `apply_fulfillment_migration=${!baseline}`, "-f", "/work/tests/fixtures/payment-fulfillment.sql"]);
});

after(async () => {
  if (!ownedContainer) return;
  assert.equal(await docker(["inspect", "--format", '{{index .Config.Labels "blizhniy.fulfillment-test"}}', container]), "contact_privacy_fix");
  await docker(["rm", "--force", container]);
});

beforeEach(async () => {
  await sql([...Object.keys(targets).map(targetTable), "payments", "notifications"]
    .map((table) => `drop trigger if exists suppress_fulfillment_test_write on public.${table};`).join("\n"));
  await sql(`drop trigger if exists fail_fulfillment_test_notification on public.notifications;
    truncate public.notifications, public.payments, public.listings, public.vacancies, public.work_requests,
      public.fair_applications, public.applications, public.ad_marquee_placements cascade;
    truncate private.fulfillment_test_effects;
    insert into public.listings (id, author_id, listing_type, category_id, region_id, city_id, title, description, status)
      select '${id(10)}', '${ownerA}', 'sell', c.id, city.region_id, city.id, 'Synthetic listing', 'Fixture only', 'pending_payment'
      from public.categories c cross join public.cities city where c.slug = 'synthetic-test-category' limit 1;
    insert into public.vacancies (id, author_id, organization_name, title, description, region_id, city_id, status, is_paid, published_at, expires_at)
      select row.id::uuid, row.owner::uuid, 'Synthetic employer', 'Synthetic vacancy', 'Fixture only', city.region_id, city.id,
        row.status::public.publication_status, row.paid, row.published, row.expires
      from (values ('${id(11)}', '${ownerA}', 'pending_payment', false, null::timestamptz, null::timestamptz),
        ('${parentVacancy}', '${ownerB}', 'published', true, clock_timestamp() - interval '1 day', clock_timestamp() + interval '10 days')) row(id, owner, status, paid, published, expires)
      cross join (select * from public.cities limit 1) city;
    insert into public.work_requests (id, author_id, title, description, region_id, city_id, status, published_at)
      select row.id::uuid, row.owner::uuid, 'Synthetic work request', 'Fixture only', city.region_id, city.id, row.status::public.publication_status, row.published
      from (values ('${id(12)}', '${ownerA}', 'pending_payment', null::timestamptz),
        ('${parentWorkRequest}', '${ownerB}', 'published', clock_timestamp() - interval '1 day')) row(id, owner, status, published)
      cross join (select * from public.cities limit 1) city;
    ${baseline ? "" : `update public.work_requests set is_paid = true, expires_at = clock_timestamp() + interval '10 days' where id = '${parentWorkRequest}';`}
    insert into public.fair_applications (id, user_id, participant_name, fair_category, description, contact_phone, email, status)
      values ('${id(13)}', '${ownerA}', 'Synthetic participant', 'Fixture', 'Fixture only', '+70000000000', 'synthetic@example.invalid', 'pending_payment');
    insert into public.ad_marquee_placements (id, user_id, text, status, approved_at)
      values ('${id(14)}', '${ownerA}', 'Synthetic approved ad marquee', 'pending_payment', clock_timestamp() - interval '1 day');
    insert into public.applications (id, applicant_user_id, vacancy_id, status)
      values ('${id(15)}', '${ownerA}', '${parentVacancy}', 'pending_payment');
    truncate private.fulfillment_test_effects;`);
});

test("atomic fulfillment RPC is invoker-only with empty search_path and browser grant denials", async (t) => {
  t.diagnostic(`Actual PostgreSQL ${await sql("show server_version;")}; cached image ${await docker(["image", "inspect", "--format", "{{.Id}}", "postgres:17-alpine"])}`);
  const metadata = await json(`select row_to_json(f) from (select p.prosecdef, p.provolatile, p.proconfig,
    has_function_privilege('anon', p.oid, 'execute') anon_execute,
    has_function_privilege('authenticated', p.oid, 'execute') authenticated_execute,
    has_function_privilege('service_role', p.oid, 'execute') service_execute
    from pg_proc p where p.oid = 'public.apply_payment_fulfillment(uuid,text)'::regprocedure) f;`);
  assert.equal(metadata.prosecdef, false);
  assert.equal(metadata.provolatile, "v");
  assert.deepEqual(metadata.proconfig, ['search_path=""']);
  assert.equal(metadata.anon_execute, false);
  assert.equal(metadata.authenticated_execute, false);
  assert.equal(metadata.service_execute, true);
  for (const role of ["anon", "authenticated"]) {
    await assert.rejects(sql(`set role ${role}; select public.apply_payment_fulfillment('${id(100)}', 'synthetic');`), /permission denied for function apply_payment_fulfillment/);
  }
});

test("runner container-name collision fails without touching the already-owned fixture", async () => {
  await payment();
  const before = await storedPayment();
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT; // A separate runner, not an inherited test worker.
  await assert.rejects(run(process.execPath, ["--test", "--test-name-pattern=^atomic fulfillment RPC", "--test-reporter=spec",
    fileURLToPath(import.meta.url)], { timeout: 8000, maxBuffer: 1024 * 1024, env: childEnv }), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stdout, /container name .* already in use/i);
    return true;
  });
  assert.equal(await docker(["inspect", "--format", '{{index .Config.Labels "blizhniy.fulfillment-test"}}', container]), "contact_privacy_fix");
  assert.deepEqual(await storedPayment(), before);
  assert.equal((await targetRow("listing")).status, "pending_payment");
});

for (const type of Object.keys(targets)) {
  test(`${type} applies exactly once to its locked owner-bound eligible target`, async () => {
    await payment(type);
    const first = await rpc();
    const target = await targetRow(type);
    const expectedStatus = type === "application" ? "sent" : type === "ad_marquee" ? "paid" : "published";
    assert.equal(first.financial_status, "succeeded");
    assert.equal(first.fulfillment_status, "applied");
    assert.equal(first.applied_now, true);
    assert.equal(first.target_status, expectedStatus);
    assert.equal(target.status, expectedStatus);
    if (["listing", "vacancy", "workRequest"].includes(type)) {
      assert.equal(target.is_paid, true);
      assert.equal(Date.parse(target.expires_at) - Date.parse(first.paid_at), 30 * 86400_000);
      assert.equal(Date.parse(target.published_at), Date.parse(first.paid_at));
    }
    if (type === "ad_marquee") {
      assert.equal(target.payment_id, id(100));
      assert.equal(Date.parse(target.paid_at), Date.parse(first.paid_at));
      assert.equal(target.starts_at, null);
      assert.equal(target.ends_at, null);
    }
    const replay = await rpc();
    assert.equal(replay.applied_now, false);
    assert.equal(replay.target_applied_at, first.target_applied_at);
    assert.deepEqual(await targetRow(type), target);
    assert.equal(await effectCount(type), 1);
    if (type === "application") {
      const notices = await json("select coalesce(json_agg(n), '[]'::json) from public.notifications n;");
      assert.equal(notices.length, 1);
      assert.equal(notices[0].payment_id, id(100));
      assert.equal(notices[0].user_id, ownerB);
      assert.equal(notices[0].event, "application_paid");
      assert.equal(notices[0].subject, "Новый отклик на вакансию");
      assert.equal(notices[0].body, "Исполнитель оплатил и отправил отклик на «Synthetic vacancy». Откройте раздел «Отклики», чтобы посмотреть анкету и контакты.");
    }
  });

  test(`${type} preserves financial success but blocks a foreign owner without target writes`, async () => {
    await payment(type, { owner: ownerB });
    const target = await targetRow(type);
    const result = await rpc();
    assert.equal(result.financial_status, "succeeded");
    assert.equal(result.fulfillment_status, "blocked");
    assert.equal(result.fulfillment_reason, "target_owner_mismatch");
    assert.equal(result.target_applied_at, null);
    assert.deepEqual(await targetRow(type), target);
    assert.equal(await effectCount(type), 0);
    assert.equal((await storedPayment()).status, "succeeded");
    assert.equal(Number(await sql("select count(*) from public.notifications;")), 0);
  });
}

test("missing target, owner, unsupported specialist and provider mismatch never report publication", async () => {
  for (const [offset, type, options, reason] of [
    [0, "listing", { target: id(999) }, "target_missing"],
    [1, "listing", { owner: null }, "payment_owner_missing"],
    [2, "specialist", {}, "unsupported_target_type"],
  ]) {
    const p = await payment(type, { ...options, id: id(100 + offset) });
    const result = await rpc(p.id, p.providerId);
    assert.equal(result.fulfillment_status, "blocked");
    assert.equal(result.fulfillment_reason, reason);
    assert.equal(result.financial_status, "succeeded");
  }
  const p = await payment("listing", { id: id(103) });
  const original = await storedPayment(p.id);
  await assert.rejects(rpc(p.id, "wrong-provider-id"), /Payment provider binding mismatch/);
  assert.deepEqual(await storedPayment(p.id), original);
  const mock = await payment("listing", { id: id(104), provider: "mock" });
  await assert.rejects(rpc(mock.id, mock.providerId), /Payment provider binding mismatch/);
  await assert.rejects(rpc(id(999), "unknown"), /Payment not found/);
});

test("unsettled payment remains pending without granting an entitlement", async () => {
  await payment("listing", { status: "pending", paidAt: null });
  const result = await rpc();
  assert.equal(result.fulfillment_status, "pending");
  assert.equal(result.financial_status, "pending");
  assert.equal(result.applied_now, false);
  assert.equal(await effectCount("listing"), 0);
});

test("migration grants no historical work-request paid flag, expiry or checkout snapshot", async () => {
  const observation = await json("select row_to_json(o) from private.fulfillment_test_migration_observation o;");
  assert.equal(observation.work_request.is_paid, false);
  assert.equal(observation.work_request.expires_at, null);
  assert.equal(observation.work_request.published_at, "2020-01-01T12:00:00+00:00");
  assert.equal(observation.payment.purchased_duration_days, null);
  assert.equal(observation.payment.paid_at, null);
  assert.equal(observation.payment.fulfillment_status, "pending");
});

test("fulfillment outcome enforces a non-NULL bounded blocked reason and valid marker", async () => {
  await payment();
  for (const assignment of [
    "fulfillment_status = 'blocked', fulfillment_reason = null",
    "fulfillment_status = 'blocked', fulfillment_reason = 'unbounded-arbitrary-message'",
    "fulfillment_status = 'pending', fulfillment_reason = 'target_missing'",
    "fulfillment_status = 'applied', target_applied_at = null",
    "fulfillment_status = 'other'",
  ]) {
    await assert.rejects(sql(`update public.payments set ${assignment} where id = '${id(100)}';`, true), /payments_fulfillment_/);
  }
  assert.equal((await storedPayment()).fulfillment_status, "pending");
});

test("first genuine financial transition records paid_at but historical NULL success remains unknown", async () => {
  const current = await payment("listing", { status: "pending", paidAt: null });
  await sql(`update public.payments set status = 'succeeded' where id = '${current.id}';`, true);
  const settled = await storedPayment(current.id);
  assert.ok(settled.paid_at);
  await sql(`update public.payments set status = 'pending', paid_at = clock_timestamp() + interval '1 day' where id = '${current.id}';`, true);
  assert.equal((await storedPayment(current.id)).paid_at, settled.paid_at);
  const legacy = await payment("listing", { id: id(101), paidAt: null });
  await sql(`update public.payments set provider_payment_id = provider_payment_id where id = '${legacy.id}';`, true);
  assert.equal((await storedPayment(legacy.id)).paid_at, null);
  await sql(`update public.payments set paid_at = clock_timestamp() where id = '${legacy.id}';`, true);
  assert.equal((await storedPayment(legacy.id)).paid_at, null, "ordinary PATCH cannot invent a historical financial timestamp");
});

test("terminal and already-paid targets fail closed and blocked outcome cannot be reset by replay", async () => {
  for (const [offset, status] of ["archived", "expired", "rejected", "sold", "published"].entries()) {
    await sql(`update public.listings set status = '${status}' where id = '${id(10)}';`);
    const p = await payment("listing", { id: id(100 + offset) });
    const count = await effectCount("listing");
    const result = await rpc(p.id, p.providerId);
    assert.equal(result.fulfillment_status, "blocked");
    assert.equal(result.fulfillment_reason, "target_not_eligible");
    assert.equal(await effectCount("listing"), count);
    await sql(`update public.listings set status = 'pending_payment' where id = '${id(10)}';
      update public.payments set fulfillment_status = 'pending', fulfillment_reason = null, target_applied_at = clock_timestamp() where id = '${p.id}';`);
    const replay = await rpc(p.id, p.providerId);
    assert.equal(replay.fulfillment_status, "blocked");
    assert.equal(replay.target_applied_at, null);
  }
});

test("publication checkout requires pending_payment and unpaid for all three publication kinds", async () => {
  let sequence = 100;
  for (const type of ["listing", "vacancy", "workRequest"]) {
    for (const assignment of ["status = 'draft', is_paid = false", "status = 'pending_payment', is_paid = true"]) {
      await sql(`update public.${targetTable(type)} set ${assignment} where id = '${id(targets[type])}';`);
      const p = await payment(type, { id: id(sequence++) });
      const before = await targetRow(type);
      const count = await effectCount(type);
      assert.equal((await rpc(p.id, p.providerId)).fulfillment_reason, "target_not_eligible");
      assert.deepEqual(await targetRow(type), before);
      assert.equal(await effectCount(type), count);
    }
  }
});

test("fair rejected or settled/refunded application never republishes", async () => {
  for (const [offset, assignment] of [
    "status = 'rejected'", "status = 'pending_payment', payment_status = 'succeeded'", "payment_status = 'refunded'",
  ].entries()) {
    await sql(`update public.fair_applications set ${assignment} where id = '${id(13)}';`);
    const p = await payment("fair_application", { id: id(100 + offset) });
    const before = await targetRow("fair_application");
    const count = await effectCount("fair_application");
    assert.equal((await rpc(p.id, p.providerId)).fulfillment_reason, "target_not_eligible");
    assert.deepEqual(await targetRow("fair_application"), before);
    assert.equal(await effectCount("fair_application"), count);
  }
});

test("NULL duration/paid_at and elapsed paid windows block without today-based legacy repair", async () => {
  for (const [offset, options, reason] of [
    [0, { duration: null }, "duration_missing"],
    [1, { paidAt: null }, "payment_missing_paid_at"],
    [2, { paidAt: "2020-01-01T12:34:56.789Z", duration: 7 }, "entitlement_expired"],
  ]) {
    const p = await payment("listing", { ...options, id: id(100 + offset) });
    const before = await storedPayment(p.id);
    const result = await rpc(p.id, p.providerId);
    assert.equal(result.fulfillment_status, "blocked");
    assert.equal(result.fulfillment_reason, reason);
    const after = await storedPayment(p.id);
    assert.equal(after.paid_at, before.paid_at);
    assert.equal(after.purchased_duration_days, before.purchased_duration_days);
    assert.equal(await effectCount("listing"), 0);
  }
});

test("duration snapshot is bounded, once-set immutable, and independent of mutable current tariff", async () => {
  const p = await payment("vacancy", { duration: 9 });
  await sql(`update public.payments set purchased_duration_days = 30 where id = '${p.id}';
    update public.tariffs set duration_days = 90 where action = 'vacancy_publication';`);
  assert.equal((await storedPayment()).purchased_duration_days, 9);
  const result = await rpc();
  assert.equal(Date.parse((await targetRow("vacancy")).expires_at) - Date.parse(result.paid_at), 9 * 86400_000);
  for (const invalid of [0, -1, 366]) {
    await assert.rejects(payment("listing", { id: id(200 + invalid + 1), duration: invalid }), /payments_purchased_duration_days_check/);
  }
});

test("audited NULL-to-known snapshot is allowed before first fulfillment, not a blocked retry reset", async () => {
  const audited = await payment("vacancy", { duration: null });
  await sql(`update public.payments set purchased_duration_days = 9 where id = '${audited.id}';`, true);
  assert.equal((await rpc()).fulfillment_status, "applied");
  const blocked = await payment("listing", { id: id(101), duration: null });
  assert.equal((await rpc(blocked.id, blocked.providerId)).fulfillment_reason, "duration_missing");
  await sql(`update public.payments set purchased_duration_days = 9, fulfillment_status = 'pending', fulfillment_reason = null where id = '${blocked.id}';`, true);
  const replay = await rpc(blocked.id, blocked.providerId);
  assert.equal(replay.fulfillment_status, "blocked");
  assert.equal(replay.fulfillment_reason, "duration_missing");
  assert.equal(await effectCount("listing"), 0);
});

test("financial refunded remains terminal after stale provider success and causes no target write", async () => {
  await payment();
  const before = await storedPayment();
  await sql(`update public.payments set status = 'refunded' where id = '${id(100)}';`, true);
  await sql(`update public.payments set status = 'succeeded', paid_at = clock_timestamp() where id = '${id(100)}';`, true);
  const result = await rpc();
  assert.equal(result.financial_status, "refunded");
  assert.equal(result.fulfillment_status, "pending");
  assert.equal(result.paid_at, before.paid_at);
  assert.equal(result.applied_now, false);
  assert.equal(await effectCount("listing"), 0);
});

test("historical target marker and paid_at (including NULL) are immutable and cause zero target writes", async () => {
  for (const [offset, paidAt] of ["2020-01-01T12:34:56.789Z", null].entries()) {
    const p = await payment("listing", { id: id(100 + offset), duration: null, paidAt });
    // Model a pre-migration marker, without running the new UPDATE trigger.
    await sql(`alter table public.payments disable trigger preserve_payment_settlement_state;
      update public.payments set target_applied_at = '2020-01-01T12:35:00.123Z' where id = '${p.id}';
      alter table public.payments enable trigger preserve_payment_settlement_state;`);
    const before = await storedPayment(p.id);
    const result = await rpc(p.id, p.providerId);
    assert.equal(result.fulfillment_status, "applied");
    assert.equal(result.applied_now, false);
    assert.equal(result.paid_at, before.paid_at);
    assert.equal(result.target_applied_at, before.target_applied_at);
    await sql(`update public.payments set status = 'pending', paid_at = clock_timestamp(), target_applied_at = null, fulfillment_status = 'pending' where id = '${p.id}';`);
    const after = await storedPayment(p.id);
    assert.equal(after.status, "succeeded");
    assert.equal(after.paid_at, before.paid_at);
    assert.equal(after.target_applied_at, before.target_applied_at);
    assert.equal(after.fulfillment_status, "applied");
    assert.equal(await effectCount("listing"), 0);
  }
});

test("application requires a live paid parent and emits work-request notification semantics", async () => {
  await sql(`update public.applications set vacancy_id = null, work_request_id = '${parentWorkRequest}' where id = '${id(15)}';`);
  await payment("application");
  const result = await rpc();
  assert.equal(result.target_status, "sent");
  const notice = await json("select row_to_json(n) from public.notifications n;");
  assert.equal(notice.subject, "Новый отклик на заказ");
  assert.match(notice.body, /«Synthetic work request»/);
});

test("application parent status, paid flag and expiry are eligibility requirements", async () => {
  for (const [offset, assignment] of ["status = 'archived'", "status = 'published', is_paid = false", "is_paid = true, expires_at = clock_timestamp()"].entries()) {
    await sql(`update public.vacancies set ${assignment} where id = '${parentVacancy}';`);
    const p = await payment("application", { id: id(100 + offset) });
    assert.equal((await rpc(p.id, p.providerId)).fulfillment_reason, "parent_not_eligible");
    assert.equal(await effectCount("application"), 0);
    assert.equal(Number(await sql("select count(*) from public.notifications;")), 0);
  }
});

for (const kind of ["vacancy", "workRequest"]) {
  const parentTable = targetTable(kind);
  const parentId = kind === "vacancy" ? parentVacancy : parentWorkRequest;
  const relation = kind === "vacancy" ? `vacancy_id = '${parentId}', work_request_id = null` : `vacancy_id = null, work_request_id = '${parentId}'`;

  test(`application self-response on own ${kind} blocks existing paid settlement before any application/notice write`, async () => {
    await sql(`update public.applications set ${relation} where id = '${id(15)}';
      update public.${parentTable} set author_id = '${ownerA}' where id = '${parentId}';
      truncate private.fulfillment_test_effects;`);
    await payment("application");
    const before = await targetRow("application");
    const result = await rpc();
    assert.equal(result.fulfillment_status, "blocked");
    assert.equal(result.fulfillment_reason, "parent_not_eligible");
    assert.equal(result.financial_status, "succeeded");
    assert.equal(result.applied_now, false);
    assert.equal(result.target_applied_at, null);
    assert.deepEqual(await targetRow("application"), before);
    assert.equal(await effectCount("application"), 0);
    assert.equal(Number(await sql("select count(*) from public.notifications;")), 0);
  });

  test(`application self-response rechecks ${kind} parent owner changed after checkout under the parent lock`, async () => {
    await sql(`update public.applications set ${relation} where id = '${id(15)}'; truncate private.fulfillment_test_effects;`);
    await payment("application", { status: "pending", paidAt: null });
    assert.equal((await targetRow(kind, parentId)).author_id, ownerB, "a distinct employer was eligible at checkout");
    await sql(`update public.payments set status = 'succeeded', paid_at = clock_timestamp() - interval '1 minute' where id = '${id(100)}';`, true);
    const moderator = connection(`fulfillment_self_${kind}_moderator`);
    const payer = connection(`fulfillment_self_${kind}_payer`);
    try {
      await moderator.begin();
      await moderator.command(`update public.${parentTable} set author_id = '${ownerA}' where id = '${parentId}';`);
      await payer.begin();
      const pending = payer.command(`select row_to_json(result) from public.apply_payment_fulfillment('${id(100)}', 'synthetic-yookassa-100') result;`);
      await waitForLock(payer.name);
      await moderator.command("commit;");
      const result = JSON.parse(await pending);
      await payer.command("commit;");
      assert.equal(result.fulfillment_status, "blocked");
      assert.equal(result.fulfillment_reason, "parent_not_eligible");
      assert.equal(result.financial_status, "succeeded");
      assert.equal(result.applied_now, false);
      assert.equal((await targetRow("application")).status, "pending_payment");
      assert.equal(await effectCount("application"), 0);
      assert.equal(Number(await sql("select count(*) from public.notifications;")), 0);
    } finally { moderator.close(); payer.close(); }
  });

  test(`application distinct ${kind} employer remains eligible and receives exactly one notice`, async () => {
    await sql(`update public.applications set ${relation} where id = '${id(15)}'; truncate private.fulfillment_test_effects;`);
    await payment("application");
    assert.equal((await targetRow(kind, parentId)).author_id, ownerB);
    assert.equal((await rpc()).fulfillment_status, "applied");
    await rpc();
    assert.equal(await effectCount("application"), 1);
    const notices = await json("select json_agg(n) from public.notifications n;");
    assert.equal(notices.length, 1);
    assert.equal(notices[0].user_id, ownerB);
    assert.equal(notices[0].payment_id, id(100));
  });
}

for (const type of Object.keys(targets)) {
  test(`${type} suppressed target UPDATE fails closed without applied marker or notification`, async () => {
    await payment(type);
    const before = await targetRow(type);
    await sql(`create trigger suppress_fulfillment_test_write before update on public.${targetTable(type)}
      for each row execute function private.suppress_fulfillment_test_write();`);
    const result = await rpc();
    assert.equal(result.fulfillment_status, "blocked");
    assert.equal(result.fulfillment_reason, "target_changed");
    assert.equal(result.financial_status, "succeeded");
    assert.equal(result.applied_now, false);
    assert.equal(result.target_applied_at, null);
    assert.deepEqual(await targetRow(type), before);
    assert.equal(await effectCount(type), 0);
    assert.equal(Number(await sql("select count(*) from public.notifications;")), 0);
  });
}

test("suppressed payment metadata UPDATE cannot commit an unmarked target or return a NULL/false outcome", async () => {
  for (const [offset, outcome] of ["applied", "blocked", "legacy"].entries()) {
    const p = await payment("application", { id: id(100 + offset), owner: outcome === "blocked" ? ownerB : ownerA });
    if (outcome === "legacy") {
      await sql(`alter table public.payments disable trigger preserve_payment_settlement_state;
        update public.payments set target_applied_at = '2020-01-01T12:35:00Z' where id = '${p.id}';
        alter table public.payments enable trigger preserve_payment_settlement_state;`);
    }
    const before = await storedPayment(p.id);
    const target = await targetRow("application");
    const count = await effectCount("application");
    const noticeCount = Number(await sql("select count(*) from public.notifications;"));
    await sql("create trigger suppress_fulfillment_test_write before update on public.payments for each row execute function private.suppress_fulfillment_test_write();");
    await assert.rejects(rpc(p.id, p.providerId), /query returned no rows/);
    assert.deepEqual(await storedPayment(p.id), before);
    assert.deepEqual(await targetRow("application"), target);
    assert.equal(await effectCount("application"), count);
    assert.equal(Number(await sql("select count(*) from public.notifications;")), noticeCount);
    await sql("drop trigger suppress_fulfillment_test_write on public.payments;");
    assert.equal((await rpc(p.id, p.providerId)).fulfillment_status, outcome === "blocked" ? "blocked" : "applied");
  }
});

test("suppressed notification INSERT rolls target and marker back while committed financial success survives", async () => {
  await payment("application");
  const before = await storedPayment();
  const target = await targetRow("application");
  await sql("create trigger suppress_fulfillment_test_write before insert on public.notifications for each row execute function private.suppress_fulfillment_test_write();");
  await assert.rejects(rpc(), /Application fulfillment notification write failed/);
  assert.deepEqual(await storedPayment(), before);
  assert.deepEqual(await targetRow("application"), target);
  assert.equal(await effectCount("application"), 0);
  assert.equal(Number(await sql("select count(*) from public.notifications;")), 0);
  await sql("drop trigger suppress_fulfillment_test_write on public.notifications;");
  assert.equal((await rpc()).fulfillment_status, "applied");
  assert.equal(Number(await sql("select count(*) from public.notifications;")), 1);
});

test("marquee requires moderation approval/payment eligibility", async () => {
  for (const [offset, assignment] of ["approved_at = null", "approved_at = clock_timestamp(), status = 'rejected'", "status = 'pending_payment', payment_status = 'refunded'", "payment_status = 'succeeded'"].entries()) {
    await sql(`update public.ad_marquee_placements set ${assignment} where id = '${id(14)}';`);
    const p = await payment("ad_marquee", { id: id(100 + offset) });
    const before = await targetRow("ad_marquee");
    assert.equal((await rpc(p.id, p.providerId)).fulfillment_reason, "target_not_eligible");
    assert.deepEqual(await targetRow("ad_marquee"), before);
  }
});

test("legacy applied active marquee keeps its original binding and entire interval without any write", async () => {
  await payment("ad_marquee", { paidAt: "2020-01-01T12:34:56Z", duration: null });
  await sql(`update public.ad_marquee_placements set status = 'active', payment_status = 'succeeded',
    payment_id = '${id(100)}', paid_at = '2020-01-01T12:34:56Z', starts_at = '2020-01-02T12:00:00Z', ends_at = '2020-01-09T12:00:00Z'
    where id = '${id(14)}';
    alter table public.payments disable trigger preserve_payment_settlement_state;
    update public.payments set target_applied_at = '2020-01-01T12:35:00Z' where id = '${id(100)}';
    alter table public.payments enable trigger preserve_payment_settlement_state;
    truncate private.fulfillment_test_effects;`);
  const before = await targetRow("ad_marquee");
  assert.equal((await rpc()).fulfillment_status, "applied");
  await rpc();
  assert.deepEqual(await targetRow("ad_marquee"), before);
  assert.equal(await effectCount("ad_marquee"), 0);
});

test("application payment/event uniqueness prevents a second semantic notification", async () => {
  await payment("application");
  await rpc();
  await assert.rejects(sql(`insert into public.notifications (payment_id, user_id, event, subject, body)
    values ('${id(100)}', '${ownerB}', 'application_paid', 'duplicate', 'duplicate');`, true), /notifications_payment_event_unique/);
  assert.equal(Number(await sql("select count(*) from public.notifications;")), 1);
});

test("notification failure rolls target/marker/outcome back, never the already committed financial success", async () => {
  await payment("application");
  await sql("create trigger fail_fulfillment_test_notification before insert on public.notifications for each row execute function private.fail_fulfillment_test_notification();");
  await assert.rejects(rpc(), /synthetic notification insertion failure/);
  const p = await storedPayment();
  assert.equal(p.status, "succeeded");
  assert.equal(p.fulfillment_status, "pending");
  assert.equal(p.target_applied_at, null);
  assert.equal((await targetRow("application")).status, "pending_payment");
  assert.equal(await effectCount("application"), 0);
  await sql("drop trigger fail_fulfillment_test_notification on public.notifications;");
  assert.equal((await rpc()).fulfillment_status, "applied");
  await rpc();
  assert.equal(Number(await sql("select count(*) from public.notifications;")), 1);
});

test("independent stale snapshots serialize on the payment and change the period only once", async () => {
  await payment();
  const first = connection("fulfillment_first");
  const stale = connection("fulfillment_stale");
  try {
    await stale.begin();
    const snapshot = JSON.parse(await stale.command(`select row_to_json(p) from public.payments p where id = '${id(100)}';`));
    assert.equal(snapshot.target_applied_at, null);
    await first.begin();
    const applied = JSON.parse(await first.command(`select row_to_json(result) from public.apply_payment_fulfillment('${id(100)}', 'synthetic-yookassa-100') result;`));
    const pending = stale.command(`select row_to_json(result) from public.apply_payment_fulfillment('${id(100)}', 'synthetic-yookassa-100') result;`);
    await waitForLock(stale.name);
    const waitedAtPayment = await sql(`select exists(select 1 from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where a.datname = '${database}' and a.application_name = '${stale.name}' and l.locktype = 'tuple'
        and l.relation = 'public.payments'::regclass);`);
    await first.command("commit;");
    const replay = JSON.parse(await pending);
    await stale.command("commit;");
    assert.equal(waitedAtPayment, "t", "wait barrier must be the payment lock, not a later target lock");
    assert.equal(replay.applied_now, false);
    assert.equal(replay.target_applied_at, applied.target_applied_at);
    assert.equal(await effectCount("listing"), 1);
    assert.equal(Date.parse((await targetRow("listing")).published_at), Date.parse(applied.paid_at));
  } finally { first.close(); stale.close(); }
});

test("independent payments for the same target grant one purchased window, never extend it twice", async () => {
  const firstPayment = await payment();
  const otherPayment = await payment("listing", { id: id(101), duration: 9 });
  const first = connection("fulfillment_duplicate_first");
  const other = connection("fulfillment_duplicate_other");
  try {
    await first.begin();
    await first.command(`select public.apply_payment_fulfillment('${firstPayment.id}', '${firstPayment.providerId}');`);
    await other.begin();
    const pending = other.command(`select row_to_json(result) from public.apply_payment_fulfillment('${otherPayment.id}', '${otherPayment.providerId}') result;`);
    await waitForLock(other.name);
    await first.command("commit;");
    const result = JSON.parse(await pending);
    await other.command("commit;");
    assert.equal(result.fulfillment_status, "blocked");
    assert.equal(result.fulfillment_reason, "target_not_eligible");
    assert.equal(result.financial_status, "succeeded");
    assert.equal(await effectCount("listing"), 1);
    assert.equal(Date.parse((await targetRow("listing")).expires_at) - Date.parse((await storedPayment(firstPayment.id)).paid_at), 30 * 86400_000);
  } finally { first.close(); other.close(); }
});

test("application parent pointer is rechecked after waiting for the original parent lock", async () => {
  await payment("application");
  const moderator = connection("fulfillment_parent_pointer_moderator");
  const payer = connection("fulfillment_parent_pointer_payer");
  try {
    await moderator.begin();
    await moderator.command(`select id from public.vacancies where id = '${parentVacancy}' for update;`);
    await payer.begin();
    const pending = payer.command(`select row_to_json(result) from public.apply_payment_fulfillment('${id(100)}', 'synthetic-yookassa-100') result;`);
    await waitForLock(payer.name);
    await sql(`update public.applications set vacancy_id = null, work_request_id = '${parentWorkRequest}' where id = '${id(15)}';`);
    await moderator.command("commit;");
    assert.equal(JSON.parse(await pending).fulfillment_reason, "target_changed");
    await payer.command("commit;");
    assert.equal((await targetRow("application")).status, "pending_payment");
    assert.equal(Number(await sql("select count(*) from public.notifications;")), 0);
    assert.equal(await effectCount("application"), 1, "only external relation edit committed");
  } finally { moderator.close(); payer.close(); }
});

for (const mutation of ["status = 'rejected'", `author_id = '${ownerB}'`]) {
  test(`locked target rechecks a concurrent moderation/owner change: ${mutation}`, async () => {
    await payment();
    const moderator = connection("fulfillment_target_moderator");
    const payer = connection("fulfillment_target_payer");
    try {
      await moderator.begin();
      await moderator.command(`update public.listings set ${mutation} where id = '${id(10)}';`);
      await payer.begin();
      const pending = payer.command(`select row_to_json(result) from public.apply_payment_fulfillment('${id(100)}', 'synthetic-yookassa-100') result;`);
      await waitForLock(payer.name);
      await moderator.command("commit;");
      assert.equal(JSON.parse(await pending).fulfillment_status, "blocked");
      await payer.command("commit;");
      assert.equal(await effectCount("listing"), 1, "only moderator's physical target write committed");
      assert.equal((await storedPayment()).status, "succeeded");
    } finally { moderator.close(); payer.close(); }
  });
}

for (const mutation of ["delete", "moderation", "expiry"]) {
  test(`application parent ${mutation} race uses parent-before-application locks and live clock`, async () => {
    await payment("application");
    const moderator = connection("fulfillment_parent_moderator");
    const payer = connection("fulfillment_parent_payer");
    try {
      await moderator.begin();
      await moderator.command(`select id from public.vacancies where id = '${parentVacancy}' for update;`);
      await payer.begin();
      const pending = payer.command(`select row_to_json(result) from public.apply_payment_fulfillment('${id(100)}', 'synthetic-yookassa-100') result;`);
      await waitForLock(payer.name);
      await moderator.command(mutation === "delete"
        ? `delete from public.vacancies where id = '${parentVacancy}';`
        : `update public.vacancies set ${mutation === "moderation" ? "status = 'archived'" : "expires_at = clock_timestamp()"} where id = '${parentVacancy}';`);
      await moderator.command("commit;");
      assert.equal(JSON.parse(await pending).fulfillment_status, "blocked");
      await payer.command("commit;");
      assert.equal((await storedPayment()).status, "succeeded");
      assert.equal(Number(await sql("select count(*) from public.notifications;")), 0);
      assert.equal(await effectCount("application"), 0);
    } finally { moderator.close(); payer.close(); }
  });
}

test("backend crash after target mutation rolls the entire fulfillment transaction back and retry applies once", async () => {
  await payment();
  const worker = connection("fulfillment_crash_worker");
  try {
    await worker.begin();
    const pid = Number(await worker.command("select pg_backend_pid();"));
    await worker.command(`select row_to_json(result) from public.apply_payment_fulfillment('${id(100)}', 'synthetic-yookassa-100') result;`);
    assert.equal((await targetRow("listing")).status, "pending_payment", "uncommitted effects stay invisible to independent connection");
    assert.equal(await sql(`select pg_terminate_backend(pid) from pg_stat_activity where pid = ${pid} and datname = '${database}' and application_name = '${worker.name}';`), "t");
    assert.equal((await storedPayment()).status, "succeeded");
    assert.equal((await storedPayment()).target_applied_at, null);
    assert.equal((await storedPayment()).fulfillment_status, "pending");
    assert.equal(await effectCount("listing"), 0);
    assert.equal((await rpc()).applied_now, true);
    assert.equal((await rpc()).applied_now, false);
    assert.equal(await effectCount("listing"), 1);
  } finally { worker.close(); }
});
