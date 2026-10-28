// Isolated Chromium and synthetic data; local simulator only, never a real merchant.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {REGISTRATION_LEGAL_VERSIONS as legal} from '../src/lib/registration-legal.ts';
import {stateFile,stateDirectory,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
const state=readLocalPrimaryState(stateFile,process.cwd());validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const origin=state.origin,email='order-ui-'+randomUUID()+'@local.invalid',password='SyntheticOrder-'+randomUUID()+'!';
const headers={Origin:origin,'Content-Type':'application/json','X-Blizhniy-Request':'1','Sec-Fetch-Site':'same-origin'};
const browser=await chromium.launch({headless:true}),context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.name));
try{
 assert.equal((await context.request.post(origin+'/api/account/register',{headers,data:{name:'Локальный заказчик',email,password,captchaToken:'',acceptedAgreement:true,acknowledgedPrivacy:true,agreementVersion:legal.agreement,privacyVersion:legal.privacy}})).status(),202);
 let token;for(let i=0;i<100&&!token;i++){
  for(const name of(await readdir(stateDirectory)).filter(name=>/^mail-[a-f0-9-]{36}\.json$/.test(name))){const mail=JSON.parse(await readFile(join(stateDirectory,name),'utf8'));if(mail.to===email)token=mail.text.match(/#token=([a-f0-9]{64})/)?.[1];}
  if(!token)await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.ok(token);assert.equal((await context.request.post(origin+'/api/account/confirm',{headers,data:{token}})).status(),200);
 await page.goto(origin+'/auth');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Пароль',{exact:true}).fill(password);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.waitForURL(origin+'/');
 await page.goto(origin+'/rabota/zakazy/sozdat');
 const title='Заказ из исходной формы '+randomUUID().slice(0,8),field=name=>page.locator(`input[name=${name}]`);
 await field('title').fill(title);
 const profession=page.getByRole('combobox',{name:'Профессия / специализация',exact:true});
 await profession.fill('несуществующая профессия');await profession.press('Tab');
 await page.getByRole('alert').filter({hasText:'Выберите профессию из списка.'}).waitFor();
 assert.equal(await profession.evaluate(input=>input.checkValidity()),false);
 await profession.fill('сант');await page.getByRole('listbox',{name:'Профессии',exact:true}).waitFor();await profession.press('ArrowDown');await profession.press('Enter');assert.equal(await profession.inputValue(),'Сантехник');
 await field('district').fill('Центральный');await field('budget').fill('7400,50');await field('phone').fill('+79991234567');await field('messengerUrl').fill('@synthetic_order');
 const description='Синтетический заказ: требуется ремонт смесителя и проверка соединений.';await page.locator('textarea[name=description]').fill(description);
 const pixels=await sharp({create:{width:400,height:300,channels:3,background:'#327859'}}).png().toBuffer();
 await page.locator('input[name=photos]').setInputFiles({name:'order.png',mimeType:'image/png',buffer:pixels});
 for(const checkbox of await page.locator('form input[type=checkbox]').all())await checkbox.check();
 assert.equal(await page.getByRole('button',{name:'Отправить на модерацию',exact:true}).count(),0);
 await page.addScriptTag({path:createRequire(import.meta.url).resolve('axe-core/axe.min.js')});
 const issues=await page.evaluate(async()=>{const result=await window.axe.run(document.querySelector('main form'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return result.violations.filter(item=>['serious','critical'].includes(item.impact)).map(item=>item.id);});assert.deepEqual(issues,[]);
 for(const width of [320,768,1024,1440]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 await page.screenshot({path:'/tmp/blizhniy-work-request-form-desktop.png',fullPage:true});
 const created=page.waitForResponse(response=>response.url()===origin+'/api/account/work-publications'&&response.request().method()==='PUT');
 await page.getByRole('button',{name:'Сохранить черновик',exact:true}).click();const draft=await created;assert.equal(draft.status(),200);const saved=await draft.json();
 assert.equal(saved.form.budget,'7400.50');assert.equal(saved.form.description,description);assert.equal(saved.form.photoIds.length,1);
 await page.waitForURL(origin+'/cabinet/zakazy');
 await page.getByRole('article').filter({hasText:title}).getByRole('link',{name:'Редактировать',exact:true}).click();await page.waitForURL(origin+'/rabota/zakazy/'+saved.id+'/edit');
 await field('title').waitFor();assert.equal(await field('title').inputValue(),title);assert.equal(await field('budget').inputValue(),'7400.50');assert.equal(await page.locator('input[name=keepPhotoIds]').count(),1);
 assert.equal((await field('phone').inputValue()).replace(/\D/g,''),'79991234567');assert.equal(await field('messengerUrl').inputValue(),'https://t.me/synthetic_order');assert.equal(await profession.inputValue(),'Сантехник');
 await page.locator('input[name=workLegalAccepted]').check();
 // Lose the already-committed prepare reply. Readback must recover the same payment, not create another.
 let prepares=0;const keys=[];
 const loseReply=async route=>{if(route.request().method()==='PUT'){prepares++;keys.push(route.request().postDataJSON().creationKey);const committed=await route.fetch();assert.equal(committed.status(),200);await route.abort('failed');}else await route.continue();};
 await page.route('**/api/account/work-request-checkout',loseReply);
 const dialogs=[];page.on('dialog',async dialog=>{dialogs.push(dialog.type());await dialog.dismiss();});
 await page.getByRole('button',{name:'Оплатить',exact:true}).click();
 await page.getByRole('button',{name:'Проверить сохранённый заказ',exact:true}).click();
 await page.waitForURL(/\/oplata\/[a-f0-9-]{36}\?type=workRequest$/);assert.equal(prepares,1);assert.equal(new Set(keys).size,1);assert.deepEqual(dialogs,[]);
 await page.unroute('**/api/account/work-request-checkout',loseReply);
 assert.equal((await context.request.get(origin+'/rabota/zakazy/'+saved.id)).status(),404,'Pending order is not public');
 await page.getByRole('link',{name:'Мои заказы',exact:true}).waitFor();
 await page.getByRole('button',{name:'Открыть локальный симулятор',exact:true}).click();await page.waitForURL(/\/__local\/payment\?intent=.*&type=workRequest$/);
 await page.getByRole('button',{name:'Подтвердить успешную оплату',exact:true}).click();await page.getByText('Оплата подтверждена сервером, размещение выполнено.',{exact:false}).waitFor();
 await page.goto(origin+'/rabota/zakazy/'+saved.id);await page.getByRole('heading',{name:title,exact:true}).waitFor();
 const photo=page.locator(`img[src*="/api/work-publications/${saved.id}/photos/"]`).first();await photo.waitFor();await photo.evaluate(img=>img.complete&&img.naturalWidth>0?true:new Promise((resolve,reject)=>{img.addEventListener('load',()=>resolve(true),{once:true});img.addEventListener('error',()=>reject(Error('Saved photo unavailable')),{once:true});}));
 const publicationDates=page.locator('dl[aria-label="Даты публикации"] time');assert.equal(await publicationDates.count(),1);const publishedAt=await publicationDates.first().getAttribute('datetime');
 await page.goto(origin+'/cabinet/zakazy');const publishedCard=page.getByRole('article').filter({hasText:title});assert.equal(await publishedCard.getByRole('button',{name:/Подробнее/}).count(),0);await publishedCard.getByRole('link',{name:'Посмотреть',exact:true}).waitFor();await publishedCard.getByRole('link',{name:'Редактировать',exact:true}).click();await field('title').waitFor();
 const edited=title+' — исправлен';await field('title').fill(edited);await page.getByRole('button',{name:'Сохранить черновик',exact:true}).click();await page.waitForURL(origin+'/cabinet/zakazy');
 await page.goto(origin+'/rabota/zakazy/'+saved.id);await page.getByRole('heading',{name:edited,exact:true}).waitFor();
 assert.equal(await publicationDates.count(),2);assert.equal(await publicationDates.first().getAttribute('datetime'),publishedAt);assert.ok(Date.parse(await publicationDates.nth(1).getAttribute('datetime'))>Date.parse(publishedAt));await page.getByText('Размещено',{exact:true}).waitFor();await page.getByText('Обновлено',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({status:'passed',professionCombobox:true,persistedFieldsAndPhoto:true,draftThenCanonicalEdit:true,lostPrepareRecoveredWithoutDuplicate:true,publishedAfterSimulatedCapture:true,paidEditRemainsPublic:true,responsive:[320,768,1024,1440],axeSeriousCritical:0,realCharges:false,productionTouched:false}));
}finally{await browser.close();}
