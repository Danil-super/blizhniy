import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';
import {createDefaultCabinetProfile} from '../src/lib/cabinet-profile.ts';

/** Owned browser transport fixtures only: no real account, SQL, email or payment request. */
export async function testCabinetCardBrowser({context, page, origin}) {
  const owner = '12345678-1234-4321-8765-123456789abc';
  const photoId = '42345678-1234-4321-8765-123456789abc';
  const states = ['draft', 'pending_payment', 'paid', 'published', 'sold', 'archived', 'expired', 'blocked'];
  const items = states.map((status, index) => ({id: `22345678-1234-4321-8765-123456789ab${index}`, revision: '2', kind: 'prodam',
    title: `Комод — ${status}`, price: '3500.00', card: {city: 'Сочи', district: 'Центральный', coverPhotoId: index === 0 ? photoId : null,
      status, blockReason: status === 'blocked' ? 'Фотография нарушает правила публикации.' : null}}));
  const pixels = await sharp({create: {width: 480, height: 320, channels: 3, background: '#a05a2c'}}).webp().toBuffer();
  const errors = [], consoleErrors = [], writes = [], foreign = [];
  let holdSession = null, mediaReads = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {if (message.type() === 'error') consoleErrors.push(message.text());});
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) {foreign.push(url.host); return route.abort();}
    if (!url.pathname.startsWith('/api/account/')) return route.continue();
    assert.equal(request.headers().authorization, undefined);
    if (url.pathname === '/api/account/session') {
      if (holdSession) await holdSession;
      return route.fulfill({json: {user: {id: owner, email: 'cabinet-ui@example.invalid', role: 'user', isBlocked: false}}});
    }
    if (url.pathname === '/api/account/profile') return route.fulfill({json: {exists: false,
      profile: createDefaultCabinetProfile({name: 'Локальная проверка', email: 'cabinet-ui@example.invalid'}), revision: null}});
    if (url.pathname === '/api/account/listings') {
      assert.equal(request.method(), 'POST'); assert.equal(request.postDataJSON().expectedOwnerId, owner);
      return route.fulfill({json: {items, nextCursor: null, workflow: 'postmoderation'}});
    }
    if (url.pathname === '/api/account/media/read') {
      assert.equal(request.method(), 'POST'); assert.equal(request.postDataJSON().expectedOwnerId, owner);
      assert.equal(request.postDataJSON().fileId, photoId); mediaReads++;
      return route.fulfill({contentType: 'image/webp', body: pixels});
    }
    writes.push(url.pathname);
    return route.fulfill({status: 404, json: {error: {code: 'NOT_FOUND'}}});
  });
  await page.goto(origin + '/cabinet/obyavleniya', {waitUntil: 'domcontentloaded'});
  const cards = page.getByRole('region', {name: 'Список моих объявлений', exact: true});
  await cards.getByRole('heading', {name: 'Мои объявления', exact: true}).waitFor();
  for (const text of ['Черновик', 'Ожидает оплату', 'Оплачено', 'Опубликовано', 'Продано', 'Архив', 'Истек срок', 'Заблокировано']) {
    await cards.getByText(text, {exact: true}).waitFor();
  }
  assert.equal(await cards.locator('article').count(), 8);
  const draft = cards.locator('article').filter({has: page.getByRole('heading', {name: 'Комод — draft', exact: true})});
  await draft.locator('summary').filter({hasText:'Действия'}).click();
  assert.equal(await cards.getByRole('link', {name: 'Редактировать', exact: true}).count(), 1);
  assert.equal(await cards.getByRole('link', {name: 'Редактировать', exact: true}).getAttribute('href'), `/razmestit/obyavlenie?draft=${items[0].id}`);
  await draft.locator('summary').filter({hasText:'Действия'}).click();
  await cards.getByRole('img', {name: 'Комод — draft', exact: true}).waitFor();
  assert.ok(mediaReads >= 1);
  await cards.getByText('Фотография нарушает правила публикации.', {exact: false}).waitFor();
  await draft.getByRole('button', {name: 'Статус и оплата', exact: true}).focus();
  await page.keyboard.press('Space');
  await draft.getByRole('button', {name: 'Оплатить размещение', exact: true}).waitFor();
  assert.equal(await cards.getByText(/На модерации|Не отправлено на модерацию/).count(), 0);
  let release;
  holdSession = new Promise(resolve => {release = resolve;});
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByText('Проверяем доступ к черновикам…', {exact: true}).waitFor();
  release(); holdSession = null;
  await draft.getByRole('button', {name: 'Оплатить размещение', exact: true}).waitFor();
  await page.screenshot({path: '/tmp/blizhniy-local-cabinet-cards.png', fullPage: true});
  const axe = await readFile(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
  await page.addScriptTag({content: axe});
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({width, height: 900});
    assert.equal(await page.locator('body').evaluate(node => node.scrollWidth > innerWidth), false);
    assert.equal(await cards.locator(':scope > ul').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length), width >= 1440 ? 4 : width >= 1024 ? 3 : width >= 768 ? 2 : 1);
    const dimensions=await cards.locator('article').evaluateAll(nodes=>nodes.map(node=>({width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height})));
    assert.ok(dimensions.every(size=>Math.abs(size.width-dimensions[0].width)<=1));
    const violations = await cards.evaluate(async element => (await window.axe.run(element)).violations
      .filter(item => ['serious', 'critical'].includes(item.impact)).map(item => ({id: item.id, nodes: item.nodes.map(node => node.target)})));
    assert.deepEqual(violations, []);
  }
  await page.screenshot({path: '/tmp/blizhniy-local-cabinet-cards.png', fullPage: true});
  assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(foreign, []); assert.deepEqual(writes, []);
}

/** Slow read-only transport proves a whole page never overloads private media. */
export async function testCabinetThumbnailConcurrency({context, page, origin}) {
  const owner='12345678-1234-4321-8765-123456789abc';
  const items=Array.from({length:20},(_,index)=>({id:`22345678-1234-4321-8765-${String(index).padStart(12,'0')}`,revision:'1',kind:'prodam',title:`Фото ${index}`,price:'100.00',card:{city:'Сочи',district:null,coverPhotoId:`42345678-1234-4321-8765-${String(index).padStart(12,'0')}`,status:'draft',blockReason:null}}));
  const pixels=await sharp({create:{width:80,height:80,channels:3,background:'#688cb0'}}).webp().toBuffer();
  let active=0,peak=0,reads=0;
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!==origin)return route.abort();
    if(!url.pathname.startsWith('/api/account/'))return route.continue();
    if(url.pathname==='/api/account/session')return route.fulfill({json:{user:{id:owner,email:'images@local.invalid',role:'user',isBlocked:false}}});
    if(url.pathname==='/api/account/profile')return route.fulfill({json:{exists:false,profile:createDefaultCabinetProfile({name:'Проверка фото',email:'images@local.invalid'}),revision:null}});
    if(url.pathname==='/api/account/listings')return route.fulfill({json:{items,nextCursor:null,workflow:'postmoderation'}});
    if(url.pathname==='/api/account/media/read'){
      active++;reads++;peak=Math.max(peak,active);
      await new Promise(resolve=>setTimeout(resolve,50));
      active--;return route.fulfill({contentType:'image/webp',body:pixels});
    }
    return route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});
  });
  await page.goto(origin+'/cabinet/obyavleniya');
  await page.getByRole('img',{name:'Фото 19',exact:true}).waitFor();
  assert.equal(await page.locator('article img').count(),20);
  assert.equal(reads,20);assert.equal(peak,3);
  assert.equal(await page.getByText('Фото недоступно',{exact:true}).count(),0);
}
