import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

/** Actual browser UI against the owned HTTPS/PG fixture; no external accounts or grants. */
export async function testLocalReferenceAdminUi(suite, db, { browser, origin, seedUser, password, fetchLocal }) {
  const email = "ui-references-admin@example.invalid";
  const id = await seedUser(email);
  await db.query("update app.users set role='admin' where id=$1", [id]);
  await seedUser("ui-references-user@example.invalid");
  const login = async (page, account = email) => {
    await page.goto(`${origin}/auth/local/login`);
    await page.getByLabel("Email", { exact: true }).fill(account);
    await page.getByLabel("Пароль", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.getByText(account, { exact: true }).waitFor();
  };
  const editor = (page) => page.getByRole("form", { name: /^Тариф / }).filter({ hasText: "listing-publication" });
  const ready = (page) => editor(page).waitFor();
  const run = (name, fn) => suite.test(name, async () => {
    await db.query("delete from app.auth_rate_limits");
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const foreign = [];
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      if (["http:", "https:"].includes(url.protocol) && url.origin !== origin) { foreign.push(url.hostname); return route.abort(); }
      return route.continue();
    });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    try { await fn(page, context); assert.deepEqual(foreign, []); } finally { await context.close(); }
  });
  await run("local reference UI hides all editors from anonymous and ordinary accounts", async page => {
    await page.goto(`${origin}/auth/local/admin`);
    await page.getByRole("alert").filter({ hasText: "Войдите" }).waitFor();
    assert.equal(await page.locator("main form").count(), 0);
    await login(page, "ui-references-user@example.invalid");
    const response = await page.goto(`${origin}/auth/local/admin`);
    assert.equal(response.headers()["referrer-policy"], "no-referrer");
    await page.getByRole("alert").filter({ hasText: "Нет действующих прав" }).waitFor();
    assert.equal(await page.locator("main input").count(), 0);
    await page.screenshot({ path: "/tmp/blizhniy-reference-admin-denied.png", fullPage: true });
  });
  await run("browser edits exact kopeks, nullable duration, activity and category name without extra writes", async page => {
    await login(page); await page.goto(`${origin}/auth/local/admin`); await ready(page);
    let writes = 0; const errors = [];
    page.on("request", request => { if (request.url().includes("/api/admin/local/") && request.method() === "PATCH") writes++; });
    page.on("pageerror", () => errors.push("pageerror"));
    page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(message.type()); });
    await editor(page).getByLabel("Цена, ₽", { exact: true }).fill("0.001");
    await editor(page).getByRole("button", { name: "Сохранить тариф", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "двух знаков" }).waitFor(); assert.equal(writes, 0);
    await editor(page).getByLabel("Цена, ₽", { exact: true }).fill("0,29");
    await editor(page).getByLabel("Срок, дней").fill("");
    await editor(page).getByLabel("Тариф активен", { exact: true }).check();
    await editor(page).getByRole("button", { name: "Сохранить тариф", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Изменения сохранены" }).waitFor();
    assert.deepEqual((await db.query("select price::text,duration_days,active from app.tariffs where id='listing-publication'")).rows[0], { price: "0.29", duration_days: null, active: true });
    const category = page.getByRole("form", { name: /^Категория / }).filter({ hasText: "web-child" });
    await category.getByLabel("Название категории", { exact: true }).fill("Название из браузера");
    await category.getByLabel("Категория видна", { exact: true }).uncheck();
    await category.getByRole("button", { name: "Сохранить категорию", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Изменения сохранены" }).waitFor();
    assert.deepEqual((await db.query("select name,active from app.categories where slug='web-child'")).rows[0], { name: "Название из браузера", active: false });
    assert.equal(writes, 2); assert.deepEqual(errors, []);
  });
  await run("keyboard root reorder persists the full order including hidden roots", async page => {
    const rows = (await db.query("select id,name from app.categories where parent_id is null order by sort_order,id")).rows;
    await db.query("update app.categories set active=false where id=$1", [rows[1].id]);
    await login(page); await page.goto(`${origin}/auth/local/admin`); await ready(page);
    await page.getByRole("button", { name: `Ниже: ${rows[0].name}`, exact: true }).focus();
    await page.keyboard.press("Enter");
    const button = page.getByRole("button", { name: "Сохранить порядок разделов", exact: true });
    assert.equal(await button.isEnabled(), true); await button.click();
    await page.getByRole("status").filter({ hasText: "Изменения сохранены" }).waitFor();
    assert.deepEqual((await db.query("select id from app.categories where parent_id is null order by sort_order,id")).rows.map(row => row.id), [rows[1].id, rows[0].id]);
  });
  await run("unknown successful PATCH response hides editors and requires readback rather than retry", async page => {
    await login(page); await page.goto(`${origin}/auth/local/admin`); await ready(page);
    let writes = 0;
    await page.route("**/api/admin/local/tariffs", async route => {
      if (route.request().method() !== "PATCH") return route.continue();
      writes++;
      const request = route.request();
      const response = await fetchLocal("/api/admin/local/tariffs", { method: "PATCH", headers: await request.allHeaders(), body: request.postData() });
      assert.equal(response.status, 200); await route.abort();
    });
    await editor(page).getByLabel("Цена, ₽", { exact: true }).fill("17.31");
    await editor(page).getByRole("button", { name: "Сохранить тариф", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "результат неизвестен" }).waitFor();
    assert.equal(await page.locator("main form").count(), 0); assert.equal(writes, 1);
    await page.getByRole("button", { name: "Перечитать справочники", exact: true }).click(); await ready(page);
    assert.equal(await editor(page).getByLabel("Цена, ₽", { exact: true }).inputValue(), "17.31"); assert.equal(writes, 1);
  });
  await run("logout in another tab clears reference data and rejects a held stale list response", async (page, context) => {
    await login(page); await page.goto(`${origin}/auth/local/admin`); await ready(page);
    const second = await context.newPage(); await second.goto(`${origin}/auth/local/login`); await second.getByText(email, { exact: true }).waitFor();
    let release; let started; let fulfilled;
    const held = new Promise(resolve => { release = resolve; }); const received = new Promise(resolve => { started = resolve; });
    const delivered = new Promise(resolve => { fulfilled = resolve; });
    let intercept = true;
    await page.route("**/api/admin/local/categories", async route => {
      if (!intercept) return route.continue(); intercept = false;
      const request = route.request();
      const response = await fetchLocal("/api/admin/local/categories", { method: "POST", headers: await request.allHeaders(), body: request.postData() });
      const body = await response.text(); assert.equal(response.status, 200); started(); await held;
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body });
      fulfilled();
    });
    try {
      await page.getByRole("button", { name: "Перечитать справочники", exact: true }).click(); await received;
      assert.equal(await page.locator("main form").count(), 0);
      await second.getByRole("button", { name: "Выйти", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "Войдите" }).waitFor(); release(); await delivered;
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.getByRole("alert").filter({ hasText: "Войдите" }).waitFor();
      assert.equal(await page.locator("main form").count(), 0);
    } finally { release(); }
  });
  await run("demotion hides reference editors on explicit reread without trusting displayed admin role", async page => {
    await login(page); await page.goto(`${origin}/auth/local/admin`); await ready(page);
    await db.query("update app.users set role='user' where id=$1", [id]);
    try {
      await page.getByRole("button", { name: "Перечитать справочники", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "Нет действующих прав" }).waitFor();
      assert.equal(await page.locator("main form").count(), 0);
    } finally { await db.query("update app.users set role='admin' where id=$1", [id]); }
  });
  await run("empty and rate-limited browser responses have explicit states without automatic retries", async page => {
    await login(page);
    await page.route("**/api/admin/local/categories", route => route.fulfill({ json: { categories: [] } }));
    await page.route("**/api/admin/local/tariffs", route => route.fulfill({ json: { tariffs: [] } }));
    await page.goto(`${origin}/auth/local/admin`);
    await page.getByText("Тарифов пока нет.", { exact: false }).waitFor();
    await page.getByText("Категорий пока нет.", { exact: false }).waitFor();
    assert.equal(await page.locator("main input").count(), 0);
    let attempts = 0;
    await page.route("**/api/admin/local/tariffs", route => { attempts++; return route.fulfill({ status: 429, json: { error: { code: "RATE_LIMITED" } } }); });
    await page.getByRole("button", { name: "Перечитать справочники", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Достигнут лимит" }).waitFor();
    assert.equal(attempts, 1); assert.equal(await page.locator("main input").count(), 0);
  });
  await run("reference UI fits all breakpoints, has named keyboard controls and passes axe main-region checks", async page => {
    await login(page);
    const require = createRequire(import.meta.url);
    const axe = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 }); await page.goto(`${origin}/auth/local/admin`); await ready(page);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      assert.equal(await page.getByRole("heading", { level: 1 }).count(), 1);
      const targets = await page.locator("main button").evaluateAll(buttons => buttons.map(button => { const box = button.getBoundingClientRect(); return { width: box.width, height: box.height }; }));
      assert.ok(targets.every(box => box.width >= 44 && box.height >= 44), "buttons have at least 44x44 touch targets");
      assert.match(await page.locator("main").ariaSnapshot(), /textbox "Цена, ₽"/);
      await editor(page).getByLabel("Цена, ₽", { exact: true }).focus(); await page.keyboard.press("Tab");
      assert.equal(await editor(page).getByLabel("Срок, дней").evaluate(element => element === document.activeElement), true);
      await page.screenshot({ path: `/tmp/blizhniy-reference-admin-${width}.png`, fullPage: true });
    }
    await page.addScriptTag({ content: axe });
    const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector("main"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map(row => ({ id: row.id, impact: row.impact })));
    assert.deepEqual(violations, []);
  });
}
