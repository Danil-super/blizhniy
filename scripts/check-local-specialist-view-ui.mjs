// Isolated browser, synthetic local account; no production data, moderation or payments.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import pg from 'pg';
import {REGISTRATION_LEGAL_VERSIONS as legal} from '../src/lib/registration-legal.ts';
import {stateFile,stateDirectory,docker,localPrimaryDatabaseConfig} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';

const state=readLocalPrimaryState(stateFile,process.cwd()),origin=state.origin;
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const browser=await chromium.launch({headless:true}),context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',viewport:{width:1440,height:1000}});
const page=await context.newPage(),errors=[],unexpected=[];page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.name));
const headers={Origin:origin,'Content-Type':'application/json','X-Blizhniy-Request':'1','Sec-Fetch-Site':'same-origin'};
const axePath=createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const savedWrites=[];
await context.route('**/*',route=>{
 const url=new URL(route.request().url());if(['http:','https:'].includes(url.protocol)&&url.origin!==origin){unexpected.push('external');return route.abort();}
 if(/moderation|checkout|payment/.test(url.pathname)){unexpected.push('workflow');return route.abort();}return route.continue();
});
// Capture the real response before the editor performs its intentional full-page redirect.
await context.route('**/api/account/service-publications',async route=>{
 if(route.request().method()!=='PUT')return route.continue();
 const response=await route.fetch();assert.equal(response.status(),200);savedWrites.push(await response.json());await route.fulfill({response});
});
async function responsive(region){
 await page.addScriptTag({path:axePath});
 for(const width of [320,768,1024,1440]){
  await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const violations=await region.evaluate(async node=>(await window.axe.run(node,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>v.id));assert.deepEqual(violations,[]);
  await page.screenshot({path:`/tmp/blizhniy-specialist-view-${width}.png`,fullPage:true});
 }
}
try{
 const email='specialist-view-'+randomUUID()+'@local.invalid',password='SyntheticView-'+randomUUID()+'!';
 assert.equal((await context.request.post(origin+'/api/account/register',{headers,data:{name:'Анна',email,password,captchaToken:'',acceptedAgreement:true,acknowledgedPrivacy:true,agreementVersion:legal.agreement,privacyVersion:legal.privacy}})).status(),202);
 let token;const deadline=Date.now()+10000;
 while(!token&&Date.now()<deadline){for(const file of(await readdir(stateDirectory)).filter(file=>/^mail-[a-f0-9-]{36}\.json$/.test(file))){const mail=JSON.parse(await readFile(join(stateDirectory,file),'utf8'));if(mail.to===email)token=mail.text.match(/#token=([a-f0-9]{64})/)?.[1];}if(!token)await new Promise(resolve=>setTimeout(resolve,100));}
 assert.ok(token);assert.equal((await context.request.post(origin+'/api/account/confirm',{headers,data:{token}})).status(),200);
 await page.goto(origin+'/auth');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Пароль',{exact:true}).fill(password);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.waitForURL(origin+'/');
 const session=await context.request.post(origin+'/api/account/session',{headers,data:{}}),owner=(await session.json()).user.id;
 await page.goto(origin+'/cabinet/specialist');
 const form=page.getByRole('form',{name:'Анкета специалиста'}),field=name=>form.locator(`[name="${name}"]`);
 await field('description').waitFor();assert.equal(await page.getByRole('link',{name:'Создать анкету',exact:true}).count(),0);assert.equal(await page.getByRole('link',{name:'← Вернуться в кабинет',exact:true}).count(),0);
 const profession=form.getByRole('combobox',{name:'Профессия / специализация'});await profession.fill('сант');await form.getByRole('option',{name:'Сантехник',exact:true}).click();
 await field('price').fill('1500');await field('description').fill('Устанавливаю и ремонтирую сантехнику. Работаю аккуратно, соблюдаю договорённости.');await field('phone').fill('+79990000000');await field('placementRightConfirmed').check();await field('serviceLegalAccepted').check();
 const response=page.waitForResponse(response=>response.url()===origin+'/api/account/service-publications'&&response.request().method()==='PUT');await form.getByRole('button',{name:'Сохранить анкету',exact:true}).click();assert.equal((await response).status(),200);const saved=savedWrites.at(-1);assert.ok(saved);
 const details=page.getByRole('region',{name:'Моя анкета',exact:true});await details.getByRole('heading',{name:'Анна',exact:true}).waitFor();assert.equal(await form.count(),0);assert.equal(await page.getByRole('heading',{name:'Мои материалы',exact:true}).count(),0);
 assert.equal(await details.getByRole('link',{name:'Редактировать',exact:true}).getAttribute('href'),`/rabota/specialisty/anketa?draft=${saved.id}`);
 await details.getByRole('link',{name:'Редактировать',exact:true}).focus();await page.keyboard.press('Enter');await page.waitForURL(origin+`/rabota/specialisty/anketa?draft=${saved.id}`);
 await field('description').waitFor();assert.equal(await field('price').inputValue(),'1500');
 const updatedAbout='После редактирования: устанавливаю сантехнику и выполняю ремонт. Согласую сроки и стоимость заранее.';await field('description').fill(updatedAbout);await field('serviceLegalAccepted').check();
 const editedResponse=page.waitForResponse(response=>response.url()===origin+'/api/account/service-publications'&&response.request().method()==='PUT');await form.getByRole('button',{name:'Сохранить анкету',exact:true}).click();assert.equal((await editedResponse).status(),200);assert.equal(savedWrites.length,2);const edited=savedWrites.at(-1);assert.equal(edited.id,saved.id);assert.equal(edited.revision,(BigInt(saved.revision)+1n).toString());
 await page.waitForURL(origin+'/cabinet/specialist');await details.getByText(updatedAbout,{exact:true}).waitFor();
 const duplicateResponse=await context.request.put(origin+'/api/account/service-publications',{headers,data:{action:'create',kind:'specialist',expectedOwnerId:owner,creationKey:randomUUID(),form:{...edited.form,description:'Попытка создать вторую анкету вместо обновления.'}}});assert.equal(duplicateResponse.status(),200);const duplicate=await duplicateResponse.json();assert.equal(duplicate.id,saved.id);assert.equal(duplicate.form.description,updatedAbout);assert.equal(duplicate.revision,edited.revision);
 // Current identity comes from the account even when the saved questionnaire has an earlier name.
 const profileResponse=await context.request.post(origin+'/api/account/profile',{headers,data:{expectedOwnerId:owner}}),profile=await profileResponse.json();
 const avatar='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
 assert.equal((await context.request.put(origin+'/api/account/profile',{headers,data:{expectedOwnerId:owner,expectedRevision:profile.revision,profile:{...profile.profile,name:'Анна-Мария',avatarDataUrl:avatar}}})).status(),200);
 await page.reload();await details.getByRole('heading',{name:'Анна-Мария',exact:true}).waitFor();assert.equal(await details.getByRole('img',{name:'Фото из профиля'}).getAttribute('src'),avatar);
 for(const action of ['list','read']){
  const pattern='**/api/account/service-publications',handler=route=>route.request().postDataJSON()?.action===action?route.fulfill({status:503,json:{error:{code:'SERVICE_PUBLICATIONS_UNAVAILABLE'}}}):route.continue();
  await context.route(pattern,handler);await page.reload();await page.getByRole('button',{name:'Повторить загрузку',exact:true}).waitFor();assert.equal(await form.count(),0);assert.equal(await details.count(),0);
  await context.unroute(pattern,handler);await page.getByRole('button',{name:'Повторить загрузку',exact:true}).click();await details.getByRole('heading',{name:'Анна-Мария',exact:true}).waitFor();
 }
 await responsive(details);
 const db=new pg.Client(localPrimaryDatabaseConfig(state,'owner'));await db.connect();try{assert.equal((await db.query("select count(*)::int as n from app.service_publications where author_id=$1 and kind='specialist' and deleted_at is null",[owner])).rows[0].n,1);}finally{await db.end();}
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
 console.log(JSON.stringify({status:'passed',singleQuestionnaire:true,inlineCreation:true,directDetails:true,editSameId:true,currentProfileIdentity:true,errorRecovery:true,responsive:[320,768,1024,1440],axeSeriousCritical:0,productionTouched:false,paymentCalls:false}));
}finally{await context.close();await browser.close();}
