// Real built placement form; only provider/SQL transports are owned synthetic fixtures.
import assert from 'node:assert/strict';import {test} from 'node:test';import {spawn} from 'node:child_process';
import {once} from 'node:events';import {createServer} from 'node:net';import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {rootCertificates} from 'node:tls';import {randomBytes} from 'node:crypto';
import {chromium} from 'playwright';import sharp from 'sharp';
import {parseListingFormDraft} from '../src/lib/listing-form-contract.ts';
import {createDefaultCabinetProfile} from '../src/lib/cabinet-profile.ts';
import {testAccountCheckoutBrowser} from './account-test-checkout-browser-cases.mjs';
test('ordinary placement form saves all existing fields/photos with cookie API and preserves input through account rechecks', {timeout:90000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'blizhniy-form-browser-'));let app,browser;
 try{
  const key=join(directory,'key'),ca=join(directory,'ca');await writeFile(key,randomBytes(32),{mode:0o600});await writeFile(ca,rootCertificates[0],{mode:0o600});
  const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const origin=`http://127.0.0.1:${port}`,owner='12345678-1234-4321-8765-123456789abc',id='22345678-1234-4321-8765-123456789abc';
  const fixture=join(directory,'draft.json');await writeFile(fixture,JSON.stringify({owner,active:owner,snapshot:null}),{mode:0o600});
  const env={PATH:process.env.PATH,LANG:'C.UTF-8',NODE_ENV:'production',__NEXT_PROCESSED_ENV:'true',NEXT_TELEMETRY_DISABLED:'1',BLIZHNIY_AUTH_MODE:'postgres',
   BLIZHNIY_AUTH_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai',BLIZHNIY_LISTING_PAYMENT:'account-test',BLIZHNIY_LISTING_CONTACT_METHOD:'enabled',BLIZHNIY_BROWSER_DRAFT_FIXTURE:fixture,BLIZHNIY_DB_HOST:'17e86f80f26733d39ef4b84d.twc1.net',BLIZHNIY_DB_PORT:'5432',BLIZHNIY_DB_NAME:'blizhniy_prod',BLIZHNIY_DB_USER:'blizhniy_runtime',
   BLIZHNIY_DB_PASSWORD:'synthetic-ui-db-password',BLIZHNIY_DB_SSL_MODE:'verify-full',BLIZHNIY_DB_CA_FILE:ca,BLIZHNIY_AUTH_MAIL_KEY_FILE:key,BLIZHNIY_AUTH_RATE_SECRET:'synthetic-ui-only-rate-secret-not-used-by-api',
   BLIZHNIY_MAIL_MODE:'timeweb',BLIZHNIY_SMTP_USER:'notifications@ближний-ру.рф',BLIZHNIY_SMTP_PASSWORD:'synthetic-ui-smtp-password',TURNSTILE_SECRET_KEY:'synthetic-ui-captcha-secret',NEXT_PUBLIC_TURNSTILE_SITE_KEY:''};
  let output='';app=spawn(process.execPath,['--experimental-strip-types','--require','./tests/listing-edit-browser-pg.cjs','node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{env,detached:true,stdio:['ignore','pipe','pipe']});
  app.stdout.on('data',chunk=>{output=(output+chunk).slice(-16000);});app.stderr.on('data',chunk=>{output=(output+chunk).slice(-16000);});
  const deadline=Date.now()+20000;for(;;){assert.equal(app.exitCode,null);try{if((await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)})).ok)break;}
   catch(error){assert.ok(error.cause?.code==='ECONNREFUSED'||error.name==='TimeoutError');}assert.ok(Date.now()<deadline,'owned app starts');await new Promise(resolve=>setTimeout(resolve,100));}
  browser=await chromium.launch({headless:true});const context=await browser.newContext(),page=await context.newPage(),errors=[],foreign=[],writes=[],intents=[];
  await context.addCookies([{name:'__Host-blizhniy_session',value:'a'.repeat(64),url:origin.replace('http:','https:')+'/',secure:true,httpOnly:true,sameSite:'Lax'}]);
  page.setDefaultTimeout(12000);page.on('pageerror',()=>errors.push('pageerror'));let saved=null,lose=false,sessionGate=null,active=owner,creates=0,rejectWrite=false;
  const persist=()=>writeFile(fixture,JSON.stringify({owner,active,snapshot:saved}),{mode:0o600});
  let moderation={id:null,revision:null,state:'not_submitted',note:null},loseSubmission=false,submissions=0;
  const pixels=await sharp({create:{width:80,height:40,channels:3,background:'red'}}).png().toBuffer();
  const webPixels=await sharp(pixels).webp().toBuffer();
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());if(['http:','https:'].includes(url.protocol)&&url.origin!==origin){foreign.push(url.host);return route.abort();}
   if(!url.pathname.startsWith('/api/account/'))return route.continue();
   assert.equal(request.headers().authorization,undefined);
   if(url.pathname.endsWith('/session')){if(sessionGate)await sessionGate;return route.fulfill({json:{user:{id:active,email:'fixture@example.invalid',role:'user',isBlocked:false}}});}
   if(url.pathname==='/api/account/media'){const mediaId=request.headers()['x-blizhniy-intent'];intents.push(mediaId);return route.fulfill({json:{id:mediaId,mimeType:'image/webp',width:80,height:40,size:12}});}
   if(url.pathname==='/api/account/profile'){assert.equal(request.postDataJSON().expectedOwnerId,active);assert.equal(request.method(),'POST');return route.fulfill({json:{exists:false,profile:createDefaultCabinetProfile({name:'Технический',email:'fixture@example.invalid'}),revision:null}});}
   if(active!==owner){assert.equal(request.postDataJSON().expectedOwnerId,active);assert.equal(request.method(),'POST');assert.ok(url.pathname.endsWith('/collection'));return route.fulfill({json:{items:[],nextCursor:null}});}
   const body=request.postDataJSON();assert.equal(body.expectedOwnerId,owner);
   if(url.pathname==='/api/account/listing-moderation'){
    assert.deepEqual(Object.keys(body).sort(),['expectedOwnerId','expectedRevision','listingId']);assert.equal(body.expectedRevision,saved.revision);
    if(request.method()==='PUT'){submissions++;moderation={id:'42345678-1234-4321-8765-123456789abc',revision:saved.revision,state:'pending',note:null};if(loseSubmission){loseSubmission=false;return route.abort();}}
    return route.fulfill({json:moderation.revision&&moderation.revision!==saved.revision?{...moderation,state:'outdated'}:moderation});
   }
   if(url.pathname.endsWith('/collection')){
    if(request.method()==='POST')return route.fulfill({json:{items:saved?[{id,revision:saved.revision,kind:saved.form.kind,title:saved.form.title,price:saved.form.price}]:[],nextCursor:null}});
    creates++;saved={id,revision:'1',form:parseListingFormDraft({kind:'prodam'}),photos:[]};await persist();
    return route.fulfill({json:{id,revision:'1',draft:{kind:'prodam',title:'',description:'',price:null,categoryId:null,cityId:null}}});
   }
   if(url.pathname==='/api/account/listing-drafts')return route.fulfill({json:{id,revision:saved.revision,draft:{kind:saved.form.kind,title:saved.form.title,description:saved.form.description,price:saved.form.price,categoryId:null,cityId:null}}});
   if(url.pathname==='/api/account/listing-photos')return route.fulfill({json:{id,revision:saved.revision,photos:saved.photos}});
   if(url.pathname==='/api/account/media/read')return route.fulfill({contentType:'image/webp',body:webPixels});
   if(url.pathname==='/api/account/listing-form'){
    if(request.method()==='POST')return route.fulfill({json:saved});
    writes.push(body);if(rejectWrite){rejectWrite=false;return route.fulfill({status:422,json:{error:{code:'INVALID_INPUT'}}});}
    if(saved&&body.expectedRevision!==saved.revision)return route.fulfill({status:409,json:{error:{code:'DRAFT_CHANGED'}}});
    saved={id,revision:String(BigInt(saved?.revision??'1')+1n),form:parseListingFormDraft(body.form),photos:body.form.photoIds.map(id=>({id,mimeType:'image/webp',width:80,height:40,size:12}))};
    await persist();if(lose){lose=false;return route.abort();}return route.fulfill({json:saved});
   }
   return route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});
  });
  const response=await page.goto(origin+'/razmestit/obyavlenie',{waitUntil:'domcontentloaded'});assert.equal(response.status(),200,output);
  await page.getByRole('heading',{name:'Создать объявление',exact:true}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'Создать объявление',exact:true}).count(),1);
  await page.locator('input[name="title"]').fill('Полная форма');await page.locator('textarea[name="description"]').fill('Не потерять описание');await page.locator('input[name="price"]').fill('1234');
  await page.getByRole('button',{name:'Выбрать',exact:true}).click();await page.getByRole('option',{name:'Краснодар, Краснодарский край',exact:true}).click();
  await page.locator('input[name="phone"]').fill('+79990000000');await page.locator('input[name="messengerUrl"]').fill('@example_user');
  await page.locator('input[name="photos"]').setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:pixels});
  let release;sessionGate=new Promise(resolve=>{release=resolve;});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.getByText('Проверяем вход. Заполненная форма скрыта до подтверждения аккаунта.',{exact:true}).waitFor();
  assert.equal(await page.locator('input[name="title"]').isVisible(),false);release();sessionGate=null;
  await page.locator('input[name="title"]').waitFor();assert.equal(await page.locator('input[name="title"]').inputValue(),'Полная форма');
  assert.equal(await page.locator('input[name="photos"]').evaluate(input=>input.files.length),1);
  await page.locator('input[name="placementRightsAccepted"]').check();lose=true;
  await page.getByRole('button',{name:'Сохранить черновик',exact:true}).click();
  await page.getByRole('button',{name:'Проверить сохранённую форму',exact:true}).waitFor();assert.equal(writes.length,1);assert.equal(intents.length,1);
  assert.equal(writes[0].form.title,'Полная форма');assert.equal(writes[0].form.cityName,'Краснодар');assert.equal(writes[0].form.price,'1234.00');assert.equal(writes[0].form.contactPhone,'+7-(999)-000-00-00');
  assert.ok(writes[0].form.subcategoryName);assert.equal(writes[0].form.messengerUrl,'https://t.me/example_user');assert.equal(writes[0].form.photoIds.length,1);
  // Keep the test on the form so all source fields and error-state layout remain inspectable.
  for(const width of [320,768,1024,1440]){await page.setViewportSize({width,height:900});assert.equal(await page.locator('body').evaluate(node=>node.scrollWidth>innerWidth),false);}
  await page.screenshot({path:'/tmp/blizhniy-full-form-browser.png',fullPage:true});
  await page.getByRole('button',{name:'Проверить сохранённую форму',exact:true}).click();await page.waitForURL(origin+'/cabinet/obyavleniya');
  assert.equal(writes.length,1);assert.equal(intents.length,1);assert.deepEqual(errors,[]);assert.deepEqual(foreign,[]);
  // The cabinet offers cards and status only: editing always reopens the original complete form.
  const firstCard=page.getByRole('link',{name:'Полная форма',exact:true}).locator('xpath=ancestor::li[1]');
  await firstCard.getByRole('button',{name:'Статус и оплата',exact:true}).click();
  await page.getByText('Не отправлено на модерацию',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Отправить на модерацию',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Изменить дополнительные поля',exact:true}).count(),0);
  const firstPhoto=saved.form.photoIds[0];
  saved={...saved,form:parseListingFormDraft({...saved.form,kind:'arenda',price:'199.99',categorySlug:'otdyh',subcategoryName:'Турбазы',cityName:'Сочи',district:'Мой район',
   address:'Улица 1',latitude:43.6,longitude:39.7,showExactAddress:false,contactMethod:'messenger',booking:{mode:'stay',priceWeekday:1250.5,extraGuestPrice:0,
    availableFrom:'2026-01-01',availableTo:'2026-01-03',blockedDates:['2026-01-02'],rules:'Без шума'}})};await persist();
  const editHref=await firstCard.getByRole('link',{name:'Редактировать',exact:true}).getAttribute('href');assert.equal(editHref,`/razmestit/obyavlenie?draft=${id}`);
  const editResponse=await page.goto(origin+editHref);assert.equal(editResponse.status(),200);
  assert.match(editResponse.headers()['cache-control']??'',/no-store|private/);
  const editHtml=await editResponse.text();
  for(const secret of [env.BLIZHNIY_DB_PASSWORD,env.BLIZHNIY_SMTP_PASSWORD,env.BLIZHNIY_AUTH_RATE_SECRET,'a'.repeat(64)])assert.equal(editHtml.includes(secret),false);
  assert.equal(new URL(page.url()).searchParams.has('owner'),false);assert.equal(new URL(page.url()).searchParams.has('token'),false);
  await page.getByRole('heading',{name:'Редактировать объявление',exact:true}).waitFor();
  assert.equal(await page.getByRole('region',{name:'Оплата объявления',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Оплатить размещение',exact:true}).count(),0);
  assert.equal(await page.locator('input[name="title"]').inputValue(),'Полная форма');
  assert.equal(await page.locator('input[name="price"]').inputValue(),'199.99');
  assert.equal(await page.locator('textarea[name="description"]').inputValue(),'Не потерять описание');
  assert.equal(await page.locator('input[name="contactMethod"]').inputValue(),'messenger');
  assert.equal(await page.locator('input[name="district"]').inputValue(),'Мой район');
  assert.equal(await page.locator('input[name="address"]').inputValue(),'Улица 1');
  assert.equal(await page.locator('input[name="location"]').inputValue(),'Сочи, Краснодарский край');
  assert.equal(await page.locator('input[name="bookingExtraGuestPrice"]').inputValue(),'0');
  assert.equal(await page.locator('input[name="bookingAvailableFrom"]').inputValue(),'2026-01-01');
  await page.locator('textarea[name="bookingIncluded"]').focus();await page.keyboard.press('Tab');assert.equal(await page.locator('textarea[name="bookingRules"]').evaluate(input=>document.activeElement===input),true);
  await page.getByRole('img',{name:'Сохранённая фотография 1 из 1',exact:true}).waitFor();assert.equal(await page.getByRole('img',{name:'Сохранённая фотография 1 из 1',exact:true}).count(),1);
  await page.locator('input[name="phone"]').fill('+79991112233');
  await page.locator('input[name="photos"]').setInputFiles({name:'second.png',mimeType:'image/png',buffer:pixels});
  sessionGate=new Promise(resolve=>{release=resolve;});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.getByText('Проверяем вход. Заполненная форма скрыта до подтверждения аккаунта.',{exact:true}).waitFor();
  assert.equal(await page.locator('input[name="phone"]').isVisible(),false);
  release();sessionGate=null;await page.locator('input[name="phone"]').waitFor();
  assert.equal((await page.locator('input[name="phone"]').inputValue()).replace(/\D/g,''),'79991112233');
  assert.equal(await page.locator('input[name="photos"]').evaluate(input=>input.files.length),1);
  await page.locator('input[name="placementRightsAccepted"]').check();
  await page.locator('input[name="lat"]').evaluate(input=>{input.value='invalid';});
  await page.getByRole('button',{name:'Сохранить черновик',exact:true}).click();
  await page.locator('form.listing-create-form').getByRole('alert').waitFor();assert.equal(writes.length,1);
  await page.locator('input[name="lat"]').evaluate(input=>{input.value='43.6';});
  rejectWrite=true;await page.getByRole('button',{name:'Сохранить черновик',exact:true}).click();
  await page.getByRole('button',{name:'Вернуться к исправлению полей',exact:true}).click();
  await page.getByText('Поля доступны для исправления. Изменения ещё не сохранены.',{exact:true}).waitFor();
  assert.equal(await page.locator('input[name="title"]').isDisabled(),false);assert.equal(writes.length,2);assert.equal(intents.length,2);
  await page.locator('input[name="title"]').fill('Исправленное объявление');lose=true;
  await page.getByRole('button',{name:'Сохранить черновик',exact:true}).click();
  await page.getByRole('button',{name:'Проверить сохранённую форму',exact:true}).click();await page.waitForURL(origin+'/cabinet/obyavleniya');
  assert.equal(writes.length,3);assert.equal(creates,1);assert.equal(intents.length,2);
  assert.equal(saved.form.cityName,'Сочи');assert.equal(saved.form.booking.priceWeekday,1250.5);assert.equal(saved.form.booking.extraGuestPrice,0);
  assert.equal(saved.form.booking.availableFrom,'2026-01-01');assert.deepEqual(saved.form.booking.blockedDates,['2026-01-02']);
  assert.equal(saved.form.price,'199.99');assert.equal(saved.form.contactMethod,'messenger');assert.equal(saved.form.district,'Мой район');
  assert.equal(saved.form.address,'Улица 1');assert.equal(saved.form.latitude,43.6);assert.equal(saved.form.longitude,39.7);assert.equal(saved.form.showExactAddress,false);
  assert.equal(saved.form.title,'Исправленное объявление');assert.equal(saved.form.photoIds.length,2);assert.equal(saved.form.photoIds[0],firstPhoto);
  await page.getByRole('link',{name:'Исправленное объявление',exact:true}).click();
  await page.locator('input[name="title"]').fill('Моя полная правка');await page.locator('input[name="placementRightsAccepted"]').check();
  saved={...saved,revision:'9007199254740993',form:{...saved.form,title:'Другая вкладка',district:'Серверный район',photoIds:[]},photos:[]};await persist();
  await page.getByRole('button',{name:'Сохранить черновик',exact:true}).click();
  await page.getByRole('button',{name:'Проверить сохранённую форму',exact:true}).click();
  await page.getByRole('region',{name:'Сохранённая форма',exact:true}).getByText(/Серверный район/).waitFor();
  assert.equal(saved.form.title,'Другая вкладка');assert.equal(saved.form.district,'Серверный район');assert.deepEqual(saved.form.photoIds,[]);assert.equal(writes.length,4);
  const axe=await readFile(createRequire(import.meta.url).resolve('axe-core/axe.min.js'),'utf8');await page.addScriptTag({content:axe});
  for(const width of [320,768,1024,1440]){await page.setViewportSize({width,height:900});assert.equal(await page.locator('body').evaluate(node=>node.scrollWidth>innerWidth),false);
   const violations=await page.evaluate(async()=>{const result=await window.axe.run(document.querySelector('form'));return result.violations.filter(item=>['serious','critical'].includes(item.impact)).map(item=>({id:item.id,nodes:item.nodes.map(node=>({target:node.target,failureSummary:node.failureSummary}))}));});
   assert.deepEqual(violations,[]);
  }
  await page.getByRole('button',{name:'Сохранить мою исходную форму вместо показанной',exact:true}).focus();await page.keyboard.press('Space');
  await page.waitForURL(origin+'/cabinet/obyavleniya');
  assert.equal(saved.form.title,'Моя полная правка');assert.equal(saved.form.district,'Мой район');assert.equal(saved.form.photoIds.length,2);
  assert.equal(writes.at(-1).expectedRevision,'9007199254740993');assert.equal(creates,1);
  await page.getByRole('link',{name:'Моя полная правка',exact:true}).click();
  await page.getByRole('heading',{name:'Редактировать объявление',exact:true}).waitFor();
  assert.equal(await page.locator('input[name="kind"]').inputValue(),'arenda');
  await page.locator('.listing-kind-field').getByRole('button').click();await page.getByRole('option',{name:'Продам',exact:true}).click();
  assert.equal(await page.locator('input[name="price"]').inputValue(),'199.99');await page.locator('input[name="price"]').fill('1234.50');
  await page.locator('input[name="placementRightsAccepted"]').check();loseSubmission=true;
  await page.getByRole('button',{name:'Отправить на модерацию',exact:true}).click();
  await page.getByRole('button',{name:'Проверить отправку',exact:true}).waitFor();
  assert.equal(submissions,1);assert.equal(saved.form.price,'1234.50');assert.equal(await page.getByRole('button',{name:'Отправить на модерацию',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Проверить отправку',exact:true}).focus();await page.keyboard.press('Space');await page.waitForURL(origin+'/cabinet/obyavleniya');
  const moderatedCard=page.getByRole('link',{name:'Моя полная правка',exact:true}).locator('xpath=ancestor::li[1]');
  await moderatedCard.getByRole('button',{name:'Статус и оплата',exact:true}).click();
  await page.getByText('На модерации',{exact:true}).waitFor();assert.equal(submissions,1);
  moderation={...moderation,state:'approved'};await page.getByRole('button',{name:'Обновить статус модерации',exact:true}).click();
  await page.getByText('Одобрено модератором',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Оплатить',exact:true}).count(),0);
  await page.addScriptTag({content:axe});
  for(const width of [320,768,1024,1440]){await page.setViewportSize({width,height:900});assert.equal(await page.locator('body').evaluate(node=>node.scrollWidth>innerWidth),false);
   const violations=await page.evaluate(async()=>{const result=await window.axe.run(document.querySelector('section[aria-label="Модерация объявления"]'));return result.violations.filter(item=>['serious','critical'].includes(item.impact)).map(item=>item.id);});assert.deepEqual(violations,[]);
  }
  await page.getByRole('button',{name:'Обновить статус модерации',exact:true}).focus();await page.keyboard.press('Space');
  await page.getByText('Одобрено модератором',{exact:true}).waitFor();assert.equal(submissions,1);
  await page.getByRole('region',{name:'Модерация объявления',exact:true}).screenshot({path:'/tmp/blizhniy-moderation-owner-browser.png'});
  assert.equal(await page.getByText('Не удалось загрузить профиль. Проверьте сессию и обновите данные.',{exact:true}).count(),0);
  await moderatedCard.getByRole('link',{name:'Редактировать',exact:true}).click();
  await page.locator('input[name="title"]').fill('Буфер обзора');
  sessionGate=new Promise(resolve=>{release=resolve;});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.getByText('Проверяем вход. Заполненная форма скрыта до подтверждения аккаунта.',{exact:true}).waitFor();assert.equal(await page.locator('input[name="title"]').isVisible(),false);
  release();sessionGate=null;await page.locator('input[name="title"]').waitFor();assert.equal(await page.locator('input[name="title"]').inputValue(),'Буфер обзора');
  active='32345678-1234-4321-8765-123456789abc';await persist();await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.getByText('Аккаунт изменился. Откройте своё объявление из личного кабинета.',{exact:true}).waitFor();
  assert.equal(await page.locator('input[name="title"]').count(),0);assert.equal(await page.getByText('Буфер обзора',{exact:true}).count(),0);
  const foreignDraft=await page.goto(origin+`/razmestit/obyavlenie?draft=${id}`);assert.equal(foreignDraft.status(),404);
  assert.equal((await foreignDraft.text()).includes('Моя полная правка'),false);assert.equal(await page.locator('input[name="title"]').count(),0);
  await page.goto(origin+'/cabinet/obyavleniya');await page.getByText('Вы ещё не создали объявлений.',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);assert.deepEqual(foreign,[]);
  active=owner;await persist();await page.goto(origin+'/razmestit/obyavlenie');await page.locator('input[name="title"]').fill('Буфер предыдущего владельца');
  active='32345678-1234-4321-8765-123456789abc';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(()=>document.querySelector('input[name="title"]')?.value==='');
  assert.equal(await page.locator('input[name="photos"]').evaluate(input=>input.files.length),0);
  assert.equal(await page.getByText('Буфер предыдущего владельца',{exact:true}).count(),0);
  // Initial placement goes to moderation, never to the retired checkout action.
  active=owner;saved=null;moderation={id:null,revision:null,state:'not_submitted',note:null};
  const beforeInitialWrites=writes.length,beforeInitialSubmissions=submissions;
  await page.goto(origin+'/razmestit/obyavlenie');
  assert.equal(await page.getByRole('button',{name:'Создать и оплатить',exact:true}).count(),0);
  await page.locator('input[name="placementRightsAccepted"]').check();
  await page.getByRole('button',{name:'Отправить на модерацию',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Название для публикации'}).waitFor();
  assert.equal(writes.length,beforeInitialWrites);assert.equal(submissions,beforeInitialSubmissions);
  await page.locator('input[name="title"]').fill('Сразу на модерацию');
  await page.locator('textarea[name="description"]').fill('Описание для модератора');
  await page.getByRole('button',{name:'Выбрать',exact:true}).click();
  await page.getByRole('option',{name:'Краснодар, Краснодарский край',exact:true}).click();
  await page.locator('input[name="phone"]').fill('+79990000000');
  loseSubmission=true;
  await page.getByRole('button',{name:'Отправить на модерацию',exact:true}).click();
  await page.getByRole('button',{name:'Проверить отправку',exact:true}).waitFor();
  assert.equal(writes.length,beforeInitialWrites+1);assert.equal(submissions,beforeInitialSubmissions+1);
  const focusedSession=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/account/session');
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await focusedSession;
  await page.getByRole('button',{name:'Проверить отправку',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Сохранить черновик',exact:true}).isDisabled(),true);
  assert.equal(await page.locator('input[name="title"]').isDisabled(),true);
  await page.addScriptTag({path:createRequire(import.meta.url).resolve('axe-core/axe.min.js')});
  for(const width of [320,768,1024,1440]){
   await page.setViewportSize({width,height:900});
   assert.equal(await page.locator('body').evaluate(node=>node.scrollWidth>innerWidth),false);
   assert.deepEqual(await page.evaluate(async()=>{const result=await window.axe.run(document.querySelector('form'));return result.violations.filter(row=>['serious','critical'].includes(row.impact)).map(row=>({id:row.id,targets:row.nodes.map(node=>node.target)}));}),[]);
   if(width===320){await page.getByRole('button',{name:'Проверить отправку',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/blizhniy-initial-moderation-320.png'});}
  }
  await page.getByRole('button',{name:'Проверить отправку',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:'/tmp/blizhniy-initial-moderation-unknown.png'});
  await page.getByRole('button',{name:'Проверить отправку',exact:true}).focus();await page.keyboard.press('Space');
  await page.waitForURL(origin+'/cabinet/obyavleniya');
  await page.getByRole('link',{name:'Сразу на модерацию',exact:true}).locator('xpath=ancestor::li[1]').getByRole('button',{name:'Статус и оплата',exact:true}).click();
  await page.getByText('На модерации',{exact:true}).waitFor();
  assert.equal(writes.length,beforeInitialWrites+1);assert.equal(submissions,beforeInitialSubmissions+1);
  // A readback of a lost form save never implicitly submits it for moderation.
  saved=null;moderation={id:null,revision:null,state:'not_submitted',note:null};lose=true;
  await page.goto(origin+'/razmestit/obyavlenie');
  await page.locator('input[name="title"]').fill('Проверка сохранения перед отправкой');
  await page.locator('textarea[name="description"]').fill('Форма сохраняется без дубликатов');
  await page.getByRole('button',{name:'Выбрать',exact:true}).click();
  await page.getByRole('option',{name:'Краснодар, Краснодарский край',exact:true}).click();
  await page.locator('input[name="phone"]').fill('+79990000000');
  await page.locator('input[name="placementRightsAccepted"]').check();
  await page.getByRole('button',{name:'Отправить на модерацию',exact:true}).click();
  await page.getByRole('button',{name:'Проверить сохранённую форму',exact:true}).click();
  await page.getByText('Форма сохранена. Нажмите «Отправить на модерацию», чтобы продолжить.',{exact:true}).waitFor();
  assert.equal(submissions,beforeInitialSubmissions+1);assert.equal(writes.length,beforeInitialWrites+2);
  await page.getByRole('button',{name:'Отправить на модерацию',exact:true}).click();
  await page.waitForURL(origin+'/cabinet/obyavleniya');
  assert.equal(submissions,beforeInitialSubmissions+2);assert.equal(writes.length,beforeInitialWrites+2);
  assert.deepEqual(errors,[]);assert.deepEqual(foreign,[]);
  moderation={...moderation,state:'approved'};
  await testAccountCheckoutBrowser({context,page,origin,owner,id,revision:saved.revision,title:saved.form.title});
  assert.deepEqual(errors,[]);assert.deepEqual(foreign,[]);
 }finally{await browser?.close();if(app&&app.exitCode===null){process.kill(-app.pid,'SIGTERM');await once(app,'exit');}await rm(directory,{recursive:true});}
});
