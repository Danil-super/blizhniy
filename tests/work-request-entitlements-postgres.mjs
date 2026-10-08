import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import test, { after, before, beforeEach } from "node:test";

// Explicit opt-in only: cached PostgreSQL17, isolated Unix socket, no network/env.
const run = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const container = "blizhniy-work-entitlements-pg17-20261007";
const database = "blizhniy_work_entitlements_fixture";
const migration = "20261007194452_restore_work_request_within_paid_window.sql";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(1), other = id(2), work = id(12), payment = id(100);
let owned = false;
const docker = async (args) => (await run("docker", args, { timeout: 12_000, maxBuffer: 2 * 1024 * 1024 })).stdout.trim();
const args = () => ["exec", "-i", container, "psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database];
const sql = (statement, service = false) => docker([...args(), "-c", `set statement_timeout='5s'; ${service ? "set role service_role;" : ""} ${statement}`]);
const json = async (statement, service = false) => JSON.parse(await sql(statement, service));
const restore = (actor = owner) => json(`select coalesce(json_agg(json_build_object('id',r.id)),'[]'::json) from public.restore_work_request_within_paid_window('${work}','${actor}') r;`, true);
const target = () => json(`select row_to_json(w) from public.work_requests w where id='${work}';`);
const pay = () => json(`select row_to_json(p) from public.payments p where id='${payment}';`);
let beforeInventory, afterInventory;
const inventory = async () => JSON.parse(await docker([...args(), "-f", "/work/supabase/maintenance/inventory-legacy-publication-entitlements.sql"]));

before(async () => {
  await docker(["run", "--detach", "--pull", "never", "--network", "none", "--name", container,
    "--label", "blizhniy.work-entitlements=contact_privacy_fix", "--tmpfs", "/var/lib/postgresql/data",
    "--mount", `type=bind,source=${root},target=/work,readonly`, "-e", `POSTGRES_DB=${database}`,
    "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17-alpine", "-c", "listen_addresses=", "-c", "timezone=UTC"]);
  owned = true;
  const deadline = Date.now() + 8000;
  while (true) { try { await sql("select 1;"); break; } catch (error) { if (Date.now() > deadline) throw error; } }
  assert.match(await sql("show server_version;"), /^17\./);
  await docker([...args(), "-v", "apply_fulfillment_migration=0", "-f", "/work/tests/fixtures/payment-fulfillment.sql"]);
  await sql("update public.payments set status='succeeded',paid_at='2026-10-01T12:00:00Z' where id='00000000-0000-4000-8000-000000000901';");
  const legacyBefore = await json("select row_to_json(w) from public.work_requests w where id='00000000-0000-4000-8000-000000000900';");
  beforeInventory = await inventory();
  assert.deepEqual(await json("select row_to_json(w) from public.work_requests w where id='00000000-0000-4000-8000-000000000900';"), legacyBefore);
  await docker([...args(), "-f", "/work/supabase/migrations/20261007180000_apply_payment_fulfillment_atomically.sql"]);
  const legacyAfter = await json("select row_to_json(w) from public.work_requests w where id='00000000-0000-4000-8000-000000000900';");
  afterInventory = await inventory();
  assert.deepEqual(await json("select row_to_json(w) from public.work_requests w where id='00000000-0000-4000-8000-000000000900';"), legacyAfter);
  await docker([...args(), "-f", `/work/supabase/migrations/${migration}`]);
});

test("read-only inventory distinguishes absent columns from legacy defaults without deciding financial failure", async () => {
  for (const report of [beforeInventory, afterInventory]) {
    assert.equal(report.read_only, "on");
    const legacy = report.publications.find((item) => item.id === id(900));
    assert.equal(legacy.window_state, "unknown"); assert.equal(legacy.status, "published");
    assert.equal(legacy.payments[0].financial_status, "succeeded"); assert.equal(legacy.payments[0].purchased_duration_days, null);
    assert.equal(legacy.payments[0].paid_at, "2026-10-01T12:00:00+00:00");
  }
  assert.equal(beforeInventory.publications[0].has_paid_column, false);
  assert.equal(beforeInventory.publications[0].stored_is_paid, null);
  assert.equal(afterInventory.publications[0].has_paid_column, true);
  assert.equal(afterInventory.publications[0].stored_is_paid, false);
});
after(async () => {
  if (!owned) return;
  assert.equal(await docker(["inspect", "--format", '{{index .Config.Labels "blizhniy.work-entitlements"}}', container]), "contact_privacy_fix");
  await docker(["rm", "--force", container]);
});
beforeEach(async () => {
  await sql(`drop trigger if exists suppress_work_restore on public.work_requests;
    truncate public.notifications, public.payments, public.work_requests cascade;
    insert into public.work_requests(id,author_id,title,description,region_id,city_id,status,is_paid,published_at,expires_at)
    select '${work}','${owner}','Synthetic work','Fixture only',region_id,id,'archived',true,
      '2026-10-01T12:00:00Z','2099-01-02T12:00:00Z' from public.cities limit 1;
    update public.work_requests set expires_at = clock_timestamp() + interval '10 days' where id='${work}';
    insert into public.payments(id,user_id,target_type,target_id,provider,provider_payment_id,amount,status,paid_at,
      purchased_duration_days,target_applied_at,fulfillment_status)
    select '${payment}','${owner}','workRequest','${work}','yookassa','synthetic-work-100',199,'succeeded',
      expires_at - interval '30 days',30,'2026-10-01T12:00:00Z','applied' from public.work_requests where id='${work}';
    truncate private.fulfillment_test_effects;`);
});

function connection(name) {
  const child = spawn("docker", args(), { stdio: ["pipe", "pipe", "pipe"] });
  let buffer = "", errors = "", sequence = 0, pending;
  child.stdout.on("data", (data) => {
    buffer += data;
    if (pending && buffer.includes(pending.marker)) {
      const [output, rest] = buffer.split(pending.marker); buffer = rest;
      clearTimeout(pending.timer); pending.resolve(output.trim()); pending = undefined;
    }
  });
  child.stderr.on("data", (data) => { errors += data; });
  child.stdin.on("error", () => {});
  child.on("exit", (code) => { if (pending) { clearTimeout(pending.timer); pending.reject(new Error(`Independent connection exited ${code}: ${errors}`)); pending = undefined; } });
  return {
    command(statement) {
      assert.equal(Boolean(pending), false);
      buffer = "";
      return new Promise((resolve, reject) => {
        const marker = `__WORK_BARRIER_${++sequence}__`;
        const timer = setTimeout(() => reject(new Error(`Lock barrier timeout: ${errors}`)), 7000);
        pending = { marker, timer, resolve, reject };
        child.stdin.write(`${statement}\n\\echo ${marker}\n`);
      });
    },
    begin() { return this.command(`set application_name='${name}'; set statement_timeout='5s'; begin; set local role service_role;`); },
    close() { child.stdin.end("\\q\n"); },
  };
}
async function lockBarrier(name) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) if (await sql(`select exists(select 1 from pg_stat_activity where datname='${database}' and application_name='${name}' and wait_event_type='Lock');`) === "t") return;
  assert.fail(`Actual PostgreSQL connection ${name} did not reach lock wait`);
}
const restoreSql = `select coalesce(json_agg(json_build_object('id',r.id)),'[]'::json) from public.restore_work_request_within_paid_window('${work}','${owner}') r;`;

for (const [label, update] of [
  ["expired", "expires_at=clock_timestamp()-interval '1 second'"], ["unknown expiry", "expires_at=null"],
  ["legacy unpaid flag", "is_paid=false"], ["moderation rejection", "status='rejected'"], ["foreign current owner", `author_id='${other}'`],
  ["window does not match purchased snapshot", "expires_at=expires_at+interval '1 day'"],
]) test(`restore refuses ${label} without any write`, async () => {
  await sql(`update public.work_requests set ${update} where id='${work}'; truncate private.fulfillment_test_effects;`);
  const before = await target();
  assert.deepEqual(await restore(), []);
  assert.deepEqual(await target(), before);
  assert.equal(await sql("select count(*) from private.fulfillment_test_effects;"), "0");
});

for (const [label, change] of [
  ["foreign payer", `user_id='${other}'`], ["unknown capture", "paid_at=null"], ["unknown duration", "purchased_duration_days=null"],
  ["unapplied", "target_applied_at=null,fulfillment_status='pending'"], ["refund", "status='refunded'"],
  ["pending financial payment", "status='pending',target_applied_at=null,fulfillment_status='pending'"],
  ["expired captured window", "paid_at='2020-01-01T12:00:00Z'"],
  ["mock provider", "provider='mock'"], ["wrong target", `target_id='${id(99)}'`], ["empty provider ID", "provider_payment_id=''"],
]) test(`restore refuses payment provenance ${label}`, async () => {
  // INSERT synthetic historical states; immutable production guards must not be bypassed by UPDATE.
  await sql(`create temp table replacement as select * from public.payments where id='${payment}';
    delete from public.payments where id='${payment}'; update replacement set ${change}; insert into public.payments select * from replacement;`);
  const before = await target(), beforePayment = await pay();
  assert.deepEqual(await restore(), []); assert.deepEqual(await target(), before); assert.deepEqual(await pay(), beforePayment);
});

test("caller cannot transfer or consume another current owner's paid window", async () => {
  assert.deepEqual(await restore(other), []);
  assert.equal((await target()).status, "archived");
});

test("BEFORE suppression never reports successful restore", async () => {
  await sql("create trigger suppress_work_restore before update on public.work_requests for each row execute function private.suppress_fulfillment_test_write();");
  assert.deepEqual(await restore(), []); assert.equal((await target()).status, "archived");
});

for (const [label, update] of [["owner changed", `author_id='${other}'`], ["moderation changed", "status='rejected'"], ["target deleted", null]]) {
  test(`${label} while restore waits for target is rechecked after the lock`, async () => {
    const blocker = connection("work-target-blocker"), actor = connection("work-restore-waiter");
    try {
      await blocker.begin(); await blocker.command(`select id from public.work_requests where id='${work}' for update;`);
      await actor.begin(); const pending = actor.command(restoreSql); await lockBarrier("work-restore-waiter");
      await blocker.command(update ? `update public.work_requests set ${update} where id='${work}'; commit;` : `delete from public.work_requests where id='${work}'; commit;`);
      assert.deepEqual(JSON.parse(await pending), []); await actor.command("commit;");
    } finally { blocker.close(); actor.close(); }
  });
}

test("expiry crossing a real target lock wait uses post-lock clock, not RPC-start now", async () => {
  await sql(`create temp table replacement as select * from public.payments where id='${payment}'; delete from public.payments where id='${payment}';
    update public.work_requests set expires_at=clock_timestamp()+interval '2 seconds' where id='${work}';
    update replacement set paid_at=(select expires_at-interval '30 days' from public.work_requests where id='${work}');
    insert into public.payments select * from replacement;`);
  const blocker = connection("work-expiry-blocker"), actor = connection("work-expiry-waiter");
  try {
    await blocker.begin(); await blocker.command(`select id from public.work_requests where id='${work}' for update;`);
    await actor.begin(); const pending = actor.command(restoreSql); await lockBarrier("work-expiry-waiter");
    while (await sql(`select expires_at>clock_timestamp() from public.work_requests where id='${work}';`) === "t") { /* actual DB clock barrier */ }
    await blocker.command("commit;"); assert.deepEqual(JSON.parse(await pending), []); await actor.command("commit;");
    assert.equal((await target()).status, "archived");
  } finally { blocker.close(); actor.close(); }
});

test("restore RPC is service-only invoker with empty search_path", async () => {
  const meta = await json(`select row_to_json(m) from (select p.prosecdef,p.proconfig,
    has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') authenticated,
    has_function_privilege('service_role',p.oid,'execute') service from pg_proc p
    where oid='public.restore_work_request_within_paid_window(uuid,uuid)'::regprocedure) m;`);
  assert.equal(meta.prosecdef, false);
  assert.deepEqual(meta.proconfig, ['search_path=""']);
  assert.equal(meta.anon, false); assert.equal(meta.authenticated, false); assert.equal(meta.service, true);
  for (const role of ["anon", "authenticated"]) await assert.rejects(sql(`set role ${role}; select * from public.restore_work_request_within_paid_window('${work}','${owner}');`), /permission denied/);
});

test("current payer restores active archived work without changing ANY date or payment", async () => {
  const beforeTarget = await target(), beforePayment = await pay();
  assert.deepEqual(await restore(), [{ id: work }]);
  assert.deepEqual(await target(), { ...beforeTarget, status: "published" });
  assert.deepEqual(await pay(), beforePayment);
  assert.deepEqual(await restore(), []);
  assert.equal(await sql(`select count(*) from private.fulfillment_test_effects where target_id='${work}';`), "1");
});

test("actual maintenance SQL expires work requests, preserves NULL/history, and repeats safely", async () => {
  const before = await target(), beforePayment = await pay();
  await docker([...args(), "-f", "/work/tests/reconcile-expired-publications.sql"]);
  assert.deepEqual(await target(), before); assert.deepEqual(await pay(), beforePayment);
});

test("refund commits first while candidate SHARE waits: restore cannot consume refunded payment", async () => {
  const refund = connection("work-refund-first"), actor = connection("work-refund-waiter");
  try {
    await refund.begin(); await refund.command(`select id from public.payments where id='${payment}' for update;`);
    await actor.begin(); const pending = actor.command(restoreSql); await lockBarrier("work-refund-waiter");
    await refund.command(`update public.payments set status='refunded' where id='${payment}'; commit;`);
    assert.deepEqual(JSON.parse(await pending), []); await actor.command("commit;");
    assert.equal((await target()).status, "archived"); assert.equal((await pay()).status, "refunded");
  } finally { refund.close(); actor.close(); }
});

test("restore commits first: refund cannot pass held SHARE, neither operation renews the window", async () => {
  const actor = connection("work-restore-first"), refund = connection("work-refund-second");
  const before = await target();
  try {
    await actor.begin(); assert.deepEqual(JSON.parse(await actor.command(restoreSql)), [{ id: work }]);
    await refund.begin(); const pending = refund.command(`update public.payments set status='refunded' where id='${payment}'; commit;`);
    await lockBarrier("work-refund-second"); assert.equal((await pay()).status, "succeeded");
    await actor.command("commit;"); await pending;
    assert.deepEqual(await target(), { ...before, status: "published" }); assert.equal((await pay()).status, "refunded");
    // Automatic post-refund removal is a separate policy/workflow, not supplied by restore.
  } finally { actor.close(); refund.close(); }
});

test("candidate payer changes while payment SHARE waits are rechecked before target write", async () => {
  const changer = connection("work-payer-changer"), actor = connection("work-payer-waiter");
  try {
    await changer.begin(); await changer.command(`select id from public.payments where id='${payment}' for update;`);
    await actor.begin(); const pending = actor.command(restoreSql); await lockBarrier("work-payer-waiter");
    await changer.command(`update public.payments set user_id='${other}' where id='${payment}'; commit;`);
    assert.deepEqual(JSON.parse(await pending), []); await actor.command("commit;"); assert.equal((await target()).status, "archived");
  } finally { changer.close(); actor.close(); }
});

test("independent simultaneous restores perform one physical update", async () => {
  const first = connection("work-restore-one"), second = connection("work-restore-two");
  try {
    await first.begin(); assert.deepEqual(JSON.parse(await first.command(restoreSql)), [{ id: work }]);
    await second.begin(); const pending = second.command(restoreSql); await lockBarrier("work-restore-two");
    await first.command("commit;"); assert.deepEqual(JSON.parse(await pending), []); await second.command("commit;");
    assert.equal(await sql(`select count(*) from private.fulfillment_test_effects where target_id='${work}';`), "1");
  } finally { first.close(); second.close(); }
});

test("backend crash rolls back uncommitted restore without changing financial success", async () => {
  const actor = connection("work-restore-crash"); const before = await target(), beforePayment = await pay();
  try {
    await actor.begin(); assert.deepEqual(JSON.parse(await actor.command(restoreSql)), [{ id: work }]);
    await sql(`select pg_terminate_backend(pid) from pg_stat_activity where application_name='work-restore-crash' and datname='${database}';`);
    assert.deepEqual(await target(), before); assert.deepEqual(await pay(), beforePayment);
  } finally { actor.close(); }
});

test("all candidate UUID-order locks precede target lock, not just the newest payment", async () => {
  await sql(`insert into public.payments(id,user_id,target_type,target_id,provider,provider_payment_id,amount,status,paid_at,purchased_duration_days,target_applied_at,fulfillment_status)
    select '${id(101)}',user_id,target_type,target_id,provider,'synthetic-work-101',amount,status,paid_at,purchased_duration_days,target_applied_at,fulfillment_status
    from public.payments where id='${payment}';`);
  const blocker = connection("work-candidate-blocker"), actor = connection("work-candidate-waiter");
  try {
    await blocker.begin(); await blocker.command(`select id from public.payments where id='${id(101)}' for update;`);
    await actor.begin(); const pending = actor.command(restoreSql); await lockBarrier("work-candidate-waiter");
    // The second candidate is blocked, but the first is already SHARE-locked.
    await assert.rejects(sql(`set lock_timeout='100ms'; update public.payments set user_id='${other}' where id='${payment}';`), /lock timeout/);
    // The target must not have been locked while waiting for candidate payments.
    await sql(`set lock_timeout='100ms'; select id from public.work_requests where id='${work}' for update;`);
    await blocker.command("commit;"); assert.deepEqual(JSON.parse(await pending), [{ id: work }]); await actor.command("commit;");
  } finally { blocker.close(); actor.close(); }
});

test("runner name collision fails without deleting the already-owned disposable fixture", async () => {
  const before = await target(); const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  await assert.rejects(run(process.execPath, ["--test", "--test-name-pattern=^restore RPC is", "--test-reporter=spec", fileURLToPath(import.meta.url)],
    { timeout: 8000, maxBuffer: 1024 * 1024, env }), (error) => { assert.equal(error.code, 1); assert.match(error.stdout, /container name .* already in use/i); return true; });
  assert.deepEqual(await target(), before);
});

test("inventory preserves actual financial states and omits contact/description payloads", async () => {
  await sql(`update public.work_requests set description='INVENTORY_PRIVATE_DESCRIPTION_NEEDLE',contact_phone='+79994443322' where id='${work}';`);
  const before = await target(), beforePayment = await pay(); const report = await inventory();
  const item = report.publications.find((publication) => publication.id === work);
  assert.equal(item.window_state, "known_future"); assert.equal(item.payments[0].window_matches_snapshot, true);
  assert.equal(item.payments[0].financial_status, "succeeded"); assert.equal(report.manual_decisions_required, true);
  assert.doesNotMatch(JSON.stringify(report), /INVENTORY_PRIVATE_DESCRIPTION_NEEDLE|79994443322|contact_phone|confirmation_url/);
  assert.deepEqual(await target(), before); assert.deepEqual(await pay(), beforePayment);
});

test("inventory transaction really refuses injected DML, not just a read_only label", async () => {
  const source = readFileSync(new URL("../supabase/maintenance/inventory-legacy-publication-entitlements.sql", import.meta.url), "utf8");
  const before = await target();
  const injected = source.replace("with targets as (", `update public.work_requests set status='published' where id='${work}';\nwith targets as (`);
  assert.notEqual(injected, source);
  await assert.rejects(sql(injected), /cannot execute UPDATE in a read-only transaction/);
  assert.deepEqual(await target(), before);
});
