import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import test, { after, before, beforeEach } from "node:test";

// Explicit opt-in. Cached, disposable PG17 only; no network/host port/real DB.
const run = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const container = `blizhniy-marquee-pg17-${process.pid}`;
const database = "marquee_fixture";
const label = "blizhniy.marquee-test";
const baseline = process.env.BLIZHNIY_QUEUE_BASELINE === "1";
const migrationUrl = new URL('../supabase/migrations/20261007193251_atomic_ad_marquee_queue.sql', import.meta.url);
const sourceMigration = () => readFileSync(migrationUrl, 'utf8');
function mutationSource(name) {
  let source = sourceMigration();
  const paymentLock = "perform p.id from public.payments p where p.id = any(v_payments) order by p.id for share;";
  const targetLock = "perform t.id from public.ad_marquee_placements t where t.id = any(v_targets) order by t.id for update;";
  const replacements = {
    duration: ["v_now + v_row.purchased_duration_days * interval '24 hours'", "v_now + 99 * interval '24 hours'"],
    capacity: ["5 - count(*)::integer", "6 - count(*)::integer"],
    payment_order: [paymentLock, paymentLock.replace("order by p.id", "order by p.id desc")],
    lock_order: [`${paymentLock}\n  ${targetLock}`, `${targetLock}\n  ${paymentLock}`],
    grant: ["grant execute on function public.reconcile_ad_marquee_queue() to service_role;", "grant execute on function public.reconcile_ad_marquee_queue() to service_role, authenticated;"],
    clock: ["v_now := pg_catalog.clock_timestamp();", "v_now := pg_catalog.statement_timestamp();"],
  };
  if (name === "fresh_owner" || name === "fresh_approval") {
    const split = source.indexOf("  for v_row in");
    assert.ok(split > 0);
    const afterLocks = source.slice(split);
    const needle = name === "fresh_owner" ? "and p.user_id = t.user_id" : "and t.approved_at is not null";
    assert.ok(afterLocks.includes(needle));
    return source.slice(0, split) + afterLocks.replace(needle, "");
  }
  assert.ok(name in replacements, 'Only explicit test-source mutants are permitted');
  const [needle, replacement] = replacements[name];
  // clock_timestamp assignment also appears in moderation; String.replace
  // changes only the first (queue) occurrence, leaving moderation unchanged.
  assert.equal(source.split(needle).length, name === 'clock' ? 3 : 2, 'Mutation source must match the expected exact occurrences');
  source = source.replace(needle, replacement);
  return source;
}
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(1);
let owned = false;
let guardExists = false;

async function docker(args) {
  return (await run("docker", args, { timeout: 12_000, maxBuffer: 1024 * 1024 })).stdout.trim();
}
const psqlArgs = () => ["exec", "-i", container, "psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database];
const sql = (statement, role = "") => docker([...psqlArgs(), "-c", `set statement_timeout = '5s'; ${role ? `set role ${role};` : ""} ${statement}`]);
const json = async (statement, role) => JSON.parse(await sql(statement, role));
const reconcile = () => json("select coalesce(json_agg(json_build_object('id', r.id)), '[]') from public.reconcile_ad_marquee_queue() r;", "service_role");
const moderate = (target = id(10), status = "pending_payment", sort = 0, comment = null) =>
  json(`select public.moderate_ad_marquee_placement('${target}', '${status}', ${sort}, ${comment === null ? "null" : `'${comment}'`});`, "service_role");
const row = (target = id(10)) => json(`select row_to_json(t) from public.ad_marquee_placements t where id='${target}';`);
const effects = (target = id(10)) => sql(`select count(*) from private.fulfillment_test_effects where table_name='ad_marquee_placements' and target_id='${target}';`).then(Number);

async function placement(n = 10, options = {}) {
  const target = id(n);
  const payment = id(n + 1000);
  const status = options.status ?? "paid";
  // Trusted fixture setup deliberately precedes the guard, as historical rows do.
  await sql(`${guardExists ? "alter table public.ad_marquee_placements disable trigger ad_marquee_queue_guard;" : ""}
    insert into public.ad_marquee_placements(id,user_id,text,status,approved_at,payment_status,starts_at,ends_at,sort_order)
    values('${target}','${options.owner ?? owner}','Synthetic marquee ${n}','${status}',
      ${options.approved === false ? "null" : "clock_timestamp() - interval '1 day'"},
      '${options.paymentStatus ?? "succeeded"}', ${options.start ? `'${options.start}'` : "null"},
      ${options.end ? `'${options.end}'` : "null"},${options.sort ?? n});
    insert into public.payments(id,user_id,target_type,target_id,provider,provider_payment_id,amount,status,paid_at,
      purchased_duration_days,fulfillment_status,target_applied_at)
    values('${payment}','${options.paymentOwner ?? owner}','${options.targetType ?? "ad_marquee"}',
      '${options.paymentTarget ?? target}','${options.provider ?? "yookassa"}','synthetic-${n}',199,
      '${options.financialStatus ?? "succeeded"}',${options.paidAt ? `'${options.paidAt}'` : "clock_timestamp() - interval '1 minute'"},
      ${options.duration === null ? "null" : options.duration ?? 7}, '${options.fulfillment ?? "applied"}',
      ${options.fulfillment === "pending" ? "null" : "clock_timestamp() - interval '1 minute'"});
    update public.ad_marquee_placements set payment_id='${payment}',paid_at=(select paid_at from public.payments where id='${payment}') where id='${target}';
    ${guardExists ? "alter table public.ad_marquee_placements enable trigger ad_marquee_queue_guard;" : ""}
    truncate private.fulfillment_test_effects;`);
  return { target, payment };
}

function connection(name) {
  const child = spawn("docker", psqlArgs(), { stdio: ["pipe", "pipe", "pipe"] });
  let buffer = "";
  let errors = "";
  let pending;
  let sequence = 0;
  child.stdout.on("data", (data) => {
    buffer += data;
    if (!pending || !buffer.includes(pending.marker)) return;
    const [output, rest] = buffer.split(pending.marker);
    buffer = rest;
    clearTimeout(pending.timeout);
    pending.resolve(output.trim());
    pending = null;
  });
  child.stderr.on("data", (data) => { errors += data; });
  child.stdin.on("error", () => {});
  child.on("exit", (code) => {
    if (!pending) return;
    clearTimeout(pending.timeout);
    pending.reject(new Error(`Owned PG connection exited ${code}: ${errors}`));
    pending = null;
  });
  return {
    command(statement) {
      assert.equal(Boolean(pending), false);
      buffer = "";
      const marker = `__QUEUE_BARRIER_${++sequence}__`;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Owned PG barrier timed out: ${errors}`)), 7000);
        pending = { marker, resolve, reject, timeout };
        child.stdin.write(`${statement}\n\\echo ${marker}\n`);
      });
    },
    async begin() { await this.command(`set application_name='${name}'; set statement_timeout='5s'; begin; set local role service_role;`); },
    close() { child.stdin.end("\\q\n"); },
  };
}

async function waitForLock(name, kind) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const waiting = await sql(`select exists(select 1 from pg_stat_activity a where datname='${database}' and application_name='${name}'
      and wait_event_type='Lock' ${kind ? `and wait_event='${kind}'` : ""});`);
    if (waiting === "t") return;
  }
  assert.fail(`Independent connection ${name} did not reach actual ${kind ?? "row"} lock barrier`);
}

before(async () => {
  await docker(["run", "--detach", "--pull", "never", "--network", "none", "--name", container,
    "--label", `${label}=remaining_static_audit`, "--tmpfs", "/var/lib/postgresql/data",
    "--mount", `type=bind,source=${root},target=/work,readonly`, "-e", `POSTGRES_DB=${database}`,
    "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17-alpine", "-c", "listen_addresses=", "-c", "timezone=UTC"]);
  owned = true;
  const deadline = Date.now() + 8000;
  while (true) {
    try { await sql("select 1;"); break; } catch (error) { if (Date.now() > deadline) throw error; }
  }
  assert.match(await sql("show server_version;"), /^17\./);
  await docker([...psqlArgs(), "-v", "apply_fulfillment_migration=true", "-f", "/work/tests/fixtures/payment-fulfillment.sql"]);
  if (!baseline) {
    const mutant = process.env.BLIZHNIY_QUEUE_MUTANT;
    if (mutant) await sql(mutationSource(mutant));
    else await docker([...psqlArgs(), "-f", "/work/supabase/migrations/20261007193251_atomic_ad_marquee_queue.sql"]);
  }
  guardExists = await sql("select exists(select 1 from pg_trigger where tgname='ad_marquee_queue_guard');") === "t";
});
after(async () => {
  if (!owned) return;
  assert.equal(await docker(["inspect", "--format", `{{index .Config.Labels "${label}"}}`, container]), "remaining_static_audit");
  await docker(["rm", "--force", container]);
});
beforeEach(async () => {
  await sql("truncate public.payments, public.ad_marquee_placements cascade; truncate private.fulfillment_test_effects;");
});

test("service-only invoker RPCs use empty search_path; browser table writes remain denied", async () => {
  for (const signature of ["public.reconcile_ad_marquee_queue()", "public.moderate_ad_marquee_placement(uuid,text,integer,text)"]) {
    const contract = await json(`select row_to_json(r) from (select p.prosecdef,p.proconfig,
      has_function_privilege('anon',p.oid,'execute') anon, has_function_privilege('authenticated',p.oid,'execute') browser,
      has_function_privilege('service_role',p.oid,'execute') service from pg_proc p where p.oid='${signature}'::regprocedure) r;`);
    assert.equal(contract.prosecdef, false);
    assert.ok(contract.proconfig.includes('search_path=""'));
    assert.equal(contract.anon, false);
    assert.equal(contract.browser, false);
    assert.equal(contract.service, true);
  }
  for (const role of ["anon", "authenticated"]) {
    await assert.rejects(sql("select public.reconcile_ad_marquee_queue();", role), /permission denied/);
    await assert.rejects(sql(`select public.moderate_ad_marquee_placement('${id(10)}','pending_payment',0,null);`, role), /permission denied/);
    await assert.rejects(sql(`insert into public.ad_marquee_placements(user_id,text) values('${owner}','Synthetic draft text');`, role), /permission denied/);
    for (const fields of ["status='active'", "starts_at=clock_timestamp()", "ends_at=clock_timestamp()", "text='Synthetic changed draft'", "payment_status='succeeded'"]) {
      await assert.rejects(sql(`update public.ad_marquee_placements set ${fields};`, role), /permission denied/);
    }
  }
});

test("existing server service-role draft creation remains available without granting browser writes", async () => {
  await sql(`insert into public.ad_marquee_placements(id,user_id,text) values('${id(10)}','${owner}','Synthetic legitimate draft');`, "service_role");
  const draft = await row();
  assert.equal(draft.user_id, owner);
  assert.equal(draft.status, "pending_review");
  assert.equal(draft.payment_status, "created");
  assert.equal(draft.starts_at, null);
  assert.equal(draft.ends_at, null);
});

test("purchased duration, not mutable tariff, defines the first activation; duplicate reconcile has no physical update", async () => {
  await placement(10, { duration: 3 });
  await sql("update public.tariffs set duration_days=99 where action='ad_marquee';");
  assert.deepEqual(await reconcile(), [{ id: id(10) }]);
  const first = await row();
  assert.equal(first.status, "active");
  assert.equal(Date.parse(first.ends_at) - Date.parse(first.starts_at), 3 * 86400000);
  assert.equal(await effects(), 1);
  await reconcile();
  assert.deepEqual(await row(), first);
  assert.equal(await effects(), 1);
});

test("capacity is five and the queue order has deterministic tie-breaking", async () => {
  for (let n = 10; n < 17; n++) await placement(n, { sort: 0, paidAt: '2020-01-01' });
  await sql("update public.ad_marquee_placements set created_at='2020-01-01';");
  assert.deepEqual(await reconcile(), [10, 11, 12, 13, 14].map((n) => ({ id: id(n) })));
  assert.equal(Number(await sql("select count(*) from public.ad_marquee_placements where status='active';")), 5);
  assert.equal((await row(id(15))).status, "paid");
});

for (const [label, invalid] of [
  ["missing purchased duration", { duration: null }], ["refunded finance", { financialStatus: "refunded" }],
  ["changed financial owner", { paymentOwner: id(2) }], ["changed placement owner", { owner: id(2) }],
  ["wrong target", { paymentTarget: id(99) }], ["wrong target type", { targetType: "listing" }],
  ["missing approval", { approved: false }], ["unfinished fulfillment", { fulfillment: "pending" }],
  ["wrong provider", { provider: "mock" }], ["unsucceeded target", { paymentStatus: "pending" }],
]) {
  test(`activation fails closed for ${label}`, async () => {
    await placement(10, invalid);
    const before = await row();
    assert.deepEqual(await reconcile(), []);
    assert.deepEqual(await row(), before);
    assert.equal(await effects(), 0);
  });
}

test("historical interval is never restarted, and malformed existing active rows conservatively consume slots", async () => {
  await placement(10, { start: "2020-01-01", end: "2020-01-08" });
  const historical = await row();
  await placement(11, { status: "active", start: "2020-01-01", end: "2020-01-04" }); // wrong purchased duration, not fresh-window repair
  for (let n = 12; n < 16; n++) await placement(n, { status: "active", end: "2090-01-01" });
  await placement(16);
  await reconcile();
  assert.deepEqual(await row(), historical);
  assert.equal((await row(id(16))).status, "paid");
  assert.equal((await row(id(11))).status, "active");
});

test("valid expired interval is preserved while its released slot is reused atomically", async () => {
  await placement(10, { status: "active", start: "2020-01-01", end: "2020-01-08" });
  await placement(11);
  const interval = await row();
  await reconcile();
  const expired = await row();
  assert.equal(expired.status, "expired");
  assert.equal(expired.starts_at, interval.starts_at);
  assert.equal(expired.ends_at, interval.ends_at);
  assert.equal((await row(id(11))).status, "active");
});

test("moderation is monotonic and repeated approval never resets approved_at", async () => {
  await placement(10, { status: "pending_review", paymentStatus: "created" });
  const approved = await moderate();
  assert.equal(approved.changed, true);
  assert.equal(approved.placement.status, "pending_payment");
  const again = await moderate();
  assert.equal(again.changed, false);
  assert.equal(again.placement.approved_at, approved.placement.approved_at);
  await sql("update public.ad_marquee_placements set status='paid',payment_status='succeeded';");
  assert.equal((await moderate()).outcome, "conflict");
  await reconcile();
  const active = await row();
  assert.equal((await moderate()).outcome, "conflict");
  assert.equal((await moderate(id(10), "rejected")).outcome, "conflict");
  assert.equal((await moderate(id(10), "archived")).placement.status, "archived");
  assert.equal((await row()).starts_at, active.starts_at);
  assert.equal((await row()).ends_at, active.ends_at);
  assert.equal((await moderate(id(10), "pending_payment")).outcome, "conflict");
});

test("legacy raw activation without queue lock is denied, and a historical interval cannot be overwritten even with that lock", async () => {
  await placement();
  await assert.rejects(sql("update public.ad_marquee_placements set status='active',starts_at=clock_timestamp(),ends_at=clock_timestamp()+interval '7 days';", "service_role"), /queue RPC/);
  await reconcile();
  await assert.rejects(sql("begin; select pg_advisory_xact_lock(1112295754,1); update public.ad_marquee_placements set ends_at=ends_at+interval '1 day'; commit;", "service_role"), /immutable/);
  await assert.rejects(sql("update public.ad_marquee_placements set status='paid';", "service_role"), /monotonic/);
});

test("concurrent reconciles serialize on the actual global lock and never overfill the final slot", async () => {
  for (let n = 10; n < 14; n++) await placement(n);
  await reconcile();
  for (let n = 14; n < 16; n++) await placement(n);
  const a = connection("queue_a");
  const b = connection("queue_b");
  try {
    await a.begin();
    await a.command("select pg_advisory_xact_lock(1112295754,1);");
    await b.begin();
    const pending = b.command("select count(*) from public.reconcile_ad_marquee_queue();");
    await waitForLock("queue_b", "advisory");
    await a.command("select count(*) from public.reconcile_ad_marquee_queue(); commit;");
    assert.equal(await pending, "5");
    await b.command("commit;");
    assert.equal(Number(await sql("select count(*) from public.ad_marquee_placements where status='active';")), 5);
    assert.equal((await row(id(15))).status, "paid");
  } finally { a.close(); b.close(); }
});

test("ALL payments are locked in UUID order before ANY placement lock, compatible with financial payment-first order", async () => {
  const first = await placement(10);
  const second = await placement(11);
  const finance = connection("finance_sorted");
  const queue = connection("queue_sorted");
  try {
    await finance.begin();
    await finance.command(`select id from public.payments where id='${second.payment}' for update;`);
    await queue.begin();
    const pending = queue.command("select count(*) from public.reconcile_ad_marquee_queue();");
    pending.catch(() => {});
    await waitForLock("queue_sorted");
    await assert.rejects(sql(`select id from public.payments where id='${first.payment}' for update nowait;`, "service_role"), /could not obtain lock/);
    assert.equal(await sql(`select id from public.ad_marquee_placements where id='${first.target}' for update nowait;`, "service_role"), first.target);
    await finance.command("commit;");
    assert.equal(await pending, "2");
    await queue.command("commit;");
  } finally { finance.close(); queue.close(); }
});

test("queue lock timeout rolls back its global lock and all state, allowing a safe later retry", async () => {
  const { payment } = await placement();
  const before = await row();
  const finance = connection("finance_timeout");
  try {
    await finance.begin();
    await finance.command(`select id from public.payments where id='${payment}' for update;`);
    await assert.rejects(reconcile(), /lock timeout/);
    assert.deepEqual(await row(), before);
    await finance.command("rollback;");
    assert.deepEqual(await reconcile(), [{ id: id(10) }]);
  } finally { finance.close(); }
});

test("activation clock is read after the global lock, not at verification or transaction arrival", async () => {
  await placement();
  const holder = connection("clock_holder");
  const queue = connection("queue_clock");
  try {
    await holder.begin();
    await holder.command("select pg_advisory_xact_lock(1112295754,1);");
    await queue.begin();
    const pending = queue.command("select count(*) from public.reconcile_ad_marquee_queue();");
    pending.catch(() => {});
    await waitForLock("queue_clock", "advisory");
    const beforeRelease = await sql("select clock_timestamp();");
    await holder.command("commit;");
    assert.equal(await pending, "1");
    await queue.command("commit;");
    assert.ok(Date.parse((await row()).starts_at) >= Date.parse(beforeRelease));
  } finally { holder.close(); queue.close(); }
});

test("refund committed while queue waits on the payment lock is freshly observed before activation", async () => {
  const { payment } = await placement();
  const financial = connection("finance");
  const queue = connection("queue_after_finance");
  try {
    await financial.begin();
    await financial.command(`select id from public.payments where id='${payment}' for update;`);
    await queue.begin();
    const pending = queue.command("select count(*) from public.reconcile_ad_marquee_queue();");
    await waitForLock("queue_after_finance");
    await financial.command(`update public.payments set status='refunded' where id='${payment}'; commit;`);
    assert.equal(await pending, "0");
    await queue.command("commit;");
    assert.equal((await row()).status, "paid");
  } finally { financial.close(); queue.close(); }
});

for (const [field, update] of [["ownership", `user_id='${id(2)}'`], ["approval", "approved_at=null"],
  ["payment status", "payment_status='pending'"], ["payment binding", "payment_id=null"]]) {
test(`placement ${field} changed while queue waits on the target lock is freshly observed`, async () => {
  await placement();
  const ownerChange = connection("owner_change");
  const queue = connection("queue_after_owner");
  try {
    await ownerChange.begin();
    await ownerChange.command(`select id from public.ad_marquee_placements where id='${id(10)}' for update;`);
    await queue.begin();
    const pending = queue.command("select count(*) from public.reconcile_ad_marquee_queue();");
    await waitForLock("queue_after_owner");
    await ownerChange.command(`update public.ad_marquee_placements set ${update} where id='${id(10)}'; commit;`);
    assert.equal(await pending, "0");
    await queue.command("commit;");
    assert.equal((await row()).status, "paid");
  } finally { ownerChange.close(); queue.close(); }
});
}

test("archive and reconcile use the same global order; archive winner is never revived", async () => {
  await placement();
  const admin = connection("admin_archive");
  const queue = connection("queue_after_archive");
  try {
    await admin.begin();
    await admin.command(`select public.moderate_ad_marquee_placement('${id(10)}','archived',0,null);`);
    await queue.begin();
    const pending = queue.command("select count(*) from public.reconcile_ad_marquee_queue();");
    await waitForLock("queue_after_archive", "advisory");
    await admin.command("commit;");
    assert.equal(await pending, "0");
    await queue.command("commit;");
    assert.equal((await row()).status, "archived");
    assert.equal((await row()).starts_at, null);
  } finally { admin.close(); queue.close(); }
});

test("queue-winning archive race preserves the first interval instead of recreating it", async () => {
  await placement();
  const queue = connection("queue_wins");
  const admin = connection("archive_after_queue");
  try {
    await queue.begin();
    await queue.command("select count(*) from public.reconcile_ad_marquee_queue();");
    await admin.begin();
    const pending = admin.command(`select public.moderate_ad_marquee_placement('${id(10)}','archived',0,null);`);
    pending.catch(() => {});
    await waitForLock("archive_after_queue", "advisory");
    const active = JSON.parse(await queue.command(`select row_to_json(t) from public.ad_marquee_placements t where id='${id(10)}';`));
    await queue.command("commit;");
    const archived = JSON.parse(await pending).placement;
    assert.equal(archived.status, "archived");
    assert.equal(archived.starts_at, active.starts_at);
    assert.equal(archived.ends_at, active.ends_at);
    await admin.command("commit;");
  } finally { queue.close(); admin.close(); }
});

test("approval committed while financial fulfillment waits is observed without a payment/global lock cycle", async () => {
  const { payment } = await placement(10, { status: "pending_review", paymentStatus: "created", fulfillment: "pending" });
  await sql("update public.ad_marquee_placements set payment_id=null,paid_at=null;");
  const admin = connection("approval_wins");
  const finance = connection("finance_after_approval");
  try {
    await admin.begin();
    await admin.command(`select public.moderate_ad_marquee_placement('${id(10)}','pending_payment',0,null);`);
    await finance.begin();
    const pending = finance.command(`select row_to_json(r) from public.apply_payment_fulfillment('${payment}','synthetic-10') r;`);
    pending.catch(() => {});
    await waitForLock("finance_after_approval");
    await admin.command("commit;");
    assert.equal(JSON.parse(await pending).fulfillment_status, "applied");
    await finance.command("commit;");
    assert.equal((await moderate()).outcome, "conflict");
    assert.deepEqual(await reconcile(), [{ id: id(10) }]);
  } finally { admin.close(); finance.close(); }
});

test("financial verification before approval remains financially succeeded but blocked; approval cannot reset that marker", async () => {
  const { payment } = await placement(10, { status: "pending_review", paymentStatus: "created", fulfillment: "pending" });
  await sql("update public.ad_marquee_placements set payment_id=null,paid_at=null;");
  const applied = await json(`select row_to_json(r) from public.apply_payment_fulfillment('${payment}','synthetic-10') r;`, "service_role");
  assert.equal(applied.fulfillment_status, "blocked");
  assert.equal((await moderate()).placement.status, "pending_payment");
  assert.deepEqual(await reconcile(), []);
  assert.equal(await sql(`select status from public.payments where id='${payment}';`), "succeeded");
  assert.equal(await sql(`select fulfillment_status from public.payments where id='${payment}';`), "blocked");
});

test("activation rollback restores expiry, capacity and first interval together", async () => {
  await placement(10, { status: "active", start: "2020-01-01", end: "2020-01-08" });
  await placement(11);
  const before = [await row(), await row(id(11))];
  await sql(`create function private.fail_queue_activation() returns trigger language plpgsql as $$ begin
    if new.status='active' then raise exception 'synthetic activation failure'; end if; return new; end $$;
    create trigger fail_queue_activation before update on public.ad_marquee_placements for each row execute function private.fail_queue_activation();`);
  try {
    await assert.rejects(reconcile(), /synthetic activation failure/);
    assert.deepEqual([await row(), await row(id(11))], before);
    assert.equal(await effects(), 0);
  } finally { await sql("drop trigger fail_queue_activation on public.ad_marquee_placements; drop function private.fail_queue_activation();"); }
});

test("migration does not replace the financial fulfillment function or fabricate historical windows", async () => {
  const migration = readFileSync(new URL('../supabase/migrations/20261007193251_atomic_ad_marquee_queue.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(migration, /create\s+(or\s+replace\s+)?function\s+public\.apply_payment_fulfillment/i);
  await placement(10, { status: "active", end: "2090-01-01" });
  const before = await row();
  await docker([...psqlArgs(), "-f", "/work/supabase/migrations/20261007193251_atomic_ad_marquee_queue.sql"]);
  assert.deepEqual(await row(), before);
});
