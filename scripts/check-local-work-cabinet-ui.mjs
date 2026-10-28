// Real local browser and synthetic owner only; no payment/ACL/production writes.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {REGISTRATION_LEGAL_VERSIONS as legal} from '../src/lib/registration-legal.ts';
import {parseWorkPublicationForm} from '../src/lib/work-publication-contract.ts';
import {stateFile,stateDirectory,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
const state=readLocalPrimaryState(stateFile,process.cwd());validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const origin=state.origin,email='work-cards-'+randomUUID()+'@local.invalid',password='SyntheticCards-'+randomUUID()+'!';
const headers={Origin:origin,'Content-Type':'application/json','X-Blizhniy-Request':'1','Sec-Fetch-Site':'same-origin'};
const browser=await chromium.launch({headless:true}),context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.name));
const cardsRequests=[];page.on('request',request=>{if(request.url()===origin+'/api/account/work-cabinet')cardsRequests.push(request.postDataJSON());});
try{
 assert.equal((await context.request.post(origin+'/api/account/register',{headers,data:{name:'Проверка карточек',email,password,captchaToken:'',acceptedAgreement:true,acknowledgedPrivacy:true,agreementVersion:legal.agreement,privacyVersion:legal.privacy}})).status(),202);
 let token;const deadline=Date.now()+10000;
 while(!token&&Date.now()<deadline){
  for(const name of(await readdir(stateDirectory)).filter(name=>/^mail-[a-f0-9-]{36}\.json$/.test(name))){const mail=JSON.parse(await readFile(join(stateDirectory,name),'utf8'));if(mail.to===email)token=mail.text.match(/#token=([a-f0-9]{64})/)?.[1];}
  if(!token)await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.ok(token);assert.equal((await context.request.post(origin+'/api/account/confirm',{headers,data:{token}})).status(),200);
 await page.goto(origin+'/auth');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Пароль',{exact:true}).fill(password);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.waitForURL(origin+'/');
 const session=await context.request.post(origin+'/api/account/session',{headers,data:{}});assert.equal(session.status(),200);const owner=(await session.json()).user.id;
 const pixels=await sharp({create:{width:400,height:300,channels:3,background:'#237c60'}}).webp().toBuffer();
 const upload=await context.request.post(origin+'/api/account/media',{headers:{...headers,'Content-Type':'image/webp','X-Blizhniy-Owner':owner,'X-Blizhniy-Intent':randomUUID()},data:pixels});
 assert.equal(upload.status(),200);const photo=await upload.json();let latest;
 for(let index=1;index<=21;index++){
  const form=parseWorkPublicationForm('vacancy',{kind:'vacancy',title:'Карточка вакансии — '+index,description:'Синтетическая проверка компактных карточек.',
   cityName:'Краснодар',district:'Центральный',professionName:'Сантехник',salary:'65000.50',employerType:'person',organization:'Мастерская',
   schedule:'5/2',workFormat:'На месте',contactPhone:'+79991234567',placementRightConfirmed:true,photoIds:index===21?[photo.id]:[]});
  const response=await context.request.put(origin+'/api/account/work-publications',{headers,data:{action:'create',expectedOwnerId:owner,kind:'vacancy',creationKey:randomUUID(),form}});
  assert.equal(response.status(),200);latest=await response.json();
 }
 await page.goto(origin+'/cabinet/vakansii');
 const region=page.getByRole('region',{name:'Список вакансий',exact:true});await region.waitFor();
 assert.equal(await region.getByRole('article').count(),20);assert.equal(await page.getByRole('button',{name:'Обновить список',exact:true}).count(),0);
 const metrics=await region.evaluate(element=>({overflow:getComputedStyle(element).overflowY,client:element.clientHeight,total:element.scrollHeight}));
 assert.equal(metrics.overflow,'auto');assert.ok(metrics.total>metrics.client);assert.equal(cardsRequests.length,1);
 const card=region.getByRole('article').filter({has:page.getByRole('button',{name:latest.form.title,exact:true})});
 for(const text of ['Мастерская','Краснодар','Центральный','5/2','На месте','Черновик'])assert.ok((await card.innerText()).includes(text),text);
 const image=card.locator('img');await image.waitFor();await image.evaluate(img=>img.complete&&img.naturalWidth>0?true:new Promise((resolve,reject)=>{img.addEventListener('load',()=>resolve(true),{once:true});img.addEventListener('error',()=>reject(Error('Private card photo failed')),{once:true});}));
 const frame=await card.locator('[data-work-photo-frame]').boundingBox();assert.ok(Math.abs(frame.width/frame.height-4/3)<0.03);
 await page.screenshot({path:'/tmp/blizhniy-work-cabinet-desktop.png',fullPage:true});
 for(const width of [320,768,1024,1440]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/blizhniy-work-cabinet-mobile.png',fullPage:true});await page.setViewportSize({width:1440,height:1000});
 await card.getByRole('button',{name:'Подробнее: '+latest.form.title,exact:true}).click();
 await page.getByRole('region',{name:'Сведения о публикации',exact:true}).waitFor();
 assert.equal(await page.locator('main form:visible').count(),0,'Details does not embed another editor');
 await card.getByRole('link',{name:'Редактировать',exact:true}).click();await page.waitForURL(origin+'/rabota/vakansii/'+latest.id+'/edit');
 const editor=page.getByRole('region',{name:'Редактор публикации',exact:true});await editor.waitFor();
 await editor.locator('input[name=organization]:visible').fill('Мастерская после изменения');
 const before=cardsRequests.length;
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await editor.waitFor();
 await editor.locator('input[name=organization]:visible').waitFor();assert.equal(await editor.locator('input[name=organization]:visible').inputValue(),'Мастерская после изменения');assert.equal(cardsRequests.length,before);
 await editor.getByRole('button',{name:'Продолжить к вакансии',exact:true}).click();
 for(const checkbox of await editor.locator('input[type=checkbox]:visible').all())await checkbox.check();
 const saved=page.waitForResponse(response=>response.url()===origin+'/api/account/work-publications'&&response.request().method()==='PUT');
 await editor.getByRole('button',{name:'Сохранить черновик',exact:true}).click();assert.equal((await saved).status(),200);
 await page.waitForURL(origin+'/cabinet/vakansii');
 await card.getByText('Мастерская после изменения',{exact:true}).waitFor();assert.equal(cardsRequests.length,before+1,'Save returns to cabinet with one fresh list read, not polling');
 await page.getByRole('button',{name:'Следующая страница',exact:true}).click();await region.getByRole('button',{name:'Карточка вакансии — 1',exact:true}).waitFor();assert.equal(await region.getByRole('article').count(),1);
 let fail=true;await page.route('**/api/account/work-cabinet',async route=>{if(fail){fail=false;await route.fulfill({status:503,json:{error:{code:'WORK_PUBLICATIONS_UNAVAILABLE'}}});}else await route.continue();});
 await page.reload();await page.getByRole('button',{name:'Повторить загрузку',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Обновить список',exact:true}).count(),0);
 await page.getByRole('button',{name:'Повторить загрузку',exact:true}).click();await region.waitFor();assert.equal(await page.getByRole('button',{name:'Повторить загрузку',exact:true}).count(),0);
 const denied=await context.request.post(origin+'/api/account/work-cabinet',{headers,data:{kind:'vacancy',expectedOwnerId:randomUUID(),after:null}});assert.equal(denied.status(),404);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({status:'passed',cards:20,pagination:true,boundedScroll:true,privateCover:true,ownerSaveUpdatesCard:true,focusKeepsEditor:true,errorOnlyRetry:true,responsive:[320,768,1024,1440],realCharges:false,productionTouched:false}));
}finally{await browser.close();}
