// Local synthetic accounts. No BotFather client, Telegram requests or attestation simulation.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';import {join} from 'node:path';import {chromium} from 'playwright';
import {stateFile,stateDirectory,docker} from './local-primary-fixture.mjs';import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
const state=readLocalPrimaryState(stateFile,process.cwd());validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const account=JSON.parse(await readFile(join(stateDirectory,'accounts.json'),'utf8')).find(a=>a.role==='user');assert.ok(account.email.endsWith('@local.invalid'));
const browser=await chromium.launch({headless:true}),context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],external=[];
await context.route('**/*',route=>{const url=new URL(route.request().url());if(['http:','https:'].includes(url.protocol)&&url.origin!==state.origin){external.push(url.origin);return route.abort();}return route.continue();});page.on('pageerror',e=>errors.push(e.name));
try{
 await page.goto(state.origin+'/auth');await page.getByLabel('Email',{exact:true}).fill(account.email);await page.getByLabel('Пароль',{exact:true}).fill(account.password);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.waitForURL(state.origin+'/');
 await page.goto(state.origin+'/cabinet');await page.getByRole('button',{name:'Настройки',exact:true}).click();const settings=page.getByRole('region',{name:'Настройки аккаунта',exact:true});
 const button=settings.getByRole('button',{name:'Подтвердить через Telegram',exact:true});await button.waitFor();await settings.getByText('Подтверждение через Telegram пока не настроено.',{exact:false}).waitFor();assert.equal(await button.isDisabled(),true);
 for(const width of[320,390,1440]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 await settings.screenshot({path:'/tmp/blizhniy-telegram-settings.png'});
 await page.goto(state.origin+'/cabinet/phone?error=cancelled');await page.getByRole('alert').filter({hasText:'Подтверждение отменено'}).waitFor();assert.equal(await page.getByRole('button',{name:'Подтвердить этот номер'}).count(),0);
 // UI-only availability fixture: the REAL unconfigured start endpoint must fail.
 // This exercises popup failure and draft preservation without claiming verification.
 await page.route('**/api/account/phone/status',route=>route.fulfill({json:{available:true,required:true,verified:false,phone:'',verifiedPhone:null}}));
 await page.goto(state.origin+'/cabinet');await page.getByRole('button',{name:'Настройки',exact:true}).click();await settings.getByLabel('Имя',{exact:true}).fill('Несохранённое имя');await button.waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Подтвердить через Telegram'&&!b.disabled));
 const opening=page.waitForEvent('popup');await button.click();const popup=await opening;await settings.getByRole('alert').filter({hasText:'Подтверждение через Telegram пока недоступно'}).waitFor();assert.equal(await settings.getByLabel('Имя',{exact:true}).inputValue(),'Несохранённое имя');assert.equal(popup.isClosed(),true);
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log(JSON.stringify({status:'passed',disabledWithoutClient:true,cancelledCallback:true,popupFailurePreservesDraft:true,widths:[320,390,1440],externalRequests:0,realTelegramVerified:false,productionTouched:false}));
}finally{await browser.close();}
