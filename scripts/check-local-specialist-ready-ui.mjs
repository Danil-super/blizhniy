// Local synthetic data only. Real owner HTTP; read-only discovery of prior synthetic work fixtures.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import pg from 'pg';
import {REGISTRATION_LEGAL_VERSIONS as legal} from '../src/lib/registration-legal.ts';
import {createDefaultCabinetProfile} from '../src/lib/cabinet-profile.ts';
import {stateFile,stateDirectory,docker,localPrimaryDatabaseConfig} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';

const state=readLocalPrimaryState(stateFile,process.cwd()),origin=state.origin;
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
process.env.BLIZHNIY_LOCAL_PRIMARY='enabled';
process.env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN=origin;
process.env.BLIZHNIY_LISTING_WORKFLOW='postmoderation';
const browser=await chromium.launch({headless:true});
const headers={Origin:origin,'Content-Type':'application/json','X-Blizhniy-Request':'1','Sec-Fetch-Site':'same-origin'};
const axePath=createRequire(import.meta.url).resolve('axe-core/axe.min.js');
async function responsive(page,region,prefix){
 await page.addScriptTag({path:axePath});
 for(const width of [320,768,1024,1440]){
  await page.setViewportSize({width,height:1000});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const violations=await region.evaluate(async element=>{
   const report=await window.axe.run(element,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});
   return report.violations.filter(item=>['serious','critical'].includes(item.impact)).map(item=>({id:item.id,targets:item.nodes.map(node=>node.target)}));
  });assert.deepEqual(violations,[]);
  await page.screenshot({path:`/tmp/blizhniy-${prefix}-${width}.png`,fullPage:true});
 }
}
async function menus(){
 const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],unexpected=[];
 page.on('pageerror',error=>errors.push(error.name));
 const owner='12345678-1234-4321-8765-123456789abc';
 const items=['published','published','draft'].map((status,index)=>({id:`22345678-1234-4321-8765-123456789ab${index}`,revision:'2',kind:'prodam',title:`Меню карточки ${index+1}`,price:'3500.00',card:{city:'Крымск',district:null,coverPhotoId:null,status,blockReason:null}}));
 await context.route('**/*',route=>{
  const request=route.request(),url=new URL(request.url());
  assert.ok(!['http:','https:'].includes(url.protocol)||url.origin===origin,'No external requests');
  if(!url.pathname.startsWith('/api/account/'))return route.continue();
  if(url.pathname==='/api/account/session')return route.fulfill({json:{user:{id:owner,email:'menus@local.invalid',role:'user',isBlocked:false}}});
  if(url.pathname==='/api/account/profile')return route.fulfill({json:{exists:false,revision:null,profile:createDefaultCabinetProfile({name:'Локальная проверка',email:'menus@local.invalid'})}});
  if(url.pathname==='/api/account/listings'){assert.equal(request.method(),'POST');assert.equal(request.postDataJSON().expectedOwnerId,owner);return route.fulfill({json:{items,nextCursor:null,workflow:'postmoderation'}});}
  unexpected.push(url.pathname);return route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});
 });
 try{
  await page.goto(origin+'/cabinet/obyavleniya');const cards=page.getByRole('region',{name:'Список моих объявлений',exact:true});await cards.locator('article').last().waitFor();
  const first=cards.locator('article').nth(0).locator('details'),second=cards.locator('article').nth(1).locator('details');
  await first.locator('summary').click();assert.equal(await first.evaluate(element=>element.open),true);
  await second.locator('summary').click();assert.equal(await first.evaluate(element=>element.open),false,'Opening another card closes the old menu');assert.equal(await second.evaluate(element=>element.open),true);
  await second.locator('summary').press('Escape');assert.equal(await second.evaluate(element=>element.open),false);assert.equal(await second.locator('summary').evaluate(element=>element===document.activeElement),true);
  await first.locator('summary').press('Enter');await second.locator('summary').press('Space');assert.equal(await cards.locator('details[open]').count(),1);assert.equal(await first.evaluate(element=>element.open),false);
  await cards.getByRole('button',{name:'Статус и оплата',exact:true}).click();assert.equal(await cards.locator('details[open]').count(),0);
  await responsive(page,cards,'listing-exclusive-menu');assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
 }finally{await context.close();}
}
async function specialist(){
 const db=new pg.Client(localPrimaryDatabaseConfig(state,'owner'));await db.connect();let target;
 try{
  const load=createRequire(import.meta.url)('./local-primary-modules.cjs').loadLocalPrimaryModule;
  const publicWork=new(load('postgres-public-work').PostgresPublicWorkStore)(db,{vacancyPostmoderation:true});
  const candidates=(await db.query("select id from app.work_publications where kind='workRequest' and form->>'title' like $1 order by created_at desc limit 20",['Проверка вида оплаченного заказа %'])).rows;
  for(const candidate of candidates)if(await publicWork.read('workRequest',candidate.id)){target=candidate.id;break;}
  assert.ok(target,'A previously published synthetic order is required');
 }finally{await db.end();}
 const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],moderation=[];
 page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.name));
 await context.route('**/*',route=>{
  const request=route.request(),url=new URL(request.url());
  assert.ok(!['http:','https:'].includes(url.protocol)||url.origin===origin,'No external requests');
  assert.ok(!/checkout|payment/.test(url.pathname),'No payment calls');
  if(/moderation/.test(url.pathname))moderation.push(url.pathname);
  return route.continue();
 });
 try{
  const email='specialist-ready-'+randomUUID()+'@local.invalid',password='SyntheticReady-'+randomUUID()+'!';
  assert.equal((await context.request.post(origin+'/api/account/register',{headers,data:{name:'Анна-Мария',email,password,captchaToken:'',acceptedAgreement:true,acknowledgedPrivacy:true,agreementVersion:legal.agreement,privacyVersion:legal.privacy}})).status(),202);
  let token;const deadline=Date.now()+10000;
  while(!token&&Date.now()<deadline){
   for(const name of(await readdir(stateDirectory)).filter(name=>/^mail-[a-f0-9-]{36}\.json$/.test(name))){const mail=JSON.parse(await readFile(join(stateDirectory,name),'utf8'));if(mail.to===email)token=mail.text.match(/#token=([a-f0-9]{64})/)?.[1];}
   if(!token)await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(token);assert.equal((await context.request.post(origin+'/api/account/confirm',{headers,data:{token}})).status(),200);
  await page.goto(origin+'/auth');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Пароль',{exact:true}).fill(password);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.waitForURL(origin+'/');
  const sessionResponse=await context.request.post(origin+'/api/account/session',{headers,data:{}});assert.equal(sessionResponse.status(),200);const owner=(await sessionResponse.json()).user.id;
  await page.goto(origin+'/rabota/specialisty/anketa');const form=page.getByRole('form',{name:'Анкета специалиста'}),field=name=>form.locator(`[name="${name}"]`);
  await field('description').waitFor();assert.equal(await form.locator('textarea').count(),1);assert.equal(await form.locator('[name=skills],[name=experience],[name=videoUrl],[name=district],input[type=file]').count(),0);
  assert.equal(await field('title').inputValue(),'Анна-Мария');assert.equal(await form.getByRole('button',{name:'Отправить на модерацию',exact:true}).count(),0);
  const profession=form.getByRole('combobox',{name:'Профессия / специализация'});await profession.fill('сант');await form.getByRole('option',{name:'Сантехник',exact:true}).click();await field('price').fill('1500');
  const about='Выполняю монтаж и ремонт сантехники. Работаю аккуратно, согласую сроки и стоимость.\n'.repeat(10).trim();assert.ok(about.length>500);
  await field('description').fill(about);await field('phone').fill('+79990000000');await field('placementRightConfirmed').check();await field('serviceLegalAccepted').check();
  await responsive(page,form,'specialist-ready');await page.setViewportSize({width:1440,height:1000});
  const saveResponse=page.waitForResponse(response=>response.url()===origin+'/api/account/service-publications'&&response.request().method()==='PUT');
  await form.getByRole('button',{name:'Сохранить анкету',exact:true}).click();const response=await saveResponse;assert.equal(response.status(),200);const saved=await response.json();
  assert.equal(saved.status,'draft');assert.equal(saved.paid,false);assert.equal(saved.form.description,about);assert.equal(saved.form.skills,null);assert.equal(saved.form.experience,null);
  await page.waitForURL(origin+'/cabinet/specialist');
  await page.goto(origin+'/rabota/specialisty/anketa');await field('description').waitFor();assert.equal(await field('description').inputValue(),about);await page.getByRole('heading',{name:'Анкета заполнена',exact:true}).waitFor();
  assert.deepEqual(moderation,[],'No moderation even on reopening the saved questionnaire');
  await page.goto(origin+'/rabota/zakazy/'+target);const composer=page.getByRole('region',{name:'Отклик на публикацию'});await composer.getByRole('button',{name:'Сохранить отклик',exact:true}).waitFor();await composer.getByText('Анна-Мария',{exact:true}).waitFor();
  await composer.getByLabel('Сообщение',{exact:true}).fill('Готова помочь с ремонтом.');
  const applicationResponse=page.waitForResponse(response=>response.url()===origin+'/api/account/applications'&&response.request().method()==='PUT');await composer.getByRole('button',{name:'Сохранить отклик',exact:true}).click();const applicationHttp=await applicationResponse;assert.equal(applicationHttp.status(),200);const application=await applicationHttp.json();
  assert.equal(application.specialistId,saved.id);assert.equal(application.status,'pending_payment');assert.equal(application.paid,false);assert.equal(application.sentAt,null);assert.equal(application.snapshot.about,about);assert.equal(application.snapshot.name,'Анна-Мария');
  await composer.getByRole('heading',{name:'Отклик сохранён. Ожидает оплаты.',exact:true}).waitFor();
  // Saving the questionnaire does not fabricate its paid catalogue publication.
  assert.equal((await context.request.get(origin+'/specialist/'+saved.id)).status(),404);
  const read=await context.request.post(origin+'/api/account/service-publications',{headers,data:{action:'read',kind:'specialist',expectedOwnerId:owner,publicationId:saved.id}});assert.equal(read.status(),200);const after=await read.json();assert.equal(after.status,'draft');assert.equal(after.paid,false);assert.equal(after.revision,saved.revision);
  assert.deepEqual(errors,[]);assert.deepEqual(moderation,[]);
 }finally{await context.close();}
}
try{
 await menus();if(!process.argv.includes('--menus-only'))await specialist();
 console.log(JSON.stringify({status:'passed',exclusiveMenus:true,keyboard:true,specialistReady:!process.argv.includes('--menus-only'),responsive:[320,768,1024,1440],axeSeriousCritical:0,productionTouched:false,paymentMutations:false}));
}finally{await browser.close();}
