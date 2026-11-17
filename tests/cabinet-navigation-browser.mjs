// Built owned loopback UI; controlled account reads/logout, no real sessions or database writes.
import assert from'node:assert/strict';import{test}from'node:test';import{chromium}from'playwright';
import{stateFile,docker}from'../scripts/local-primary-fixture.mjs';
import{readLocalPrimaryState,validateLocalPrimaryContainer}from'../scripts/local-primary-config.mjs';
import{createDefaultCabinetProfile}from'../src/lib/cabinet-profile.ts';
test('cabinet opens listings, keeps settings links and places create/logout around the section navigation',{timeout:45000},async()=>{
 const state=readLocalPrimaryState(stateFile,process.cwd());validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);assert.equal(state.origin,'https://127.0.0.1:3045');
 const owner='12345678-1234-4321-8765-123456789abc',browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',viewport:{width:1440,height:1000}}),page=await context.newPage();page.setDefaultTimeout(8000);
  const errors=[],foreign=[],writes=[];let signedIn=true;
  page.on('pageerror',()=>errors.push('pageerror'));
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());if(['http:','https:'].includes(url.protocol)&&url.origin!==state.origin){foreign.push(url.host);return route.abort();}
   if(!url.pathname.startsWith('/api/account/'))return route.continue();
   assert.equal(request.headers().authorization,undefined);assert.equal(request.method(),'POST');
   if(url.pathname==='/api/account/session')return signedIn?route.fulfill({json:{user:{id:owner,email:'fixture@example.invalid',role:'user',isBlocked:false}}}):route.fulfill({status:401,json:{error:{code:'UNAUTHENTICATED'}}});
   if(url.pathname==='/api/account/logout'){writes.push(url.pathname);signedIn=false;return route.fulfill({json:{status:'logged_out'}});}
   if(url.pathname==='/api/account/profile')return route.fulfill({json:{exists:false,profile:createDefaultCabinetProfile({name:'Проверка кабинета',email:'fixture@example.invalid'}),revision:null}});
   if(['/api/account/listings','/api/account/listing-drafts/collection','/api/account/work-cabinet'].includes(url.pathname))return route.fulfill({json:{items:[],nextCursor:null,...(url.pathname==='/api/account/listings'?{workflow:'postmoderation'}:{})}});
   if(url.pathname==='/api/account/phone/status')return route.fulfill({json:{available:false,required:false,verified:false,phone:null,verifiedPhone:null}});
   assert.fail('Unexpected account operation '+url.pathname);
  });
  await page.goto(state.origin+'/cabinet');const main=page.locator('main'),nav=main.getByRole('navigation',{name:'Разделы',exact:true});
  await main.getByRole('heading',{name:'Мои объявления',level:1,exact:true}).waitFor();
  await nav.getByRole('link',{name:'Создать',exact:true}).waitFor();
  assert.equal(await nav.getByRole('link',{name:'Обзор',exact:true}).count(),0);
  assert.equal(await nav.getByRole('link',{name:'Мои объявления',exact:true}).getAttribute('aria-current'),'page');
  const order=await nav.locator(':scope > a,:scope > button').allTextContents();
  assert.deepEqual(order.map(text=>text.trim()),['Создать','Мои объявления','Вакансии','Заказы','Анкета','Отклики','Бронирования','Ярмарка','Выйти']);
  assert.equal(await main.getByRole('link',{name:'Мои объявления',exact:true}).count(),1);
  assert.equal(await main.getByRole('link',{name:'Создать',exact:true}).count(),1);assert.equal(await main.getByRole('button',{name:'Выйти',exact:true}).count(),1);
  assert.equal(await nav.getByRole('link',{name:'Создать',exact:true}).getAttribute('href'),'/razmestit');
  assert.equal(await nav.getByRole('link',{name:'Создать',exact:true}).evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(10, 123, 43)');
  await main.getByRole('link',{name:'Запросить удаление аккаунта',exact:true}).waitFor();
  for(const width of[320,768,1024,1440]){
   await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   assert.equal(await nav.locator('a,button').evaluateAll(nodes=>nodes.every(node=>{const box=node.getBoundingClientRect();return box.left>=0&&box.right<=innerWidth;})),true);
   if(width===320||width===1440)await main.screenshot({path:`/tmp/blizhniy-cabinet-navigation-${width}.png`});
  }
  await nav.getByRole('link',{name:'Создать',exact:true}).focus();await page.keyboard.press('Enter');await page.waitForURL(state.origin+'/razmestit');
  await page.getByRole('heading',{name:'Что разместить?',exact:true}).waitFor();assert.deepEqual(writes,[]);
  await page.goto(state.origin+'/cabinet?settings=1');await page.getByRole('region',{name:'Настройки аккаунта',exact:true}).waitFor();assert.equal(new URL(page.url()).search,'?settings=1');
  await nav.getByRole('link',{name:'Вакансии',exact:true}).click();await page.waitForURL(state.origin+'/cabinet/vakansii');
  assert.equal(await nav.getByRole('link',{name:'Вакансии',exact:true}).getAttribute('aria-current'),'page');
  await nav.getByRole('link',{name:'Мои объявления',exact:true}).click();await page.waitForURL(state.origin+'/cabinet/obyavleniya');
  await nav.getByRole('button',{name:'Выйти',exact:true}).click();await page.waitForURL(state.origin+'/auth');
  await page.getByLabel('Email',{exact:true}).waitFor();assert.deepEqual(writes,['/api/account/logout']);assert.deepEqual(errors,[]);assert.deepEqual(foreign,[]);
 }finally{await browser.close();}
});
