// Isolated browser fixtures only. No Telegram exchange or phone binding is made.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {createDefaultCabinetProfile} from '../src/lib/cabinet-profile.ts';
import {stateFile,stateDirectory,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
const state=readLocalPrimaryState(stateFile,process.cwd());
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const account=JSON.parse(await readFile(join(stateDirectory,'accounts.json'),'utf8')).find(a=>a.role==='user');
assert.ok(account.email.endsWith('@local.invalid'));
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:390,height:844}});
 const login=await context.request.post(state.origin+'/api/account/login',{headers:{Origin:state.origin,'Content-Type':'application/json','X-Blizhniy-Request':'1'},data:{email:account.email,password:account.password,captchaToken:''}});
 assert.equal(login.status(),200);const owner=(await login.json()).user.id;
 for(const [coop,replacement,noChannel]of [[false,false,false],[true,true,false],[true,false,true]]){
  const errors=[];if(noChannel)await context.addInitScript(()=>{delete window.BroadcastChannel;});
  const id=randomUUID(),phone='+79991234567';let confirmed=false,returned=false,confirmations=0;
  const profile=createDefaultCabinetProfile({name:'Проверка окна',email:account.email});
  if(replacement)profile.phone='+79990000000';
  await context.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.origin==='https://oauth.telegram.org')return route.fulfill({contentType:'text/html; charset=utf-8',headers:coop?{'Cross-Origin-Opener-Policy':'same-origin'}:{},body:`<a href="${state.origin}/cabinet/phone?attempt=${id}">Вернуться на сайт</a>`});
   if(url.origin!==state.origin)return route.abort();
   if(url.pathname==='/api/account/profile')return route.fulfill({json:{exists:true,revision:(confirmed?'b':'a').repeat(64),profile:{...profile,...(confirmed?{phone,phoneVerified:true,verifiedPhone:phone}:{})}}});
   if(url.pathname==='/api/account/phone/status')return route.fulfill({json:{available:true,required:true,verified:confirmed,phone:confirmed?phone:'',verifiedPhone:confirmed?phone:null}});
   if(url.pathname==='/api/account/phone/start')return route.fulfill({json:{attemptId:id,authorizationUrl:'https://oauth.telegram.org/auth?state=synthetic'}});
   if(url.pathname==='/api/account/phone/review')return returned?route.fulfill({json:{id,phone,currentPhone:profile.phone,replaceRequired:replacement,profileRevision:'a'.repeat(64),confirmed,returnTo:'/cabinet'}}):route.fulfill({status:400,json:{error:{code:'INVALID_ATTEMPT'}}});
   if(url.pathname==='/api/account/phone/confirm'){const data=route.request().postDataJSON();assert.equal(data.expectedOwnerId,owner);assert.equal(data.acceptReplacement,replacement);confirmations++;confirmed=true;return route.fulfill({json:{confirmed:true,phone,returnTo:'/cabinet'}});}
   return route.continue();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.name));
  await page.goto(state.origin+'/cabinet');await page.getByRole('button',{name:'Настройки',exact:true}).click();
  const settings=page.getByRole('region',{name:'Настройки аккаунта',exact:true});
  await settings.getByLabel('Имя',{exact:true}).fill('Несохранённое имя');
  const opening=page.waitForEvent('popup');await settings.getByRole('button',{name:'Подтвердить через Telegram',exact:true}).click();const popup=await opening;
  await popup.getByRole('link',{name:'Вернуться на сайт',exact:true}).waitFor();
  await page.bringToFront();await settings.getByLabel('Имя',{exact:true}).waitFor();
  await page.waitForTimeout(500);
  assert.equal(popup.isClosed(),false,'A session refresh must preserve the pending popup');
  returned=true;const closing=popup.waitForEvent('close',{timeout:10000});
  await popup.getByRole('link',{name:'Вернуться на сайт',exact:true}).click();
  if(replacement){
   const confirm=popup.getByRole('button',{name:'Подтвердить этот номер',exact:true});await confirm.waitFor();
   assert.equal(await confirm.isDisabled(),true,'A different saved phone requires consent');assert.equal(confirmations,0);
   await popup.getByRole('checkbox').check();await confirm.click();
  }
  await popup.getByRole('status').filter({hasText:'Телефон успешно подтверждён'}).waitFor();
  await popup.screenshot({path:'/tmp/blizhniy-phone-success-'+(coop?'isolated':'normal')+'.png'});await closing;
  await settings.getByRole('button',{name:'Изменить номер',exact:true}).waitFor();
  assert.equal((await settings.getByLabel('Телефон',{exact:true}).inputValue()).replace(/\D/g,''),'79991234567');
  assert.equal(await settings.getByLabel('Имя',{exact:true}).inputValue(),'Несохранённое имя');
  assert.equal(confirmations,1);assert.deepEqual(errors,[]);await page.close();await context.unrouteAll({behavior:'wait'});
 }
 console.log(JSON.stringify({passed:true,popupAutoClosed:true,originProfileRefreshed:true,unsavedFieldsPreserved:true,withAndWithoutOpener:true,broadcastUnavailableFallback:true,realTelegramExchange:false,productionTouched:false}));
}finally{await browser.close();}
