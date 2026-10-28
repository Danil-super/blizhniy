// Synthetic owned-loopback stand only. Local payment simulator; no production or real charges.
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

const state=readLocalPrimaryState(stateFile,process.cwd());
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const origin=state.origin,email='paid-order-polish-'+randomUUID()+'@local.invalid',password='SyntheticPolish-'+randomUUID()+'!';
const headers={Origin:origin,'Content-Type':'application/json','X-Blizhniy-Request':'1','Sec-Fetch-Site':'same-origin'};
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',viewport:{width:1440,height:1000}});
const page=await context.newPage(),errors=[];
page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.name));
const widths=[320,768,1024,1440];

async function completeImage(locator){
 await locator.waitFor();
 assert.equal(await locator.evaluate(img=>img.complete&&img.naturalWidth>0?true:new Promise(resolve=>{
  img.addEventListener('load',()=>resolve(img.naturalWidth>0),{once:true});
  img.addEventListener('error',()=>resolve(false),{once:true});
 })),true,'Saved image must load');
}
async function accessibility(selector){
 await page.addScriptTag({path:createRequire(import.meta.url).resolve('axe-core/axe.min.js')});
 const violations=await page.evaluate(async target=>{
  const report=await window.axe.run(document.querySelector(target),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});
  return report.violations.filter(item=>['serious','critical'].includes(item.impact)).map(item=>({id:item.id,nodes:item.nodes.map(node=>node.target)}));
 },selector);
 assert.deepEqual(violations,[],`${selector} must have no serious or critical accessibility violations`);
}
async function resize(width){
 await page.setViewportSize({width,height:1000});
 // Responsive header changes and font reflow must finish before comparing boxes.
 await page.evaluate(async()=>{
  await document.fonts.ready;
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 });
}
async function responsive(label){
 for(const width of widths){
  await resize(width);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${label} overflow at ${width}px`);
  await page.screenshot({path:`/tmp/blizhniy-paid-order-${label}-${width}.png`,fullPage:true});
 }
}

try{
 assert.equal((await context.request.post(origin+'/api/account/register',{headers,data:{name:'Локальная проверка заказа',email,password,captchaToken:'',acceptedAgreement:true,acknowledgedPrivacy:true,agreementVersion:legal.agreement,privacyVersion:legal.privacy}})).status(),202);
 let token;const deadline=Date.now()+10000;
 while(!token&&Date.now()<deadline){
  for(const filename of(await readdir(stateDirectory)).filter(name=>/^mail-[a-f0-9-]{36}\.json$/.test(name))){
   const mail=JSON.parse(await readFile(join(stateDirectory,filename),'utf8'));
   if(mail.to===email)token=mail.text.match(/#token=([a-f0-9]{64})/)?.[1];
  }
  if(!token)await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.ok(token,'Only a synthetic local confirmation message is read');
 assert.equal((await context.request.post(origin+'/api/account/confirm',{headers,data:{token}})).status(),200);
 await page.goto(origin+'/auth');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Пароль',{exact:true}).fill(password);
 await page.getByRole('button',{name:'Войти',exact:true}).click();await page.waitForURL(origin+'/');
 const session=await context.request.post(origin+'/api/account/session',{headers,data:{}});assert.equal(session.status(),200);
 const owner=(await session.json()).user.id;
 const readSnapshot=async id=>{
  const response=await context.request.post(origin+'/api/account/work-publications',{headers,data:{action:'read',kind:'workRequest',expectedOwnerId:owner,publicationId:id}});
  assert.equal(response.status(),200);return response.json();
 };

 await page.goto(origin+'/rabota/zakazy/sozdat');
 const title='Проверка вида оплаченного заказа '+randomUUID().slice(0,8),field=name=>page.locator(`input[name=${name}]`);
 await field('title').fill(title);
 const profession=page.getByRole('combobox',{name:'Профессия / специализация',exact:true});
 await profession.fill('сант');await profession.press('ArrowDown');await profession.press('Enter');assert.equal(await profession.inputValue(),'Сантехник');
 await field('budget').fill('3576');await field('phone').fill('+79991234567');
 await page.locator('textarea[name=description]').fill('Синтетический заказ: ремонт ванной и проверка сохранения оплаченной публикации.');
 const portrait=await sharp({create:{width:240,height:400,channels:3,background:'#347ab8'}}).png().toBuffer();
 const landscape=await sharp({create:{width:480,height:240,channels:3,background:'#b87634'}}).png().toBuffer();
 await page.locator('input[name=photos]').setInputFiles([{name:'portrait.png',mimeType:'image/png',buffer:portrait},{name:'landscape.png',mimeType:'image/png',buffer:landscape}]);
 for(const checkbox of await page.locator('form input[type=checkbox]').all())await checkbox.check();
 await page.getByRole('button',{name:'Оплатить',exact:true}).waitFor();
 const createReply=page.waitForResponse(response=>response.url()===origin+'/api/account/work-publications'&&response.request().method()==='PUT');
 await page.getByRole('button',{name:'Сохранить черновик',exact:true}).click();
 const created=await createReply;assert.equal(created.status(),200);const draft=await created.json();
 assert.equal(draft.form.budget,'3576.00');assert.equal(draft.form.photoIds.length,2);assert.equal(draft.paid,false);
 await page.waitForURL(origin+'/cabinet/zakazy');
 await page.goto(origin+'/rabota/zakazy/'+draft.id+'/edit');await field('title').waitFor();
 assert.equal(await field('budget').inputValue(),'3576');await page.getByRole('button',{name:'Сохранить черновик',exact:true}).waitFor();
 await page.locator('input[name=workLegalAccepted]').check();
 await page.getByRole('button',{name:'Оплатить',exact:true}).click();
 await page.waitForURL(/\/oplata\/[a-f0-9-]{36}\?type=workRequest$/);
 assert.equal((await context.request.get(origin+'/rabota/zakazy/'+draft.id)).status(),404);
 await page.getByRole('button',{name:'Открыть локальный симулятор',exact:true}).click();await page.waitForURL(/\/__local\/payment\?intent=.*&type=workRequest$/);
 await page.getByRole('button',{name:'Подтвердить успешную оплату',exact:true}).click();await page.getByText('Оплата подтверждена сервером, размещение выполнено.',{exact:false}).waitFor();
 const paid=await readSnapshot(draft.id);assert.equal(paid.paid,true);assert.equal(paid.status,'published');assert.ok(paid.publishedAt);assert.ok(paid.expiresAt);

 await page.goto(origin+'/rabota/zakazy/'+draft.id+'/edit');await field('title').waitFor();
 const form=page.locator('form').filter({has:page.locator('input[name=title]')});
 const editor=form.locator('section').filter({has:page.locator('input[type=file][name=photos]')});
 await form.getByRole('button',{name:'Сохранить изменения',exact:true}).waitFor();
 assert.equal(await form.getByRole('button',{name:'Сохранить черновик',exact:true}).count(),0);
 assert.equal(await form.getByRole('button',{name:'Оплатить',exact:true}).count(),0);
 assert.doesNotMatch(await form.innerText(),/затем откроем оплату|появится после подтверждения оплаты/);
 assert.equal(await field('budget').inputValue(),'3576');
 await editor.getByText('2/6',{exact:true}).waitFor();
 assert.equal(await editor.getByText('Превью',{exact:true}).count(),0);
 const figures=editor.locator('figure');assert.equal(await figures.count(),2);
 for(const figure of await figures.all()){
  const image=figure.locator('img');await completeImage(image);
  const imageStyle=await image.evaluate(img=>({fit:getComputedStyle(img).objectFit,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight}));
  assert.equal(imageStyle.fit,'contain','Full image, not cropped, must be shown in the editor');
  assert.ok(imageStyle.naturalWidth>0&&imageStyle.naturalHeight>0);
  for(const button of await figure.getByRole('button').all()){
   const imageBox=await image.boundingBox(),buttonBox=await button.boundingBox();assert.ok(imageBox&&buttonBox);
   assert.ok(buttonBox.y>=imageBox.y+imageBox.height-1,'Controls must be below, not obscure, the image');
  }
 }
 assert.deepEqual(await figures.locator('img').evaluateAll(images=>images.map(img=>img.naturalWidth>img.naturalHeight)),[false,true],'Both portrait and landscape fixtures retain their shape');
 await accessibility('main form');await responsive('edit');

 let checkoutRequests=0;page.on('request',request=>{if(new URL(request.url()).pathname==='/api/account/work-request-checkout')checkoutRequests++;});
 const edited=title+' — обновлён';await field('title').fill(edited);await field('budget').fill('3576,50');
 const saveReply=page.waitForResponse(response=>response.url()===origin+'/api/account/work-publications'&&response.request().method()==='PUT');
 await page.getByRole('button',{name:'Сохранить изменения',exact:true}).click();
 const savedResponse=await saveReply;assert.equal(savedResponse.status(),200);const saved=await savedResponse.json();
 assert.equal(saved.form.budget,'3576.50');assert.equal(saved.paid,true);assert.equal(saved.status,'published');
 assert.equal(saved.publishedAt,paid.publishedAt);assert.equal(saved.expiresAt,paid.expiresAt);assert.deepEqual(saved.form.photoIds,paid.form.photoIds);
 await page.waitForURL(origin+'/cabinet/zakazy');assert.equal(checkoutRequests,0,'Paid edits must not start or preview a second payment');
 await page.goto(origin+'/rabota/zakazy/'+draft.id+'/edit');await field('title').waitFor();assert.equal(await field('budget').inputValue(),'3576,50');
 await page.goto(origin+'/rabota/zakazy/'+draft.id);await page.getByRole('heading',{name:edited,exact:true}).waitFor();
 const article=page.locator('article').first();assert.doesNotMatch(await article.innerText(),/Автор заказа/);
 await article.getByText('Сантехник',{exact:true}).waitFor();await article.getByText('3 576,50 ₽',{exact:true}).waitFor();
 const dates=article.locator('dl[aria-label="Даты публикации"]');assert.equal(await dates.locator('time').count(),2);
 assert.equal(Date.parse(await dates.locator('time').first().getAttribute('datetime')),Date.parse(paid.publishedAt));
 assert.ok(Date.parse(await dates.locator('time').nth(1).getAttribute('datetime'))>Date.parse(paid.publishedAt));
 await dates.getByText('Размещено',{exact:true}).waitFor();await dates.getByText('Обновлено',{exact:true}).waitFor();
 const publicImage=article.locator(`img[src*="/api/work-publications/${draft.id}/photos/"]`).first();await completeImage(publicImage);
 for(const width of widths){
  await resize(width);
  const headingBox=await page.getByRole('heading',{name:edited,exact:true}).boundingBox(),photoBox=await publicImage.boundingBox(),professionBox=await article.getByText('Сантехник',{exact:true}).boundingBox();
  assert.ok(headingBox&&photoBox&&professionBox);assert.ok(headingBox.y+headingBox.height<=photoBox.y+1,'Order title must be above the gallery');
  assert.ok(professionBox.y>=headingBox.y+headingBox.height-1,`Profession must follow, not precede, the title: ${JSON.stringify({width,headingBox,professionBox,photoBox})}`);
 }
 await accessibility('main article');await responsive('public');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({status:'passed',paidEditSaveChanges:true,noSecondCheckout:true,integerAmountWithoutFakeDecimals:true,realKopecksRoundTrip:true,fullPortraitAndLandscapePreviews:true,nonOverlayControls:true,titleFirstNoPlaceholderAuthor:true,originalPaidWindowPreserved:true,publishedAndUpdatedDates:true,responsive:widths,axeSeriousCritical:0,realCharges:false,productionTouched:false}));
}catch(error){
 await page.screenshot({path:'/tmp/blizhniy-paid-order-polish-failure.png',fullPage:true});
 throw error;
}finally{await context.close();await browser.close();}
