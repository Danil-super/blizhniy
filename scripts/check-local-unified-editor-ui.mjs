// Isolated real browser, owned local container, synthetic account and drafts only.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import {REGISTRATION_LEGAL_VERSIONS as legal} from '../src/lib/registration-legal.ts';
import {parseWorkPublicationForm} from '../src/lib/work-publication-contract.ts';
import {parseServicePublicationForm} from '../src/lib/service-publication-contract.ts';
import {stateFile,stateDirectory,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';

const state=readLocalPrimaryState(stateFile,process.cwd());
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const origin=state.origin,email='unified-edit-'+randomUUID()+'@local.invalid',password='SyntheticEditor-'+randomUUID()+'!';
const headers={Origin:origin,'Content-Type':'application/json','X-Blizhniy-Request':'1','Sec-Fetch-Site':'same-origin'};
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',viewport:{width:1440,height:1000}});
const page=await context.newPage(),errors=[],lists=[];
page.setDefaultTimeout(12000);
page.on('pageerror',error=>errors.push(error.name));
page.on('request',request=>{
 if(request.method()!=='POST')return;
 const path=new URL(request.url()).pathname;
 if(path==='/api/account/work-cabinet')lists.push(path);
 if(path==='/api/account/service-publications'&&request.postDataJSON()?.action==='list')lists.push(path);
});

async function api(path,method,data){
 const response=await context.request[method](origin+path,{headers,data});
 assert.equal(response.status(),200,path+' '+data.action);
 return response.json();
}
async function revealVacancy(kind){
 if(kind==='vacancy'){
  const next=page.getByRole('button',{name:'Продолжить к вакансии',exact:true});
  await next.waitFor();await next.click();
 }
 await page.locator('input[name=title]:visible').waitFor();
}

try{
 assert.equal((await context.request.post(origin+'/api/account/register',{headers,data:{name:'Проверка единого редактора',email,password,captchaToken:'',acceptedAgreement:true,acknowledgedPrivacy:true,agreementVersion:legal.agreement,privacyVersion:legal.privacy}})).status(),202);
 let token;
 const deadline=Date.now()+10000;
 while(!token&&Date.now()<deadline){
  for(const name of(await readdir(stateDirectory)).filter(name=>/^mail-[a-f0-9-]{36}\.json$/.test(name))){
   const mail=JSON.parse(await readFile(join(stateDirectory,name),'utf8'));
   if(mail.to===email)token=mail.text.match(/#token=([a-f0-9]{64})/)?.[1];
  }
  if(!token)await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.ok(token,'Synthetic confirmation captured locally');
 assert.equal((await context.request.post(origin+'/api/account/confirm',{headers,data:{token}})).status(),200);
 await page.goto(origin+'/auth');
 await page.getByLabel('Email',{exact:true}).fill(email);
 await page.getByLabel('Пароль',{exact:true}).fill(password);
 await page.getByRole('button',{name:'Войти',exact:true}).click();await page.waitForURL(origin+'/');
 const owner=(await api('/api/account/session','post',{})).user.id;
 const definitions=[
  {kind:'vacancy',cabinet:'/cabinet/vakansii',edit:id=>'/rabota/vakansii/'+id+'/edit'},
  {kind:'workRequest',cabinet:'/cabinet/zakazy',edit:id=>'/rabota/zakazy/'+id+'/edit'},
  {kind:'fair',cabinet:'/cabinet/fair-applications',edit:id=>'/yarmarka-masterov/zayavka?draft='+id},
  {kind:'specialist',cabinet:'/cabinet/specialist',edit:id=>'/rabota/specialisty/anketa?draft='+id},
  {kind:'marquee',cabinet:'/reklama/begushchaya-stroka?view=list',edit:id=>'/reklama/begushchaya-stroka?draft='+id},
 ];
 for(const definition of definitions){
  const {kind}=definition,work=['vacancy','workRequest'].includes(kind);
  const title='Единый редактор '+kind+' '+randomUUID().slice(0,8);
  const common={kind,title,description:'Синтетическое описание для проверки сохранности исходной формы.',cityName:'Краснодар',district:'Центральный',contactPhone:'+79991234567',messengerUrl:'@synthetic_editor',photoIds:[],placementRightConfirmed:true};
  const form=work?parseWorkPublicationForm(kind,{...common,professionName:'Сантехник',...(kind==='vacancy'?{salary:'65000.50',organization:'Частный работодатель',employerType:'person',schedule:'5/2',workFormat:'На месте',requirements:'Аккуратность',responsibilities:'Ремонт оборудования',conditions:'Дневная работа'}:{budget:'4500.50'})}):
   parseServicePublicationForm(kind,kind==='marquee'?{kind,title,href:'https://example.invalid/local-only',placementRightConfirmed:true}:{...common,email:'contact@example.invalid',...(kind==='fair'?{category:'Мебель',comment:'Не публикуемый комментарий'}:{professionName:'Сантехник',price:'1500.50',skills:'Ремонт сантехники',experience:'Только тестовые данные'})});
  const endpoint=work?'/api/account/work-publications':'/api/account/service-publications';
  const saved=await api(endpoint,'put',{action:'create',expectedOwnerId:owner,kind,creationKey:randomUUID(),form});
  const editUrl=origin+definition.edit(saved.id);
  await page.goto(origin+definition.cabinet);
  const card=page.getByRole('article').filter({hasText:title});await card.waitFor();
  await card.getByRole('button',{name:'Подробнее: '+title,exact:true}).click();
  await page.getByRole('heading',{level:2,name:title,exact:true}).waitFor();
  assert.equal(await page.locator('main form:visible').count(),0,kind+' Details is read-only');
  assert.equal(new URL(page.url()).pathname,new URL(origin+definition.cabinet).pathname);
  const beforeLists=lists.length;
  await card.getByRole('link',{name:'Редактировать',exact:true}).click();
  await page.waitForURL(editUrl);await revealVacancy(kind);
  assert.equal(await page.locator('input[name=title]:visible').inputValue(),title);
  assert.equal(lists.length,beforeLists,kind+' edit loads one record, not the cabinet list');
  assert.equal(await page.getByRole('button',{name:/^Подробнее:/}).count(),0);
  assert.equal(await page.getByRole('link',{name:/^Создать (вакансию|заказ)$/}).count(),0);
  if(kind!=='marquee')assert.equal(await page.locator('textarea[name=description]').inputValue(),form.description);
  if(kind==='vacancy'){
   assert.equal(await page.locator('input[name=salary]').inputValue(),'65000.50');
   assert.equal(await page.locator('select[name=schedule]').inputValue(),'5/2');
   assert.equal(await page.locator('select[name=workFormat]').inputValue(),'На месте');
  }
  if(kind==='fair')assert.equal(await page.locator('textarea[name=comment]').inputValue(),form.comment);
  if(kind==='specialist')assert.equal(await page.locator('textarea[name=skills]').inputValue(),form.skills);
  if(kind==='marquee')assert.equal(await page.locator('input[name=href]').inputValue(),form.href);
  for(const width of [320,768,1024,1440]){
   await page.setViewportSize({width,height:1000});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,kind+' editor has no horizontal overflow at '+width);
  }
  await page.screenshot({path:'/tmp/blizhniy-unified-editor-'+kind+'-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'/tmp/blizhniy-unified-editor-'+kind+'-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.addScriptTag({path:createRequire(import.meta.url).resolve('axe-core/axe.min.js')});
  const accessibility=await page.evaluate(async()=>{
   const result=await window.axe.run(document.querySelector('main form'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});
   return result.violations.filter(item=>['serious','critical'].includes(item.impact)).map(item=>item.id);
  });
  assert.deepEqual(accessibility,[],kind+' editor serious/critical accessibility findings');
  const updatedTitle=title+' — изменено';await page.locator('input[name=title]:visible').fill(updatedTitle);
  for(const checkbox of await page.locator('form input[type=checkbox]:visible').all())await checkbox.check();
  let latest;
  if(kind==='vacancy'||kind==='fair'){
   let writeCount=0;
   const loseReply=async route=>{
    if(route.request().method()==='PUT'){
     writeCount++;const committed=await route.fetch();assert.equal(committed.status(),200);latest=await committed.json();await route.abort('failed');
    }else await route.continue();
   };
   await page.route('**'+endpoint,loseReply);
   await page.getByRole('button',{name:'Сохранить черновик',exact:true}).click();
   const readback=page.getByRole('button',{name:'Проверить сохранённую форму',exact:true});await readback.waitFor();
   assert.equal(await page.getByRole('button',{name:'Сохранить черновик',exact:true}).isDisabled(),true);
   await readback.click();await page.waitForURL(origin+definition.cabinet);
   await page.unroute('**'+endpoint,loseReply);assert.equal(writeCount,1,kind+' lost save reply resolves through readback, not duplicate write');
  }else{
   const updated=page.waitForResponse(response=>response.url()===origin+endpoint&&response.request().method()==='PUT');
   await page.getByRole('button',{name:'Сохранить черновик',exact:true}).click();
   const response=await updated;assert.equal(response.status(),200);latest=await response.json();
  }
  assert.equal(latest.id,saved.id);assert.equal(latest.form.title,updatedTitle);
  await page.waitForURL(origin+definition.cabinet);
  await page.getByRole('article').filter({hasText:updatedTitle}).waitFor();
  await page.goto(editUrl);await revealVacancy(kind);
  assert.equal(await page.locator('input[name=title]:visible').inputValue(),updatedTitle);
  await page.reload();await revealVacancy(kind);
  assert.equal(await page.locator('input[name=title]:visible').inputValue(),updatedTitle,kind+' direct reload restores persisted form');
  const unsaved=updatedTitle+' — не сохранено';await page.locator('input[name=title]:visible').fill(unsaved);
  let failSession=true;
  const sessionHandler=async route=>failSession?route.fulfill({status:503,json:{error:{code:'ACCOUNT_UNAVAILABLE'}}}):route.continue();
  await page.route('**/api/account/session',sessionHandler);
  const unavailable=page.waitForResponse(response=>response.url()===origin+'/api/account/session'&&response.status()===503);
  // Headless tab activation does not emit native focus; exercise the app's established focus listener directly.
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await unavailable;
  await page.locator('input[name=title]:visible').waitFor({state:'hidden'});
  failSession=false;
  await page.getByRole('button',{name:/Повторить проверку (входа|доступа)/}).first().click();
  await page.locator('input[name=title]:visible').waitFor();
  assert.equal(await page.locator('input[name=title]:visible').inputValue(),unsaved,kind+' session outage preserves private unsaved form');
  await page.unroute('**/api/account/session',sessionHandler);
  // Restore the saved value before navigating, so the leave guard is not bypassed.
  await page.locator('input[name=title]:visible').fill(updatedTitle);
  for(const checkbox of await page.locator('form input[type=checkbox]:visible').all())await checkbox.check();
  const cleanSave=page.waitForResponse(result=>result.url()===origin+endpoint&&result.request().method()==='PUT');
  await page.getByRole('button',{name:'Сохранить черновик',exact:true}).click();assert.equal((await cleanSave).status(),200);
  await page.waitForURL(origin+definition.cabinet);
  const denied=await context.request.post(origin+endpoint,{headers,data:{action:'read',expectedOwnerId:randomUUID(),kind,publicationId:saved.id}});
  assert.equal(denied.status(),404,kind+' foreign owner cannot read');
  console.log(JSON.stringify({kind,status:'passed',readOnlyDetails:true,separateEditRoute:true,noListOnEdit:true,persistedFields:true,directReload:true,sessionOutageKeepsUnsaved:true,foreignOwnerDenied:true}));
 }
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({status:'passed',kinds:5,syntheticLocalOnly:true,realCharges:false,productionTouched:false}));
}finally{await browser.close();}
