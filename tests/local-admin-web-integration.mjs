import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { IdentityStore, hashSessionToken } from "../src/lib/identity.ts";

/** Reuses the owned PG + real HTTPS Next server. No remote database or real recipients. */
export async function testLocalAdminWeb(suite, db, { post, fetchLocal, origin, seedUser, password, readOutput, rateSecret, browser }) {
  const email = "web-admin@example.invalid";
  const id = await seedUser(email);
  await db.query("update app.users set role='admin' where id=$1", [id]);
  await seedUser("web-admin-user@example.invalid");
  await db.query("insert into app.categories(slug,name,sort_order) values('web-tools','Web tools',10),('web-home','Web home',20)");
  await db.query("insert into app.categories(parent_id,slug,name,sort_order,active) select id,'web-child','Hidden child',10,false from app.categories where slug='web-tools'");
  await db.query("insert into app.tariffs(id,action,name,price,duration_days,active) values('listing-publication','listing_publication','Publication',199,30,true),('job-response','job_response','Response',99,null,false)");
  const categoryRows = async () => (await db.query("select id,parent_id,slug,name,sort_order,active from app.categories order by sort_order,id")).rows;
  const listing = async () => (await db.query("select id,action,name,price::text,duration_days,active from app.tariffs where id='listing-publication'")).rows[0];
  const roots = (await categoryRows()).filter(row => row.parent_id === null).map(row => row.id);
  let adminCookie, userCookie;
  const call = async (resource, input = {}, method = "POST", headers = {}, query = "") => {
    const response = await fetchLocal(`/api/admin/local/${resource}${query}`, { method, body: ["GET", "HEAD", "OPTIONS"].includes(method) ? undefined : JSON.stringify(input),
      headers: { "Content-Type": "application/json", Origin: origin, "X-Blizhniy-Request": "1", Cookie: adminCookie ?? "", ...headers } });
    return { status: response.status, body: method === "HEAD" ? null : await response.json(), headers: response.headers };
  };
  const run = (name, fn) => suite.test(name, async () => { await db.query("delete from app.auth_rate_limits"); await fn(); });

  await run("real HTTPS admin lists require the new host cookie, live admin role and privacy headers", async () => {
    adminCookie = (await post("login", { email, password })).headers.get("set-cookie").split(";")[0];
    userCookie = (await post("login", { email: "web-admin-user@example.invalid", password })).headers.get("set-cookie").split(";")[0];
    const categories = await call("categories");
    assert.equal(categories.status, 200);
    assert.deepEqual(categories.body, { categories: await categoryRows() });
    assert.equal(categories.body.categories.find(row => row.slug === "web-child").active, false);
    const tariffs = await call("tariffs");
    assert.equal(tariffs.status, 200);
    assert.equal(tariffs.body.tariffs.length, 2);
    assert.equal(tariffs.body.tariffs[0].active, false);
    for (const response of [categories, tariffs]) {
      assert.equal(response.headers.get("referrer-policy"), "no-referrer");
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.equal(response.headers.get("set-cookie"), null);
      assert.match(response.headers.get("x-request-id"), /^[a-f0-9-]{36}$/);
    }
    assert.equal((await call("categories", {}, "POST", { Cookie: "" })).status, 401);
    assert.equal((await call("categories", {}, "POST", { Cookie: userCookie })).status, 403);
    assert.equal((await call("tariffs", {}, "POST", { Cookie: `${adminCookie}; ${adminCookie}` })).status, 401);
    assert.equal((await call("users")).status, 404);
  });
  await run("HTTPS patches persist exact price and nullable duration and a complete root order", async () => {
    const before = await listing();
    assert.equal((await call("tariffs", { id: before.id, price: 0.29 }, "PATCH")).status, 200);
    assert.deepEqual(await listing(), { ...before, price: "0.29" });
    assert.equal((await call("tariffs", { id: before.id, durationDays: null, active: false }, "PATCH")).status, 200);
    assert.deepEqual(await listing(), { ...before, price: "0.29", duration_days: null, active: false });
    const category = (await categoryRows()).find(row => row.parent_id !== null);
    const saved = await call("categories", { id: category.id, name: "  Ручное название  ", active: true }, "PATCH");
    assert.deepEqual(saved.body.category, { ...category, name: "Ручное название", active: true });
    assert.equal((await call("category-order", { ids: [...roots].reverse() }, "PATCH")).status, 200);
    assert.deepEqual((await categoryRows()).filter(row => row.parent_id === null).map(row => row.id), [...roots].reverse());
    assert.equal((await call("tariffs", { id: "unknown", price: 0 }, "PATCH")).status, 404);
  });
  await run("HTTPS admin rejects CSRF, overposting, fractional kopeks and incomplete order without reference writes", async () => {
    const before = await categoryRows();
    const price = await listing();
    assert.equal((await call("tariffs", { id: price.id, price: 0 }, "PATCH", { Origin: "https://foreign.invalid" })).status, 403);
    for (const input of [{ id: price.id, price: 0.001 }, { id: price.id, price: "0" }, { id: price.id, role: "admin", price: 0 }, { id: price.id, durationDays: 0 }]) {
      assert.equal((await call("tariffs", input, "PATCH")).status, 422);
    }
    assert.equal((await call("categories", { id: roots[0], parentId: roots[1], active: false }, "PATCH")).status, 422);
    assert.equal((await call("category-order", { ids: roots.slice(1) }, "PATCH")).status, 422);
    assert.equal((await call("category-order", { ids: roots }, "POST")).status, 405);
    assert.equal((await call("categories", {}, "GET")).status, 405);
    assert.equal((await call("tariffs", {}, "OPTIONS")).status, 405);
    assert.equal((await call("categories", { token: adminCookie.split("=")[1] })).status, 422);
    const queryToken = adminCookie.split("=")[1];
    assert.equal((await call("categories", {}, "POST", {}, `?token=${queryToken}`)).status, 400);
    assert.equal(readOutput().includes(queryToken), false);
    assert.deepEqual(await categoryRows(), before);
    assert.deepEqual(await listing(), price);
  });
  await run("blocked/demoted, stale, limited-scope and revoked sessions never authorize price changes", async () => {
    const price = await listing();
    const payload = { id: price.id, price: 0 };
    await db.query("update app.users set role='user' where id=$1", [id]);
    assert.equal((await call("tariffs", payload, "PATCH")).status, 403);
    await db.query("update app.users set role='admin',is_blocked=true where id=$1", [id]);
    assert.equal((await call("tariffs", payload, "PATCH")).status, 403);
    await db.query("update app.users set is_blocked=false,auth_version=auth_version+1 where id=$1", [id]);
    assert.equal((await call("tariffs", payload, "PATCH")).status, 403);
    const limited = await new IdentityStore(db).loginForDataSubject(email, password);
    assert.equal((await call("tariffs", payload, "PATCH", { Cookie: `__Host-blizhniy_session=${limited.token}` })).status, 403);
    adminCookie = (await post("login", { email, password })).headers.get("set-cookie").split(";")[0];
    const token = adminCookie.split("=")[1];
    await post("logout", {}, { Cookie: adminCookie });
    assert.equal((await call("tariffs", payload, "PATCH")).status, 403);
    assert.deepEqual(await listing(), price);
    assert.equal((await db.query("select count(*)::int as count from app.sessions where token_hash=$1", [hashSessionToken(token)])).rows[0].count, 0);
    for (const secret of [token, limited.token, email, password]) assert.equal(readOutput().includes(secret), false);
  });
  await run("persistent admin limiter has a separate auth namespace and no login contention", async () => {
    adminCookie = (await post("login", { email, password })).headers.get("set-cookie").split(";")[0];
    // Read only the test process's allowlisted structured logs to associate its response.
    const first = await call("tariffs");
    assert.equal(first.status, 200);
    // This owned fixture currently has auth:all, auth:email and one separate admin:all digest.
    const rows = (await db.query("select key_hash,attempts from app.auth_rate_limits")).rows;
    assert.equal(rows.length, 3);
    const adminSecret = createHmac("sha256", rateSecret).update("local-admin").digest("hex");
    const adminKey = createHmac("sha256", adminSecret).update("auth:all").digest("hex");
    const authKey = createHmac("sha256", rateSecret).update("auth:all").digest("hex");
    assert.notEqual(adminKey, authKey);
    assert.equal(rows.find(row => row.key_hash === adminKey).attempts, 1);
    for (let n = 1; n < 60; n++) assert.equal((await call("tariffs")).status, 200);
    const denied = await call("tariffs");
    assert.equal(denied.status, 429);
    assert.equal(denied.headers.get("retry-after"), "900");
    assert.equal((await db.query("select attempts from app.auth_rate_limits where key_hash=$1", [authKey])).rows[0].attempts, 1);
    assert.equal((await post("session", {}, { Cookie: adminCookie })).status, 200);
    assert.equal((await post("login", { email, password })).status, 200);
    const event = readOutput().split("\n").filter(line => line.startsWith("{"))
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .find(event => event?.requestId === denied.headers.get("x-request-id"));
    assert.equal(event.event, "local_admin_request");
    assert.equal(event.entryPoint, "http");
    assert.equal(event.code, "RATE_LIMITED");
    assert.equal(event.status, 429);
  });
  const { testLocalReferenceAdminUi } = await import("./local-reference-admin-ui-web.mjs");
  await testLocalReferenceAdminUi(suite, db, { browser, origin, seedUser, password, fetchLocal });
}
