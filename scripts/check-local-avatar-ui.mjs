// Explicit browser check: creates only its own synthetic local user and avatar.
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {REGISTRATION_LEGAL_VERSIONS as legal} from '../src/lib/registration-legal.ts';
import {stateFile, stateDirectory, docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState, validateLocalPrimaryContainer} from './local-primary-config.mjs';

const state = readLocalPrimaryState(stateFile, process.cwd());
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect', state.containerId]))[0], state);
const origin = state.origin;
const email = 'avatar-ui-' + randomUUID() + '@local.invalid';
const password = 'SyntheticAvatar-' + randomUUID() + '!';
const headers = {Origin: origin, 'Content-Type': 'application/json', 'X-Blizhniy-Request': '1', 'Sec-Fetch-Site': 'same-origin'};
const browser = await chromium.launch({headless: true});
const context = await browser.newContext({ignoreHTTPSErrors: true});
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.name));
const accountTimeline = [];
page.on('response', response => {
  const pathname = new URL(response.url()).pathname;
  if (/^\/api\/account\/(session|profile)$/.test(pathname)) accountTimeline.push({path: pathname, method: response.request().method(), status: response.status()});
});

try {
  const registration = await context.request.post(origin + '/api/account/register', {
    headers, data: {name: 'Проверка аватара', email, password, captchaToken: '', acceptedAgreement: true,
      acknowledgedPrivacy: true, agreementVersion: legal.agreement, privacyVersion: legal.privacy},
  });
  assert.equal(registration.status(), 202, 'Own synthetic local account is registered');
  let confirmation;
  const deadline = Date.now() + 10000;
  while (!confirmation && Date.now() < deadline) {
    for (const filename of (await readdir(stateDirectory)).filter(name => /^mail-[a-f0-9-]{36}\.json$/.test(name))) {
      const captured = JSON.parse(await readFile(join(stateDirectory, filename), 'utf8'));
      if (captured.to === email) confirmation = captured.text.match(/#token=([a-f0-9]{64})/)?.[1];
    }
    if (!confirmation) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(confirmation, 'Confirmation was captured locally without external SMTP');
  const confirmed = await context.request.post(origin + '/api/account/confirm', {headers, data: {token: confirmation}});
  assert.equal(confirmed.status(), 200, 'Own synthetic email is confirmed');
  await page.goto(origin + '/auth');
  await page.getByLabel('Email', {exact: true}).fill(email);
  await page.getByLabel('Пароль', {exact: true}).fill(password);
  await page.getByRole('button', {name: 'Войти', exact: true}).click();
  await page.waitForURL(origin + '/');
  await page.goto(origin + '/cabinet');
  await page.getByRole('button', {name: 'Настройки', exact: true}).click();

  const bytes = await sharp({create: {width: 960, height: 640, channels: 3, background: '#2474b5'}}).png().toBuffer();
  const file = {name: 'synthetic-avatar.png', mimeType: 'image/png', buffer: bytes};
  const picker = page.locator('input[type=file]');
  await picker.setInputFiles(file);
  await page.getByRole('heading', {name: 'Выберите область аватарки', exact: true}).waitFor();
  assert.equal(await picker.inputValue(), '', 'Picker is released so native same-file selection is possible');
  await page.getByRole('button', {name: 'Закрыть редактор аватарки', exact: true}).click();
  await page.getByRole('heading', {name: 'Выберите область аватарки', exact: true}).waitFor({state: 'detached'});
  await picker.setInputFiles(file);
  await page.getByRole('heading', {name: 'Выберите область аватарки', exact: true}).waitFor();
  assert.equal(await picker.inputValue(), '', 'Repeated selection also releases the picker');
  const result = page.waitForResponse(response => response.url() === origin + '/api/account/profile' && response.request().method() === 'PUT');
  await page.getByRole('button', {name: 'Применить', exact: true}).click();
  assert.equal((await result).status(), 200, 'Actual restricted PostgreSQL profile write succeeds');
  await page.getByRole('heading', {name: 'Выберите область аватарки', exact: true}).waitFor({state: 'detached'});
  await page.reload();
  const avatar = page.locator('#cabinet-profile img');
  await avatar.waitFor();
  await avatar.evaluate(image => image.decode());
  assert.equal(await avatar.evaluate(image => image.complete && image.naturalWidth === 512 && image.naturalHeight === 512), true,
    'Saved square avatar remains after reload');
  const previousAvatar = await avatar.getAttribute('src');
  await page.getByRole('button', {name: 'Настройки', exact: true}).click();
  const jpeg = await sharp({create: {width: 1600, height: 1000, channels: 3, background: '#b54a24'}}).jpeg().toBuffer();
  await picker.setInputFiles({name: 'synthetic-avatar-replacement.jpg', mimeType: 'image/jpeg', buffer: jpeg});
  await page.getByRole('heading', {name: 'Выберите область аватарки', exact: true}).waitFor();
  const replacementResult = page.waitForResponse(response => response.url() === origin + '/api/account/profile' && response.request().method() === 'PUT');
  await page.getByRole('button', {name: 'Применить', exact: true}).click();
  assert.equal((await replacementResult).status(), 200, 'Replacing an existing PNG avatar with JPEG succeeds');
  await page.getByRole('heading', {name: 'Выберите область аватарки', exact: true}).waitFor({state: 'detached'});
  const visibleSaveResult = page.waitForResponse(response => response.url() === origin + '/api/account/profile' && response.request().method() === 'PUT');
  await page.getByRole('button', {name: 'Сохранить настройки', exact: true}).click();
  assert.equal((await visibleSaveResult).status(), 200, 'Visible settings save after replacing an avatar succeeds');
  await page.getByRole('status').filter({hasText: 'Настройки сохранены.'}).waitFor();
  await page.reload();
  await avatar.waitFor();
  await avatar.evaluate(image => image.decode());
  const replacementAvatar = await avatar.getAttribute('src');
  assert.notEqual(replacementAvatar, previousAvatar, 'Replacement remains different from the old avatar after visible save and reload');
  console.log(JSON.stringify({phase: 'desktop-avatar-replacement-and-visible-save', status: 'passed', profileWrites: 3,
    oldAvatarRestored: false, productionTouched: false}));

  // A short window also covers landscape phones and desktop browser zoom: a
  // fixed modal must allow scrolling its controls instead of clipping them.
  await page.setViewportSize({width: 640, height: 400});
  await page.getByRole('button', {name: 'Настройки', exact: true}).click();
  await picker.setInputFiles(file);
  await page.getByRole('heading', {name: 'Выберите область аватарки', exact: true}).waitFor();
  const dialog = page.locator('dialog:modal');
  await dialog.waitFor();
  assert.equal(await dialog.count(), 1, 'Crop uses the browser modal top layer');
  const apply = page.getByRole('button', {name: 'Применить', exact: true});
  await apply.scrollIntoViewIfNeeded();
  const box = await apply.boundingBox();
  await page.screenshot({path: '/tmp/blizhniy-avatar-short-window.png'});
  assert.ok(box && box.y >= 0 && box.y + box.height <= 400,
    'Avatar crop action must be reachable inside a short viewport after scrolling');
  let releaseSave, signalSave;
  const saveMayContinue = new Promise(resolve => { releaseSave = resolve; });
  const saveIsPending = new Promise(resolve => { signalSave = resolve; });
  const intercept = async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    signalSave();
    await saveMayContinue;
    return route.continue();
  };
  await page.route('**/api/account/profile', intercept);
  const shortSave = page.waitForResponse(response => response.url() === origin + '/api/account/profile' && response.request().method() === 'PUT');
  try {
    await apply.click();
    await saveIsPending;
    await page.keyboard.press('Escape');
    assert.equal(await dialog.count(), 1, 'Escape does not dismiss a save whose outcome is still pending');
    assert.equal(await page.getByRole('button', {name: 'Закрыть редактор аватарки', exact: true}).isDisabled(), true);
  } finally {
    releaseSave();
  }
  assert.equal((await shortSave).status(), 200, 'Real pointer click on short-window Apply saves to restricted PostgreSQL');
  await dialog.waitFor({state: 'detached'});
  await page.unroute('**/api/account/profile', intercept);
  console.log(JSON.stringify({phase: 'short-window-avatar', status: 'passed', nativeModal: true,
    pointerApply: true, escapeDuringSaveKeptOpen: true, profileWrite: 200}));

  await page.setViewportSize({width: 390, height: 667});
  await picker.setInputFiles(file);
  await dialog.waitFor();
  const interruptedCrop = await dialog.getByRole('img', {name: 'Фото для аватарки', exact: true}).getAttribute('src');
  let failNextSave = true;
  let attemptedWrites = 0;
  const failOnce = async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    attemptedWrites++;
    if (!failNextSave) return route.continue();
    failNextSave = false;
    return route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({error: {code: 'PROFILE_UNAVAILABLE'}})});
  };
  await page.route('**/api/account/profile', failOnce);
  const failedSave = page.waitForResponse(response => response.url() === origin + '/api/account/profile' && response.request().method() === 'PUT');
  await apply.click();
  assert.equal((await failedSave).status(), 503, 'Only this synthetic avatar write receives a simulated local outage');
  // Unknown write outcomes must not permit a blind retry. Keep the source in
  // owner-scoped memory, acknowledge the failure, then fetch a fresh revision.
  const profileFailure = page.getByRole('alert').filter({hasText: 'Сохранение не подтверждено.'});
  await profileFailure.waitFor();
  assert.equal(await profileFailure.count(), 1, 'An unknown avatar write exposes its result uncertainty instead of claiming success');
  assert.equal(attemptedWrites, 1, 'The failed write is not retried automatically');
  assert.equal(await page.getByRole('button', {name: 'Применить', exact: true}).count(), 0,
    'Saving remains blocked until an explicit fresh profile read');
  const freshRead = page.waitForResponse(response => response.url() === origin + '/api/account/profile' && response.request().method() === 'POST');
  await page.getByRole('button', {name: 'Обновить профиль', exact: true}).click();
  const freshResponse = await freshRead;
  assert.equal(freshResponse.status(), 200, 'Recovery obtains authoritative current profile data');
  const freshProfile = await freshResponse.json();
  await dialog.waitFor();
  assert.equal(await dialog.getByRole('img', {name: 'Фото для аватарки', exact: true}).getAttribute('src'), interruptedCrop,
    'The same owner can resume the selected crop after successful readback');
  assert.equal(attemptedWrites, 1, 'Fresh readback itself does not write or silently apply the crop');
  const retrySave = page.waitForResponse(response => response.url() === origin + '/api/account/profile' && response.request().method() === 'PUT');
  await apply.click();
  const retried = await retrySave;
  assert.equal(retried.status(), 200, 'Explicit retry after local transient failure and authoritative readback succeeds');
  assert.equal(retried.request().postDataJSON().expectedRevision, freshProfile.revision,
    'Explicit retry uses the freshly read revision rather than the stale failed-write revision');
  await dialog.waitFor({state: 'detached'});
  await page.unroute('**/api/account/profile', failOnce);
  await picker.setInputFiles(file);
  await dialog.waitFor();
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('dialog:modal')?.contains(document.activeElement))), true,
    'Opening the crop dialog transfers focus inside it');
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press('Tab');
    const focusState = await page.evaluate(() => ({modal: Boolean(document.querySelector('dialog:modal')),
      tag: document.activeElement?.tagName, type: document.activeElement?.getAttribute('type'),
      inside: Boolean(document.querySelector('dialog:modal')?.contains(document.activeElement))}));
    if (!focusState.modal) console.log(JSON.stringify({phase: 'avatar-focus-diagnostic', step: index,
      timeline: accountTimeline.slice(-10),
      cropHeadings: await page.getByRole('heading', {name: 'Выберите область аватарки', exact: true}).count(),
      settingsHeadings: await page.getByRole('heading', {name: 'Настройки аккаунта', exact: true}).count(),
      profileBars: await page.locator('#cabinet-profile').count(),
      browser: await page.evaluate(() => ({focused: document.hasFocus(), visibility: document.visibilityState,
        dialogPresent: Boolean(document.querySelector('dialog')), dialogOpen: Boolean(document.querySelector('dialog')?.open)}))}));
    assert.equal(await page.evaluate(() => {
      const modal = document.querySelector('dialog:modal');
      // Chromium may visit body during the browser-chrome focus wrap; no
      // interactive element from the inert background may receive focus.
      return Boolean(modal && (modal.contains(document.activeElement) || document.activeElement === document.body));
    }), true, 'Tab cannot reach background navigation or profile fields: ' + JSON.stringify({step: index, ...focusState}));
  }
  await page.keyboard.press('Escape');
  await dialog.waitFor({state: 'detached'});
  assert.equal(await picker.inputValue(), '', 'Escape cancellation still permits choosing the same photo');
  assert.deepEqual(errors, [], 'Browser has no uncaught application errors');
  console.log(JSON.stringify({status: 'passed', ownSyntheticUser: true, cookieAuth: true,
    sameFileAfterCancel: true, actualProfilePut: 200, avatarPersistedAfterReload: true,
    avatarDimensions: '512x512', shortWindowApply: true, mobile390x667: true, focusContained: true,
    escapeClosesIdle: true, escapeDoesNotCancelSave: true, seedProfileTouched: false, externalMail: false, productionTouched: false}));
} finally {
  await browser.close();
}
