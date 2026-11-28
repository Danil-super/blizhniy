import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';
import {createDefaultCabinetProfile} from '../src/lib/cabinet-profile.ts';

/** Owned browser transport fixtures only: no real account, SQL, email or payment request. */
export async function testCabinetCardBrowser({context, page, origin}) {
  const owner = '12345678-1234-4321-8765-123456789abc';
  const photoId = '42345678-1234-4321-8765-123456789abc';
  const secondPhoto = '52345678-1234-4321-8765-123456789abc';
  const states = ['draft', 'pending_payment', 'paid', 'published', 'sold', 'archived', 'expired', 'blocked'];
  const deadlines = {archived:'2026-11-25T21:00:00.000001Z',expired:'2026-11-24T21:00:00.000001Z'};
  const items = states.map((status, index) => ({id: `22345678-1234-4321-8765-123456789ab${index}`, revision: '2', kind: 'prodam',
    title: `Комод — ${status}`, price: '3500.00', card: {city: 'Сочи', district: 'Центральный', coverPhotoId: index === 0 ? photoId : null,
      status, blockReason: status === 'blocked' ? 'Фотография нарушает правила публикации.' : null,
      ...(deadlines[status]?{placement:{expiresAt:deadlines[status],active:status==='archived'}}:{})}}));
  const pixels = await sharp({create: {width: 480, height: 320, channels: 3, background: '#a05a2c'}}).webp().toBuffer();
  const errors = [], consoleErrors = [], writes = [], foreign = [];
  let holdSession = null, mediaReads = 0, listReads = 0;
  let enrolled = true;
  let addressReceipt = null;
  let publicationReceipt = null;
  let photoReceipt = null;
  let visibleTitle='До 😺 личное после';
  const textFingerprint='a'.repeat(64);
  const locationFingerprint='b'.repeat(64);
  let consentUntil=null;
  const contactFingerprint='c'.repeat(64);
  let phoneConsentUntil=null,phoneWithdrawnAt=null;
  const profileFingerprint='d'.repeat(64);
  let profileConsentUntil=null;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {if (message.type() === 'error') consoleErrors.push(message.text());});
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) {foreign.push(url.host); return route.abort();}
    if (!url.pathname.startsWith('/api/account/')) return route.continue();
    assert.equal(request.headers().authorization, undefined);
    if (url.pathname === '/api/account/session') {
      if (holdSession) await holdSession;
      return route.fulfill({headers: enrolled ? {'X-Blizhniy-Work-Publication-Test': '1'} : {},
        json: {user: {id: owner, email: 'cabinet-ui@example.invalid', role: 'user', isBlocked: false}}});
    }
    if (url.pathname === '/api/account/profile') return route.fulfill({json: {exists: false,
      profile: createDefaultCabinetProfile({name: 'Локальная проверка', email: 'cabinet-ui@example.invalid'}), revision: null}});
    if (url.pathname === '/api/account/listings') {
      listReads++;
      assert.equal(request.method(), 'POST'); assert.equal(request.postDataJSON().expectedOwnerId, owner);
      assert.equal(request.headers()['x-blizhniy-listing-placement'], '1');
      return route.fulfill({json: {items, nextCursor: null, workflow: 'postmoderation'}});
    }
    if (url.pathname === '/api/account/media/read') {
      assert.equal(request.method(), 'POST'); assert.equal(request.postDataJSON().expectedOwnerId, owner);
      if(request.postDataJSON().fileId===secondPhoto)return route.fulfill({contentType:'image/webp',body:pixels});
      assert.equal(request.postDataJSON().fileId, photoId); mediaReads++;
      return route.fulfill({contentType: 'image/webp', body: pixels});
    }
    if(url.pathname==='/api/account/publication-location'&&['texts','withdraw-text'].includes(request.postDataJSON().action)){
      const target={kind:'listing',publicationId:items[1].id,expectedOwnerId:owner};
      const {action}=request.postDataJSON();
      if(action==='withdraw-text'){
        assert.deepEqual(request.postDataJSON(),{...target,action,field:'title',fingerprint:textFingerprint,start:5,end:11});
        visibleTitle='До 😺 … после';
        return route.fulfill({json:{kind:target.kind,publicationId:target.publicationId,withdrawnAt:deadlines.archived}});
      }
      assert.deepEqual(request.postDataJSON(),{...target,action});
      return route.fulfill({json:{kind:target.kind,publicationId:target.publicationId,texts:[
        {field:'title',text:'До 😺 личное после',visible:visibleTitle,fingerprint:textFingerprint},
      ]}});
    }
    if(url.pathname==='/api/account/publication-location'&&request.postDataJSON().action==='withdraw-photo'){
      assert.equal(request.method(),'POST');
      assert.deepEqual(request.postDataJSON(),{kind:'listing',publicationId:items[1].id,expectedOwnerId:owner,action:'withdraw-photo',photoId:secondPhoto});
      photoReceipt=deadlines.archived;
      return route.fulfill({json:{kind:'listing',publicationId:items[1].id,photoId:secondPhoto,withdrawnAt:photoReceipt}});
    }
    if(url.pathname==='/api/account/publication-location'&&['location-consent-status','confirm-location-consent'].includes(request.postDataJSON().action)){
      const target={kind:'listing',publicationId:items[1].id,expectedOwnerId:owner};
      const {action}=request.postDataJSON();
      if(action==='confirm-location-consent'){
        assert.deepEqual(request.postDataJSON(),{...target,action,fingerprint:locationFingerprint,fullName:'Локальный Пользователь'});
        consentUntil='2027-01-25T21:00:00.000001Z';
      }else assert.deepEqual(request.postDataJSON(),{...target,action});
      return route.fulfill({json:{kind:target.kind,publicationId:target.publicationId,consent:{
        location:{city:'Сочи',address:'Стендовый адрес',latitude:43.1,longitude:39.2},
        notice:{version:'test',operator:'Оператор проверки',purpose:'Показ точки',resource:origin+'/obyavlenie/'+target.publicationId,
          term:'90 суток с момента подтверждения',statement:'Разрешаю публиковать указанные точный адрес и координаты.'},
        email:'cabinet-ui@example.invalid',fingerprint:locationFingerprint,expiresAt:consentUntil,
      }}});
    }
    if(url.pathname==='/api/account/publication-location'&&['contact-consent-status','confirm-contact-consent','withdraw-contact'].includes(request.postDataJSON().action)){
      const target={kind:'listing',publicationId:items[1].id,expectedOwnerId:owner,category:'phone'};
      const {action}=request.postDataJSON();
      assert.deepEqual(request.postDataJSON(),{...target,action,
        ...(action==='confirm-contact-consent'?{fingerprint:contactFingerprint,fullName:'Локальный Пользователь'}:{})});
      const response={kind:target.kind,publicationId:target.publicationId,category:target.category};
      if(action==='withdraw-contact'){
        phoneWithdrawnAt=deadlines.archived;
        return route.fulfill({json:{...response,withdrawnAt:phoneWithdrawnAt}});
      }
      if(phoneWithdrawnAt)return route.fulfill({json:{...response,consent:{contact:null,withdrawnAt:phoneWithdrawnAt}}});
      if(action==='confirm-contact-consent')phoneConsentUntil='2027-01-25T21:00:00.000001Z';
      return route.fulfill({json:{...response,consent:{
        contact:'+79990000000',
        notice:{version:'phone-test',operator:'Оператор проверки',purpose:'Показ номера',resource:origin+'/obyavlenie/'+target.publicationId,
          term:'90 суток с момента подтверждения',statement:'Разрешаю публиковать номер телефона.'},
        email:'cabinet-ui@example.invalid',fingerprint:contactFingerprint,expiresAt:phoneConsentUntil,
      }}});
    }
    if(url.pathname==='/api/account/publication-location'&&['profile-consent-status','confirm-profile-consent','withdraw-profile-value'].includes(request.postDataJSON().action)){
      const target={kind:'listing',publicationId:items[1].id,expectedOwnerId:owner,category:'name'};
      const {action}=request.postDataJSON();
      assert.deepEqual(request.postDataJSON(),{...target,action,
        ...(action==='confirm-profile-consent'?{fingerprint:profileFingerprint,fullName:'Локальный Пользователь'}:{})});
      const response={kind:target.kind,publicationId:target.publicationId,category:target.category};
      if(action==='withdraw-profile-value')return route.fulfill({json:{...response,withdrawnAt:deadlines.archived}});
      if(action==='confirm-profile-consent')profileConsentUntil='2027-01-25T21:00:00.000001Z';
      return route.fulfill({json:{...response,consent:{
        profileValue:'Имя из профиля',
        notice:{version:'name-test',operator:'Оператор проверки',purpose:'Показ имени',resource:origin+'/obyavlenie/'+target.publicationId,
          term:'90 суток с момента подтверждения',statement:'Разрешаю публиковать имя из профиля.'},
        email:'cabinet-ui@example.invalid',fingerprint:profileFingerprint,expiresAt:profileConsentUntil,
      }}});
    }
    if (url.pathname === '/api/account/publication-location') {
      const {action, ...target} = request.postDataJSON();
      assert.equal(request.method(), 'POST');
      assert.equal(request.headers()['x-blizhniy-request'], '1');
      assert.deepEqual(target, {kind:'listing', publicationId:items[1].id, expectedOwnerId:owner});
      if(action==='photos')return route.fulfill({json:{kind:'listing',publicationId:items[1].id,photos:[
        {id:photoId,withdrawnAt:null},{id:secondPhoto,withdrawnAt:photoReceipt},
      ]}});
      if(action==='withdraw-publication')publicationReceipt=deadlines.archived;
      if(action==='publication-status'||action==='withdraw-publication')
        return route.fulfill({json:{kind:'listing', publicationId:items[1].id, withdrawnAt:publicationReceipt,
          ...(action==='publication-status'&&!publicationReceipt?{contactConsent:true,profileConsent:true}:{})}});
      assert.ok(action === undefined || action === 'status');
      if (action === undefined) addressReceipt = deadlines.archived;
      return route.fulfill({json:{kind:'listing', publicationId:items[1].id, withdrawnAt:addressReceipt,
        ...(action==='status'?{locationConsent:true}:{})}});
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
  for (const status of ['archived','expired']) {
    const card = cards.locator('article').filter({has: page.getByRole('heading', {name: `Комод — ${status}`, exact: true})});
    assert.equal(await card.locator('time').getAttribute('datetime'), deadlines[status]);
    const actions = card.locator('summary').filter({hasText:'Действия'});
    await actions.click();
    assert.equal(await card.getByRole('button',{name:'Опубликовать снова',exact:true}).count(),status==='archived'?1:0);
    assert.equal(await card.getByRole('link',{name:'Продлить размещение',exact:true}).count(),0);
    await actions.click();
  }
  assert.ok(mediaReads >= 1);
  await cards.getByText('Фотография нарушает правила публикации.', {exact: false}).waitFor();
  const closedSizes=await cards.locator('article').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().height));
  await draft.getByRole('button', {name: 'Статус и оплата', exact: true}).focus();
  await page.keyboard.press('Space');
  await draft.getByRole('button', {name: 'Оплатить размещение', exact: true}).waitFor();
  assert.deepEqual(await cards.locator('article').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().height)),closedSizes,'opening payment details cannot increase any card height');
  await page.screenshot({path:'/tmp/blizhniy-focus-card-dialog-desktop.png'});
  assert.equal(await cards.getByText(/На модерации|Не отправлено на модерацию/).count(), 0);
  let release;
  holdSession = new Promise(resolve => {release = resolve;});
  const cardNode=await draft.elementHandle(),imageNode=await cards.getByRole('img',{name:'Комод — draft',exact:true}).elementHandle();
  const beforeReads={list:listReads,media:mediaReads},beforeSizes=await cards.locator('article').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().height));
  const checked=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/account/session');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));await checked;
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await cardNode.evaluate(node=>node.isConnected),true);
  assert.equal(await imageNode.evaluate(node=>node.isConnected),true);
  assert.equal(await page.getByRole('dialog').isVisible(),true);
  assert.deepEqual({list:listReads,media:mediaReads},beforeReads,'ordinary focus must not restart listing/photo loading');
  assert.deepEqual(await cards.locator('article').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().height)),beforeSizes);
  await page.evaluate(() => window.dispatchEvent(new Event('blizhniy-account-changed')));
  await page.getByText('Проверяем доступ к черновикам…', {exact: true}).waitFor();
  assert.equal(await page.getByRole('dialog').count(),0,'known auth invalidation hides the top-layer dialog immediately');
  release(); holdSession = null;
  await draft.getByRole('button', {name: 'Оплатить размещение', exact: true}).waitFor();
  await page.setViewportSize({width:320,height:900});
  assert.equal(await page.locator('body').evaluate(node=>node.scrollWidth>innerWidth),false);
  await page.addScriptTag({path:createRequire(import.meta.url).resolve('axe-core/axe.min.js')});
  assert.deepEqual(await page.getByRole('dialog').evaluate(async node=>(await window.axe.run(node)).violations.filter(item=>['serious','critical'].includes(item.impact)).map(item=>item.id)),[]);
  await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
  assert.equal(await draft.getByRole('button',{name:'Статус и оплата',exact:true}).evaluate(node=>node===document.activeElement),true,'Escape restores focus to the opener');
  await page.screenshot({path: '/tmp/blizhniy-local-cabinet-cards.png', fullPage: true});
  const axe = await readFile(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
  await page.addScriptTag({content: axe});
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({width, height: 900});
    assert.equal(await page.locator('body').evaluate(node => node.scrollWidth > innerWidth), false);
    assert.equal(await cards.locator('ul').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length), width >= 1440 ? 4 : width >= 1024 ? 3 : width >= 768 ? 2 : 1);
    const dimensions=await cards.locator('article').evaluateAll(nodes=>nodes.map(node=>({width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height})));
    assert.ok(dimensions.every(size=>Math.abs(size.width-dimensions[0].width)<=1));
    assert.ok(dimensions.every(size=>Math.abs(size.height-dimensions[0].height)<=1),'expanding payment details must not stretch the grid');
    const violations = await cards.evaluate(async element => (await window.axe.run(element)).violations
      .filter(item => ['serious', 'critical'].includes(item.impact)).map(item => ({id: item.id, nodes: item.nodes.map(node => node.target)})));
    assert.deepEqual(violations, []);
  }
  await page.screenshot({path: '/tmp/blizhniy-local-cabinet-cards.png', fullPage: true});
  enrolled = false;
  await page.reload();
  await draft.getByRole('button', {name: 'Статус и оплата', exact: true}).click();
  await draft.getByText('Оплата пока недоступна для этого аккаунта.', {exact: false}).waitFor();
  assert.equal(await draft.getByRole('button', {name: 'Оплатить размещение', exact: true}).count(), 0);
  await page.keyboard.press('Escape');
  const waiting=cards.locator('article').filter({has:page.getByRole('heading',{name:'Комод — pending_payment',exact:true})});
  const menu=waiting.locator('summary').filter({hasText:'Действия'});
  const address=page.getByRole('dialog',{name:'Публичный доступ',exact:true});
  await page.setViewportSize({width:320,height:900});
  await menu.click();
  await waiting.getByRole('button',{name:'Публичный доступ',exact:true}).click();
  await address.getByRole('button',{name:'Открыть согласие на публикацию точного адреса',exact:true}).click();
  await address.getByText('Сочи, Стендовый адрес. Координаты 43.1, 39.2.',{exact:true}).waitFor();
  const allowLocation=address.getByRole('button',{name:'Подтвердить согласие',exact:true});
  assert.equal(await allowLocation.isDisabled(),true);
  await address.getByRole('textbox',{name:'Фамилия, имя, отчество (при наличии)'}).fill('Локальный Пользователь');
  assert.equal(await allowLocation.isDisabled(),true);
  const locationCheckbox=address.getByRole('checkbox',{name:'Разрешаю публиковать указанные точный адрес и координаты.'});
  assert.equal(await locationCheckbox.isChecked(),false);
  await locationCheckbox.check();
  await allowLocation.click();
  await address.getByText('Согласие сохранено.',{exact:true}).waitFor();
  await address.getByText(/Согласие на публикацию адреса действует до/).waitFor();
  const phoneConsent=address.getByRole('region',{name:'Согласие на публикацию телефона'});
  await phoneConsent.getByRole('button',{name:'Открыть согласие на публикацию телефона'}).click();
  await phoneConsent.getByText('+79990000000',{exact:true}).waitFor();
  await phoneConsent.getByRole('textbox',{name:'Фамилия, имя, отчество (при наличии)'}).fill('Локальный Пользователь');
  const confirmPhone=phoneConsent.getByRole('button',{name:'Подтвердить согласие',exact:true});
  assert.equal(await confirmPhone.isDisabled(),true);
  await phoneConsent.getByRole('checkbox',{name:'Разрешаю публиковать номер телефона.'}).check();
  await confirmPhone.click();
  await phoneConsent.getByText(/Согласие на публикацию телефона действует до/).waitFor();
  await phoneConsent.getByRole('button',{name:'Отозвать согласие'}).click();
  await phoneConsent.getByRole('button',{name:'Подтвердить отзыв'}).click();
  await phoneConsent.getByText('Телефон скрыт.',{exact:true}).waitFor();
  await address.getByRole('button',{name:'Открыть согласие на публикацию мессенджера'}).waitFor();
  const nameConsent=address.getByRole('region',{name:'Согласие на публикацию имени'});
  await nameConsent.getByRole('button',{name:'Открыть согласие на публикацию имени'}).click();
  await nameConsent.getByText('Имя из профиля',{exact:true}).waitFor();
  await nameConsent.getByRole('textbox',{name:'Фамилия, имя, отчество (при наличии)'}).fill('Локальный Пользователь');
  const confirmName=nameConsent.getByRole('button',{name:'Подтвердить согласие',exact:true});
  assert.equal(await confirmName.isDisabled(),true);
  await nameConsent.getByRole('checkbox',{name:'Разрешаю публиковать имя из профиля.'}).check();
  await confirmName.click();
  await nameConsent.getByText(/Согласие на публикацию имени действует до/).waitFor();
  await nameConsent.getByRole('button',{name:'Отозвать согласие'}).click();
  await nameConsent.getByRole('button',{name:'Подтвердить отзыв'}).click();
  await nameConsent.getByText('Имя скрыто.',{exact:true}).waitFor();
  await address.getByRole('button',{name:'Скрыть точный адрес',exact:true}).click();
  await page.addScriptTag({path:createRequire(import.meta.url).resolve('axe-core/axe.min.js')});
  assert.deepEqual(await address.evaluate(async node=>(await window.axe.run(node)).violations.filter(item=>['serious','critical'].includes(item.impact)).map(item=>item.id)),[]);
  await address.getByRole('button',{name:'Подтвердить скрытие',exact:true}).click();
  await address.getByText('Точный адрес скрыт.',{exact:true}).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await menu.evaluate(node=>document.activeElement===node),true);
  await page.reload();
  await menu.click();
  await waiting.getByRole('button',{name:'Публичный доступ',exact:true}).click();
  await address.getByText('Точный адрес скрыт.',{exact:true}).waitFor();
  await phoneConsent.getByRole('button',{name:'Открыть согласие на публикацию телефона'}).click();
  await phoneConsent.getByText('Телефон скрыт.',{exact:true}).waitFor();
  const photoSection=address.locator('summary').filter({hasText:'Видимость фотографий'});
  await photoSection.click();
  const picker=address.getByLabel('Выберите фото');
  await picker.selectOption(secondPhoto);
  await address.getByRole('img',{name:'Выбранное фото'}).waitFor();
  await address.getByRole('button',{name:'Скрыть выбранное фото',exact:true}).click();
  await address.getByRole('button',{name:'Подтвердить скрытие фото',exact:true}).click();
  await address.getByText('Фото скрыто в этой публикации.',{exact:true}).waitFor();
  await photoSection.click();
  await photoSection.click();
  await picker.selectOption(secondPhoto);
  await address.getByText('Фото скрыто в этой публикации.',{exact:true}).waitFor();
  await picker.selectOption(photoId);
  await address.getByRole('button',{name:'Скрыть выбранное фото',exact:true}).waitFor();
  await address.locator('summary').filter({hasText:'Видимость текста'}).click();
  const text=address.getByRole('textbox',{name:/Исходный текст/});
  await text.focus();
  await text.evaluate(element=>element.setSelectionRange(6,12));
  await text.press('Shift');
  await address.getByRole('button',{name:'Скрыть выделенный фрагмент',exact:true}).click();
  await address.getByRole('button',{name:'Подтвердить скрытие фрагмента',exact:true}).click();
  await address.getByText('Фрагмент скрыт.',{exact:true}).waitFor();
  await address.getByText('До 😺 … после',{exact:true}).waitFor();
  await address.getByRole('button',{name:'Скрыть всю публикацию',exact:true}).click();
  await address.getByRole('button',{name:'Подтвердить скрытие публикации',exact:true}).click();
  await address.getByText('Публикация скрыта.',{exact:true}).waitFor();
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
