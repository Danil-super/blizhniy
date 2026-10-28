// Local-only regression for file-picker focus races; uses an independent synthetic account.
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
const origin = state.origin, email = 'avatar-preparation-' + randomUUID() + '@local.invalid', password = 'Avatar-' + randomUUID() + '!';
const browser = await chromium.launch({headless: true});
const context = await browser.newContext({ignoreHTTPSErrors: true});
const page = await context.newPage();
const errors = []; page.on('pageerror', error => errors.push(error.name));
const headers = {Origin: origin, 'Content-Type': 'application/json', 'X-Blizhniy-Request': '1', 'Sec-Fetch-Site': 'same-origin'};
try {
  const registered = await context.request.post(origin + '/api/account/register', {headers, data: {name: 'Подготовка аватара', email, password,
    captchaToken: '', acceptedAgreement: true, acknowledgedPrivacy: true, agreementVersion: legal.agreement, privacyVersion: legal.privacy}});
  assert.equal(registered.status(), 202);
  let token;
  for (let attempt = 0; attempt < 100 && !token; attempt++) {
    for (const filename of (await readdir(stateDirectory)).filter(name => /^mail-[a-f0-9-]{36}\.json$/.test(name))) {
      const mail = JSON.parse(await readFile(join(stateDirectory, filename), 'utf8'));
      if (mail.to === email) token = mail.text.match(/#token=([a-f0-9]{64})/)?.[1];
    }
    if (!token) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(token);
  assert.equal((await context.request.post(origin + '/api/account/confirm', {headers, data: {token}})).status(), 200);
  await page.goto(origin + '/auth');
  await page.getByLabel('Email', {exact: true}).fill(email);
  await page.getByLabel('Пароль', {exact: true}).fill(password);
  await page.getByRole('button', {name: 'Войти', exact: true}).click();
  await page.waitForURL(origin + '/');
  await page.goto(origin + '/cabinet');
  await page.getByRole('button', {name: 'Настройки', exact: true}).click();
  await page.evaluate(() => {
    const original = FileReader.prototype.readAsDataURL;
    window.__avatarPreparationProbe = {pending: false, finished: false, release: null};
    FileReader.prototype.readAsDataURL = function(file) {
      const probe = window.__avatarPreparationProbe;
      FileReader.prototype.readAsDataURL = original;
      probe.pending = true;
      this.addEventListener('loadend', () => { probe.finished = true; }, {once: true});
      probe.release = () => original.call(this, file);
    };
  });
  const png = await sharp({create: {width: 2400, height: 1600, channels: 3, background: '#3966b3'}}).png().toBuffer();
  await page.locator('input[type=file]').setInputFiles({name: 'slow-avatar.png', mimeType: 'image/png', buffer: png});
  await page.waitForFunction(() => window.__avatarPreparationProbe?.pending);
  let releaseSession, sessionStarted;
  const sessionGate = new Promise(resolve => { releaseSession = resolve; });
  const sessionPending = new Promise(resolve => { sessionStarted = resolve; });
  const holdSession = async route => { sessionStarted(); await sessionGate; await route.continue(); };
  await page.route('**/api/account/session', holdSession);
  const sessionResponse = page.waitForResponse(response => response.url() === origin + '/api/account/session');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await sessionPending;
  await page.waitForFunction(() => !document.querySelector('#cabinet-profile'));
  await page.evaluate(() => window.__avatarPreparationProbe.release());
  await page.waitForFunction(() => window.__avatarPreparationProbe.finished);
  // Wait for the actual image load task too, while the verified owner is unavailable.
  await page.waitForTimeout(200);
  const profileRead = page.waitForResponse(response => response.url() === origin + '/api/account/profile' && response.request().method() === 'POST');
  releaseSession();
  assert.equal((await sessionResponse).status(), 200);
  assert.equal((await profileRead).status(), 200);
  await page.unroute('**/api/account/session', holdSession);
  const modal = page.locator('dialog:modal');
  await modal.waitFor({timeout: 5000});
  assert.equal(await modal.getByRole('img', {name: 'Фото для аватарки', exact: true}).count(), 1,
    'A file finishing decode during recheck returns as the same owner crop after remount');
  const write = page.waitForResponse(response => response.url() === origin + '/api/account/profile' && response.request().method() === 'PUT');
  await modal.getByRole('button', {name: 'Применить', exact: true}).click();
  assert.equal((await write).status(), 200);
  await modal.waitFor({state: 'detached'});
  const orientedJpeg = await sharp({create: {width: 1200, height: 800, channels: 3, background: '#b34f39'}})
    .withMetadata({orientation: 6}).jpeg().toBuffer();
  assert.equal((await sharp(orientedJpeg).metadata()).orientation, 6, 'Fixture really carries EXIF orientation');
  const largePng = await sharp({create: {width: 4608, height: 3456, channels: 3, background: '#39854f'}}).png().toBuffer();
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640"><rect width="960" height="640" fill="#7039b3"/><circle cx="480" cy="320" r="160" fill="#ffca66"/></svg>');
  for (const fixture of [{name: 'avatar-vector.svg', mimeType: 'image/svg+xml', buffer: svg},
    {name: 'avatar-orientation-6.jpg', mimeType: 'image/jpeg', buffer: orientedJpeg},
    {name: 'avatar-large-4608x3456.png', mimeType: 'image/png', buffer: largePng}]) {
    await page.locator('input[type=file]').setInputFiles(fixture);
    await modal.waitFor();
    const image = modal.getByRole('img', {name: 'Фото для аватарки', exact: true});
    await image.evaluate(element => element.decode());
    assert.equal(await image.evaluate(element => element.naturalWidth > 0 && element.naturalHeight > 0), true);
    if (fixture.mimeType === 'image/jpeg') assert.equal(await image.evaluate(element => element.naturalHeight > element.naturalWidth), true,
      'Browser respects EXIF orientation before crop');
    const saved = page.waitForResponse(response => response.url() === origin + '/api/account/profile' && response.request().method() === 'PUT');
    await modal.getByRole('button', {name: 'Применить', exact: true}).click();
    const response = await saved;
    assert.equal(response.status(), 200, 'Supported avatar format saves through real profile API');
    const profile = await response.json();
    assert.ok(profile.profile.avatarDataUrl.startsWith('data:image/jpeg;base64,'), 'Only normalized JPEG is stored, never source SVG/EXIF');
    const metadata = await sharp(Buffer.from(profile.profile.avatarDataUrl.split(',')[1], 'base64')).metadata();
    assert.equal(metadata.width, 512); assert.equal(metadata.height, 512);
    assert.equal(metadata.orientation, undefined, 'Source orientation metadata is stripped from saved pixels');
    await modal.waitFor({state: 'detached'});
  }
  await page.locator('input[type=file]').setInputFiles({name: 'broken-avatar.png', mimeType: 'image/png', buffer: Buffer.from('not-an-image')});
  await page.getByRole('status').filter({hasText: 'Не удалось подготовить изображение.'}).waitFor();
  assert.equal(await modal.count(), 0, 'Broken images report a nearby error instead of opening a blank crop');
  assert.equal(await page.getByRole('button', {name: 'Настройки', exact: true}).count(), 1, 'A decode error does not remove the profile UI');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({status: 'passed', delayedFileRead: true, focusRecheck: true,
    selectionRetained: true, actualProfilePut: 200, svg: true, exifJpeg: true, largePng: true, invalidImageVisibleError: true,
    seedProfileTouched: false, productionTouched: false}));
} finally {
  await browser.close();
}
