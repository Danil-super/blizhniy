import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test, { after, before, beforeEach } from "node:test";

// Explicit opt-in: disposable cached PostgreSQL17, no network, ports or .env.
const run = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const container = "blizhniy-publication-restore-pg17-20261008";
const database = "blizhniy_publication_restore_fixture";
const label = "blizhniy.publication-restore";
const labelValue = "publication_restore_followup";
const migration = "20261008063110_restore_listing_and_vacancy_within_paid_window.sql";
const environment = { PATH: process.env.PATH, LANG: "C.UTF-8" };
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(1), other = id(2);
const targets = { listing: { table: "listings", id: id(10), payment: id(100) },
  vacancy: { table: "vacancies", id: id(11), payment: id(101) } };
let owned = false;
const docker = async (args) => (await run("docker", args, { env: environment, timeout: 12_000, maxBuffer: 2 * 1024 * 1024 })).stdout.trim();
const args = () => ["exec", "-i", container, "psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database];
const sql = (statement, service = false) => docker([...args(), "-c", `set statement_timeout='5s'; ${service ? "set role service_role;" : ""} ${statement}`]);
const json = async (statement, service = false) => JSON.parse(await sql(statement, service));
const target = (type) => json(`select row_to_json(t) from public.${targets[type].table} t where id='${targets[type].id}';`);
const payments = () => json("select coalesce(json_agg(p order by id),'[]'::json) from public.payments p;");
const effects = (type) => sql(`select count(*) from private.fulfillment_test_effects where table_name='${targets[type].table}';`);
const restoreSql = (type, actor = owner, targetId = targets[type].id) =>
  `select coalesce(json_agg(json_build_object('id',r.id)),'[]'::json) from public.restore_${type}_within_paid_window('${targetId}','${actor}') r;`;
const restore = (type, actor = owner, targetId) => json(restoreSql(type, actor, targetId), true);

before(async () => {
  // A collision fails before owned=true and never touches the existing container.
  await docker(["run", "--detach", "--pull", "never", "--network", "none", "--name", container,
    "--label", `${label}=${labelValue}`, "--tmpfs", "/var/lib/postgresql/data",
    "--mount", `type=bind,source=${root},target=/work,readonly`, "-e", `POSTGRES_DB=${database}`,
    "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17-alpine", "-c", "listen_addresses=", "-c", "timezone=UTC"]);
  owned = true;
  const deadline = Date.now() + 8000;
  while (true) { try { await sql("select 1;"); break; } catch (error) { if (Date.now() > deadline) throw error; } }
  assert.match(await sql("show server_version;"), /^17\./);
  await docker([...args(), "-v", "apply_fulfillment_migration=1", "-f", "/work/tests/fixtures/payment-fulfillment.sql"]);
  await docker([...args(), "-f", `/work/supabase/migrations/${migration}`]);
});
after(async () => {
  if (!owned) return;
  assert.equal(await docker(["inspect", "--format", `{{index .Config.Labels "${label}"}}`, container]), labelValue);
  await docker(["rm", "--force", container]);
});
beforeEach(async () => {
  await sql(`drop trigger if exists suppress_restore on public.listings;
    drop trigger if exists suppress_restore on public.vacancies;
    truncate public.notifications, public.payments, public.listings, public.vacancies cascade;
    truncate private.fulfillment_test_effects;
    insert into public.listings(id,author_id,listing_type,category_id,region_id,city_id,title,description,status,is_paid,published_at,expires_at)
      select '${id(10)}','${owner}','sell',c.id,city.region_id,city.id,'Synthetic listing','Fixture only','archived',true,
        '2026-09-01T12:00:00Z',clock_timestamp()+interval '10 days'
      from public.categories c cross join public.cities city where c.slug='synthetic-test-category' limit 1;
    insert into public.vacancies(id,author_id,organization_name,title,description,region_id,city_id,status,is_paid,published_at,expires_at)
      select '${id(11)}','${owner}','Synthetic employer','Synthetic vacancy','Fixture only',region_id,id,'archived',true,
        '2026-09-01T12:00:00Z',clock_timestamp()+interval '10 days' from public.cities limit 1;
    insert into public.payments(id,user_id,target_type,target_id,provider,provider_payment_id,amount,status,paid_at,target_applied_at,fulfillment_status)
      values ('${id(100)}','${owner}','listing','${id(10)}','yookassa','synthetic-listing',199,'succeeded','2026-09-01T12:00:00Z','2026-09-01T12:01:00Z','applied'),
        ('${id(101)}','${owner}','vacancy','${id(11)}','yookassa','synthetic-vacancy',199,'succeeded','2026-09-01T12:00:00Z','2026-09-01T12:01:00Z','applied');`);
});

// Persistent independent connections and actual pg_stat_activity lock barriers.
function connection(name) {
  const child = spawn("docker", args(), { env: environment, stdio: ["pipe", "pipe", "pipe"] });
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
  child.on("exit", (code) => {
    if (pending) { clearTimeout(pending.timer); pending.reject(new Error(`Owned connection exited ${code}: ${errors}`)); pending = undefined; }
  });
  return {
    command(statement) {
      assert.equal(Boolean(pending), false, "one in-flight command per independent connection");
      buffer = "";
      return new Promise((resolve, reject) => {
        const marker = `__RESTORE_BARRIER_${++sequence}__`;
        const timer = setTimeout(() => reject(new Error(`Owned lock barrier timeout: ${errors}`)), 7000);
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
  assert.fail(`Independent connection ${name} did not reach an actual row-lock wait`);
}
async function waitForExpiry(type) {
  const deadline = Date.now() + 4000;
  while (await sql(`select expires_at>clock_timestamp() from public.${targets[type].table} where id='${targets[type].id}';`) === "t") {
    assert.ok(Date.now() < deadline, "actual PostgreSQL clock must cross the synthetic deadline");
  }
}

for (const type of ["listing", "vacancy"]) {
  const { table, id: targetId } = targets[type];
  test(`${type}: RPC is service-only invoker with empty search_path`, async () => {
    const meta = await json(`select row_to_json(m) from (select p.prosecdef,p.proconfig,
      has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') authenticated,
      has_function_privilege('service_role',p.oid,'execute') service from pg_proc p
      where oid='public.restore_${type}_within_paid_window(uuid,uuid)'::regprocedure) m;`);
    assert.equal(meta.prosecdef, false); assert.deepEqual(meta.proconfig, ['search_path=""']);
    assert.equal(meta.anon, false); assert.equal(meta.authenticated, false); assert.equal(meta.service, true);
    for (const role of ["anon", "authenticated"]) await assert.rejects(sql(`set role ${role}; ${restoreSql(type)}`), /permission denied/);
  });
  test(`${type}: healthy stable owner restores exactly once, preserves expiry/history and advances its existing sort timestamp`, async () => {
    const before = await target(type), financial = await payments();
    const earlier = await sql("select clock_timestamp();");
    assert.deepEqual(await restore(type), [{ id: targetId }]);
    const after = await target(type), later = await sql("select clock_timestamp();");
    assert.deepEqual(after, { ...before, status: "published", published_at: after.published_at });
    assert.ok(Date.parse(after.published_at) >= Date.parse(earlier));
    assert.ok(Date.parse(after.published_at) <= Date.parse(later));
    assert.ok(Date.parse(after.published_at) > Date.parse(before.published_at));
    assert.deepEqual(await payments(), financial);
    assert.deepEqual(await restore(type), []); assert.equal(await effects(type), "1");
  });
  for (const [name, change] of [["expired", "expires_at=clock_timestamp()-interval '1 second'"], ["deadline reached", "expires_at=clock_timestamp()"], ["unknown deadline", "expires_at=null"],
    ["unpaid", "is_paid=false"], ["foreign current owner", `author_id='${other}'`], ["moderation rejection", "status='rejected'"]]) {
    test(`${type}: refuses ${name} without a target or financial write`, async () => {
      await sql(`update public.${table} set ${change} where id='${targetId}'; truncate private.fulfillment_test_effects;`);
      const before = await target(type), financial = await payments();
      assert.deepEqual(await restore(type), []); assert.deepEqual(await target(type), before);
      assert.deepEqual(await payments(), financial); assert.equal(await effects(type), "0");
    });
  }
  test(`${type}: existing allowed states and NULL/missing/foreign arguments fail closed`, async () => {
    for (const status of ["sold", "archived", "expired", "published", "pending_payment", "draft", "rejected"]) {
      await sql(`update public.${table} set status='${status}' where id='${targetId}';`);
      const expected = type === "listing" ? ["sold", "archived", "expired"].includes(status) : status === "archived";
      assert.equal((await restore(type)).length, Number(expected), status);
    }
    assert.deepEqual(await restore(type, other), []); assert.deepEqual(await restore(type, owner, id(99)), []);
    assert.equal(await sql(`set role service_role; select count(*) from public.restore_${type}_within_paid_window(null,'${owner}');`), "0");
    assert.equal(await sql(`set role service_role; select count(*) from public.restore_${type}_within_paid_window('${targetId}',null);`), "0");
  });
  test(`${type}: rejects expiry crossed while its stable owner's target lock waits`, async () => {
    await sql(`update public.${table} set expires_at=clock_timestamp()+interval '1500 milliseconds' where id='${targetId}';`);
    const before = await target(type), financial = await payments();
    const blocker = connection(`${type}-expiry-blocker`), actor = connection(`${type}-expiry-waiter`);
    try {
      await blocker.begin(); await blocker.command(`select id from public.${table} where id='${targetId}' for update;`);
      await actor.begin(); const pending = actor.command(restoreSql(type)); await lockBarrier(`${type}-expiry-waiter`);
      await waitForExpiry(type); await blocker.command("commit;");
      assert.deepEqual(JSON.parse(await pending), []); await actor.command("commit;");
      assert.deepEqual(await target(type), before); assert.deepEqual(await payments(), financial);
    } finally { blocker.close(); actor.close(); }
  });
  for (const [name, change] of [["owner", `author_id='${other}'`], ["moderation status", "status='rejected'"],
    ["paid flag", "is_paid=false"], ["deleted row", null]]) {
    test(`${type}: rechecks ${name} committed while target lock waits`, async () => {
      const blocker = connection(`${type}-change-blocker`), actor = connection(`${type}-change-waiter`);
      const financial = await payments();
      try {
        await blocker.begin(); await blocker.command(`select id from public.${table} where id='${targetId}' for update;`);
        await actor.begin(); const pending = actor.command(restoreSql(type)); await lockBarrier(`${type}-change-waiter`);
        await blocker.command(`${change ? `update public.${table} set ${change} where id='${targetId}'` : `delete from public.${table} where id='${targetId}'`}; commit;`);
        assert.deepEqual(JSON.parse(await pending), []); await actor.command("commit;");
        if (change) assert.notEqual((await target(type)).status, "published");
        else assert.equal(await sql(`select count(*) from public.${table} where id='${targetId}';`), "0");
        assert.deepEqual(await payments(), financial);
      } finally { blocker.close(); actor.close(); }
    });
  }
  test(`${type}: independent simultaneous restores perform one physical write`, async () => {
    const first = connection(`${type}-restore-first`), second = connection(`${type}-restore-second`);
    try {
      await first.begin(); assert.deepEqual(JSON.parse(await first.command(restoreSql(type))), [{ id: targetId }]);
      await second.begin(); const pending = second.command(restoreSql(type)); await lockBarrier(`${type}-restore-second`);
      await first.command("commit;"); assert.deepEqual(JSON.parse(await pending), []); await second.command("commit;");
      assert.equal(await effects(type), "1");
    } finally { first.close(); second.close(); }
  });
  test(`${type}: suppressed UPDATE returns no success and preserves all history`, async () => {
    const before = await target(type), financial = await payments();
    await sql(`create trigger suppress_restore before update on public.${table} for each row execute function private.suppress_fulfillment_test_write();`);
    assert.deepEqual(await restore(type), []); assert.deepEqual(await target(type), before);
    assert.deepEqual(await payments(), financial); assert.equal(await effects(type), "0");
  });
  test(`${type}: owned backend crash rolls back an uncommitted restore`, async () => {
    const before = await target(type), financial = await payments(), actor = connection(`${type}-restore-crash`);
    try {
      await actor.begin(); assert.deepEqual(JSON.parse(await actor.command(restoreSql(type))), [{ id: targetId }]);
      await sql(`select pg_terminate_backend(pid) from pg_stat_activity where application_name='${type}-restore-crash' and datname='${database}';`);
      assert.deepEqual(await target(type), before); assert.deepEqual(await payments(), financial); assert.equal(await effects(type), "0");
    } finally { actor.close(); }
  });
  test(`${type}: captured app-clock UPDATE reproduces the original stale success without granting a new window`, async () => {
    await sql(`update public.${table} set expires_at=clock_timestamp()+interval '1500 milliseconds' where id='${targetId}';`);
    const now = await sql("select clock_timestamp();"), before = await target(type);
    const blocker = connection(`${type}-baseline-blocker`), actor = connection(`${type}-baseline-waiter`);
    try {
      await blocker.begin(); await blocker.command(`select id from public.${table} where id='${targetId}' for update;`);
      await actor.begin(); const pending = actor.command(`update public.${table} set status='published',published_at='${now}'
        where id='${targetId}' and author_id='${owner}' and is_paid and status='archived' and expires_at>'${now}' returning id;`);
      await lockBarrier(`${type}-baseline-waiter`); await waitForExpiry(type); await blocker.command("commit;");
      assert.equal(await pending, targetId); await actor.command("commit;");
      assert.equal((await target(type)).expires_at, before.expires_at);
      assert.equal(await sql(`select count(*) from public.${table} where id='${targetId}' and status='published' and is_paid and expires_at>clock_timestamp();`), "0");
    } finally { blocker.close(); actor.close(); }
  });
  test(`${type}: restoration does not introduce a new payer/snapshot gate for existing authoritative paid windows`, async () => {
    await sql("delete from public.payments;");
    const before = await target(type);
    assert.deepEqual(await restore(type), [{ id: targetId }]);
    assert.equal((await target(type)).expires_at, before.expires_at); assert.deepEqual(await payments(), []);
  });
  test(`${type}: restoration interoperates with payment-to-target fulfillment without reversing locks or replaying history`, async () => {
    const actor = connection(`${type}-restore-finance`), finance = connection(`${type}-finance-waiter`);
    const before = await target(type), financial = await payments(), newPayment = id(200);
    await sql(`insert into public.payments(id,user_id,target_type,target_id,provider,provider_payment_id,amount,status,paid_at,purchased_duration_days)
      values ('${newPayment}','${owner}','${type}','${targetId}','yookassa','synthetic-interoperation',199,'succeeded',clock_timestamp()-interval '1 minute',30);`);
    try {
      await actor.begin(); assert.deepEqual(JSON.parse(await actor.command(restoreSql(type))), [{ id: targetId }]);
      await finance.begin(); const pending = finance.command(`select row_to_json(r) from public.apply_payment_fulfillment('${newPayment}','synthetic-interoperation') r;`);
      await lockBarrier(`${type}-finance-waiter`);
      // Finance holds its payment lock while restore holds only the target.
      await actor.command("commit;"); const result = JSON.parse(await pending); await finance.command("commit;");
      assert.equal(result.financial_status, "succeeded"); assert.equal(result.fulfillment_reason, "target_not_eligible");
      assert.equal((await target(type)).expires_at, before.expires_at); assert.equal(await effects(type), "1");
      const original = await json(`select row_to_json(r) from public.apply_payment_fulfillment('${targets[type].payment}','synthetic-${type}') r;`, true);
      assert.equal(original.fulfillment_status, "applied"); assert.equal(original.applied_now, false);
      assert.deepEqual((await payments()).filter((p) => p.id !== newPayment), financial);
    } finally { actor.close(); finance.close(); }
  });
  test(`${type}: finance-first fulfillment publishes under its payment lock and waiting restore adds no physical write`, async () => {
    await sql(`update public.${table} set status='pending_payment',is_paid=false,published_at=null,expires_at=null where id='${targetId}';
      truncate private.fulfillment_test_effects;
      insert into public.payments(id,user_id,target_type,target_id,provider,provider_payment_id,amount,status,paid_at,purchased_duration_days)
      values ('${id(201)}','${owner}','${type}','${targetId}','yookassa','synthetic-finance-first',199,'succeeded',clock_timestamp()-interval '1 minute',9);`);
    const finance = connection(`${type}-finance-first`), actor = connection(`${type}-restore-after-finance`);
    try {
      await finance.begin();
      const applied = JSON.parse(await finance.command(`select row_to_json(r) from public.apply_payment_fulfillment('${id(201)}','synthetic-finance-first') r;`));
      assert.equal(applied.applied_now, true);
      await actor.begin(); const pending = actor.command(restoreSql(type)); await lockBarrier(`${type}-restore-after-finance`);
      await finance.command("commit;"); assert.deepEqual(JSON.parse(await pending), []); await actor.command("commit;");
      const stored = await target(type);
      assert.equal(stored.status, "published"); assert.equal(Date.parse(stored.published_at), Date.parse(applied.paid_at));
      assert.equal(Date.parse(stored.expires_at) - Date.parse(applied.paid_at), 9 * 86400_000);
      assert.equal(await effects(type), "1");
    } finally { finance.close(); actor.close(); }
  });
}

test("runner name collision cannot delete or alter the already-owned synthetic fixture", async () => {
  const beforeListing = await target("listing"), beforeVacancy = await target("vacancy");
  await assert.rejects(run(process.execPath, ["--test", "--test-name-pattern=^listing: RPC is", "--test-reporter=spec", fileURLToPath(import.meta.url)],
    { env: environment, timeout: 15_000, maxBuffer: 1024 * 1024 }), (error) => {
      assert.equal(error.code, 1);
      assert.match(`${error.stdout}\n${error.stderr}`, /already in use/);
      return true;
    });
  assert.deepEqual(await target("listing"), beforeListing); assert.deepEqual(await target("vacancy"), beforeVacancy);
  assert.equal(await docker(["inspect", "--format", `{{index .Config.Labels "${label}"}}`, container]), labelValue);
});
