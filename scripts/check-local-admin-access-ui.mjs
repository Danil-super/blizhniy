// Exercises only the owned HTTPS stand and a newly created synthetic administrator.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {chromium} from 'playwright';
import pg from 'pg';
import {docker, localPrimaryDatabaseConfig, stateDirectory, stateFile} from './local-primary-fixture.mjs';
import {readLocalPrimaryState, validateLocalPrimaryContainer} from './local-primary-config.mjs';
import {createLocalPrimaryHttpsClient} from './local-primary-https.mjs';

const state = readLocalPrimaryState(stateFile, process.cwd());
assert.equal(state.origin, 'https://127.0.0.1:3045');
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect', state.containerId]))[0], state);
const operator = JSON.parse(await readFile(join(stateDirectory, 'accounts.json'), 'utf8')).find(account => account.role === 'admin');
assert.match(operator.email, /@local\.invalid$/);
const client = createLocalPrimaryHttpsClient(await readFile(join(stateDirectory, 'tls-cert.pem')));
const require = createRequire(import.meta.url);
const id = randomUUID(), email = 'admin-view-' + id + '@local.invalid', password = 'Synthetic-' + randomUUID() + '!';
const db = new pg.Client(localPrimaryDatabaseConfig(state, 'owner'));
const widths = [320, 768, 1440], errors = [], foreign = [];
let browser, created = false, operatorSignedIn = false;

async function verifyLayout(page, section) {
  await page.addScriptTag({path: require.resolve('axe-core/axe.min.js')});
  for (const width of widths) {
    await page.setViewportSize({width, height: 900});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const issues = await section.evaluate(async node => {
      const report = await window.axe.run(node, {runOnly: {type:'tag', values:['wcag2a','wcag2aa','wcag21aa']}});
      return report.violations.filter(row => ['critical','serious'].includes(row.impact)).map(row => row.id);
    });
    assert.deepEqual(issues, [], page.url() + ' ' + width);
  }
}

await db.connect();
try {
  const hash = await require('./local-primary-modules.cjs').loadLocalPrimaryModule('identity').hashPassword(password);
  await db.query("insert into app.users(id,email,password_hash,role,email_verified_at) values($1,$2,$3,'admin',clock_timestamp())", [id,email,hash]);
  created = true;
  const login = await client('/api/account/login', {body:{email:operator.email, password:operator.password, captchaToken:''}});
  operatorSignedIn = true;
  assert.equal(login.data.user.id, operator.id);
  browser = await chromium.launch();
  const context = await browser.newContext({ignoreHTTPSErrors:true, serviceWorkers:'block'});
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['http:','https:'].includes(url.protocol) && url.origin !== state.origin) {
      foreign.push(url.host);
      return route.abort();
    }
    return route.continue();
  });
  const users = await context.newPage(), tariffs = await context.newPage();
  for (const page of [users, tariffs]) {
    page.setDefaultTimeout(12000);
    page.on('pageerror', error => errors.push(error.name));
  }
  await users.goto(state.origin + '/auth');
  await users.getByLabel('Email', {exact:true}).fill(email);
  await users.getByLabel('Пароль', {exact:true}).fill(password);
  await users.getByRole('button', {name:'Войти', exact:true}).click();
  await users.waitForURL(state.origin + '/');
  await users.goto(state.origin + '/admin/users');
  await users.locator('#admin-user-search').fill(id);
  await users.getByRole('button', {name:'Найти', exact:true}).click();
  const directory = users.getByRole('region', {name:'Список пользователей'});
  await directory.locator('dd').filter({hasText:email}).waitFor();
  await verifyLayout(users, directory);
  await tariffs.goto(state.origin + '/admin/tariffs');
  await tariffs.locator('#tariff-listing-publication').click();
  const editor = tariffs.getByRole('region', {name:'Изменение тарифа'});
  await editor.getByLabel('Причина изменения').fill('Несохранённая локальная причина');
  await verifyLayout(tariffs, editor);
  const demoted = await client('/api/admin/user-access', {body:{action:'change', expectedAdminId:operator.id,
    input:{id:randomUUID(), targetId:id, expectedVersion:'0', role:'user', isBlocked:false, reason:'Проверка отзыва доступа на локальном стенде'}}});
  assert.equal(demoted.data.user.role, 'user');
  assert.equal(demoted.data.user.authVersion, '1');
  for (const page of [users, tariffs]) {
    const checked = page.waitForResponse(response => response.url() === state.origin + '/api/account/session' && response.request().method() === 'POST');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    const session = await checked;
    assert.equal(session.status(), 200);
    assert.deepEqual(await session.json(), {user:null});
    await page.getByRole('heading', {name:'Нужно войти', exact:true}).waitFor();
  }
  assert.equal(await directory.count(), 0);
  assert.equal(await editor.count(), 0);
  assert.equal(await users.getByText(email, {exact:true}).count(), 0);
  const denied = await context.request.post(state.origin + '/api/admin/user-directory', {
    headers:{Origin:state.origin, 'X-Blizhniy-Request':'1', 'Sec-Fetch-Site':'same-origin'},
    data:{expectedAdminId:id, query:'', role:'all', status:'all', cursor:null},
  });
  assert.equal(denied.status(), 403);
  assert.deepEqual(errors, []);
  assert.deepEqual(foreign, []);
  console.log(JSON.stringify({passed:true, widths, screens:2, roleRevoked:true, directoryDenied:true, productionTouched:false}));
} finally {
  try { await browser?.close(); }
  finally {
    try { if (operatorSignedIn) await client('/api/account/logout'); }
    finally {
      try { if (created) await db.query('update app.users set is_blocked=true where id=$1 and email=$2', [id,email]); }
      finally { await db.end(); }
    }
  }
}
