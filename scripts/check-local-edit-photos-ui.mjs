// Owned local stand and isolated browser only. Synthetic media/drafts; no payment or production writes.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {REGISTRATION_LEGAL_VERSIONS as legal} from '../src/lib/registration-legal.ts';
import {parseWorkPublicationForm} from '../src/lib/work-publication-contract.ts';
import {parseServicePublicationForm} from '../src/lib/service-publication-contract.ts';
import {stateFile,stateDirectory,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';

const state=readLocalPrimaryState(stateFile,process.cwd());
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const origin=state.origin,email='edit-photos-'+randomUUID()+'@local.invalid',password='SyntheticPhotos-'+randomUUID()+'!';
const headers={Origin:origin,'Content-Type':'application/json','X-Blizhniy-Request':'1','Sec-Fetch-Site':'same-origin'};
const requestedKind=process.argv.find(argument=>argument.startsWith('--kind='))?.slice('--kind='.length);
if(requestedKind)assert.ok(['workRequest','vacancy','specialist','fair','listing'].includes(requestedKind),'Unknown explicit focused kind');
const accessibilityOnly=process.argv.includes('--accessibility-only');
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',viewport:{width:1440,height:1000}});
const page=await context.newPage(),errors=[],mediaFailures=[];
page.setDefaultTimeout(15000);
page.on('pageerror',error=>errors.push(error.name));
page.on('response',response=>{if(new URL(response.url()).pathname==='/api/account/media/read'&&response.status()!==200)mediaFailures.push(response.status());});

async function api(path,method,data){
 const response=await context.request.fetch(origin+path,{method,headers,data});
 assert.equal(response.status(),200,`${method} ${path} returned ${response.status()}`);
 return response.json();
}
const image=background=>sharp({create:{width:400,height:300,channels:3,background}}).png().toBuffer();
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function photoBytes(owner,fileId){
 const response=await context.request.post(origin+'/api/account/media/read',{headers,data:{expectedOwnerId:owner,fileId}});
 assert.equal(response.status(),200);return response.body();
}
async function completeImage(locator){
 await locator.waitFor();
 assert.equal(await locator.evaluate(img=>img.complete&&img.naturalWidth>0?true:new Promise(resolve=>{
  img.addEventListener('load',()=>resolve(img.naturalWidth>0),{once:true});
  img.addEventListener('error',()=>resolve(false),{once:true});
 })),true,'Private preview must decode');
}
async function countPhotos(form,count,max){await form.getByText(`${count}/${max}`,{exact:true}).waitFor();}
async function reveal(kind){
 if(kind==='vacancy')await page.getByRole('button',{name:'Продолжить к вакансии',exact:true}).click();
 await page.locator('form input[name=title]:visible').waitFor();
}
async function colorAt(bytes){
 const pixel=await sharp(bytes).resize(1,1).removeAlpha().raw().toBuffer();
 return Array.from(pixel);
}
async function assertColor(bytes,color){
 const actual=await colorAt(bytes);assert.ok(actual.every((value,index)=>Math.abs(value-color[index])<12),`Photo color/order changed: ${actual}`);
}
async function accessibility(selector){
 await page.addScriptTag({path:createRequire(import.meta.url).resolve('axe-core/axe.min.js')});
 const violations=await page.evaluate(async target=>{
  const report=await window.axe.run(document.querySelector(target),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});
  return report.violations.filter(violation=>['serious','critical'].includes(violation.impact)).map(violation=>({id:violation.id,nodes:violation.nodes.map(node=>({target:node.target,summary:node.failureSummary}))}));
 },selector);
 assert.deepEqual(violations,[],`${selector} serious/critical accessibility violations`);
}

try{
 assert.equal((await context.request.post(origin+'/api/account/register',{headers,data:{name:'Проверка фото редактора',email,password,captchaToken:'',acceptedAgreement:true,acknowledgedPrivacy:true,agreementVersion:legal.agreement,privacyVersion:legal.privacy}})).status(),202);
 let token;const deadline=Date.now()+10000;
 while(!token&&Date.now()<deadline){
  for(const filename of(await readdir(stateDirectory)).filter(name=>/^mail-[a-f0-9-]{36}\.json$/.test(name))){
   const mail=JSON.parse(await readFile(join(stateDirectory,filename),'utf8'));
   if(mail.to===email)token=mail.text.match(/#token=([a-f0-9]{64})/)?.[1];
  }
  if(!token)await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.ok(token,'Synthetic confirmation captured only on the local stand');
 assert.equal((await context.request.post(origin+'/api/account/confirm',{headers,data:{token}})).status(),200);
 await page.goto(origin+'/auth');
 await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Пароль',{exact:true}).fill(password);
 await page.getByRole('button',{name:'Войти',exact:true}).click();await page.waitForURL(origin+'/');
 const owner=(await api('/api/account/session','POST',{})).user.id;
 const sourceColors=[[210,35,35],[35,180,55],[35,65,210]],media=[];
 for(const color of sourceColors){
  const response=await context.request.post(origin+'/api/account/media',{headers:{...headers,'Content-Type':'image/png','X-Blizhniy-Owner':owner,'X-Blizhniy-Intent':randomUUID()},data:await image({r:color[0],g:color[1],b:color[2]})});
  assert.equal(response.status(),200);media.push(await response.json());
 }
 const originalDigests=await Promise.all(media.map(async photo=>digest(await photoBytes(owner,photo.id))));
 const extra=await image({r:230,g:140,b:30});
 const definitions=[
  {kind:'workRequest',max:6,cabinet:'/cabinet/zakazy',edit:id=>'/rabota/zakazy/'+id+'/edit'},
  {kind:'vacancy',max:12,cabinet:'/cabinet/vakansii',edit:id=>'/rabota/vakansii/'+id+'/edit'},
  {kind:'specialist',max:12,cabinet:'/cabinet/specialist',edit:id=>'/rabota/specialisty/anketa?draft='+id},
  {kind:'fair',max:10,cabinet:'/cabinet/fair-applications',edit:id=>'/yarmarka-masterov/zayavka?draft='+id},
  {kind:'listing',max:20,cabinet:'/cabinet/obyavleniya',edit:id=>'/razmestit/obyavlenie?draft='+id},
 ];
 const selected=requestedKind?definitions.filter(definition=>definition.kind===requestedKind):definitions;
 for(const definition of selected){
  const {kind,max}=definition,work=['vacancy','workRequest'].includes(kind),listing=kind==='listing';
  const title='Проверка фото '+kind+' '+randomUUID().slice(0,8);
  const endpoint=listing?'/api/account/listing-form':work?'/api/account/work-publications':'/api/account/service-publications';
  const common={kind,title,description:'Синтетическое описание проверки редактирования сохранённых фотографий.',cityName:'Краснодар',district:'Центральный',contactPhone:'+79991234567',messengerUrl:'@synthetic_photos',photoIds:media.map(photo=>photo.id),placementRightConfirmed:true};
  let saved;
  if(listing){
   const draft=await api('/api/account/listing-drafts/collection','PUT',{expectedOwnerId:owner,creationKey:randomUUID()});
   saved=await api(endpoint,'PUT',{expectedOwnerId:owner,listingId:draft.id,expectedRevision:draft.revision,form:{kind:'prodam',title,description:common.description,cityName:common.cityName,district:common.district,contactPhone:common.contactPhone,photoIds:common.photoIds,price:'3500.00',categorySlug:'otdyh',subcategoryName:null,address:null,latitude:null,longitude:null,showExactAddress:false,messengerUrl:null,booking:null}});
  }else{
   const form=work?parseWorkPublicationForm(kind,{...common,professionName:'Сантехник',...(kind==='vacancy'?{salary:'65000.50',employerType:'person',organization:'Частный работодатель',schedule:'5/2',workFormat:'На месте'}:{budget:'4500.50'})}):
    parseServicePublicationForm(kind,{...common,email:'photo@example.invalid',...(kind==='fair'?{category:'Мебель',comment:'Синтетический комментарий'}:{professionName:'Сантехник',price:'1500.50',skills:'Ремонт сантехники',experience:'Тестовый опыт'})});
   saved=await api(endpoint,'PUT',{action:'create',expectedOwnerId:owner,kind,creationKey:randomUUID(),form});
  }
  let writes=0;const countWrites=request=>{if(request.method()==='PUT'&&request.url()===origin+endpoint||request.method()==='POST'&&request.url()===origin+'/api/account/media')writes++;};
  page.on('request',countWrites);
  let releaseRed,readRed,redReleased=false,greenFailed=false;
  const redGate=new Promise(resolve=>{releaseRed=()=>{redReleased=true;resolve();};});
  const redFinished=new Promise(resolve=>{readRed=resolve;});
  const fault=async route=>{
   const id=route.request().postDataJSON()?.fileId;
   if(id===media[0].id&&!redReleased){await redGate;const response=await route.fetch();await route.fulfill({response});readRed();}
   else if(id===media[1].id&&!greenFailed){greenFailed=true;await route.fulfill({status:503,json:{error:{code:'MEDIA_BUSY'}}});}
   else await route.continue();
  };
  if(kind==='workRequest'&&!accessibilityOnly)await page.route('**/api/account/media/read',fault);
  await page.goto(origin+definition.edit(saved.id));await reveal(kind);
  const form=page.locator('form').filter({has:page.locator('input[name=title]')});
  const editor=form.locator('section').filter({has:page.locator('input[type=file][name=photos]')});
  const figures=editor.locator('figure'),input=editor.locator('input[type=file][name=photos]');
  await countPhotos(form,3,max);assert.equal(await input.count(),1);assert.equal(await form.getByText(/Оставить фото/).count(),0);
  if(kind==='workRequest'&&!accessibilityOnly){
   await form.getByText('Превью недоступно. Фото сохранено.',{exact:true}).waitFor();
   assert.equal(await form.locator(`input[name=keepPhotoIds][value="${media[1].id}"]`).count(),1,'Preview failure must retain the saved media ID');
   await editor.getByRole('button',{name:'Убрать Фото 1',exact:true}).click();await countPhotos(form,2,max);
   releaseRed();await redFinished;await editor.getByRole('button',{name:'Вернуть фото',exact:true}).click();await countPhotos(form,3,max);
   await completeImage(figures.filter({has:page.getByRole('button',{name:'Убрать Фото 1',exact:true})}).locator('img'));
   await editor.getByRole('button',{name:'Повторить загрузку фото',exact:true}).click();
   await page.unroute('**/api/account/media/read',fault);
  }
  for(const figure of await figures.all())await completeImage(figure.locator('img'));
  await accessibility('main form');
  if(accessibilityOnly){
   await page.screenshot({path:`/tmp/blizhniy-edit-photos-${kind}-a11y-desktop.png`,fullPage:true});
   await page.setViewportSize({width:390,height:844});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.screenshot({path:`/tmp/blizhniy-edit-photos-${kind}-a11y-mobile.png`,fullPage:true});
   await page.setViewportSize({width:1440,height:1000});
   page.off('request',countWrites);
   console.log(JSON.stringify({kind,status:'passed',accessibilityOnly:true,seriousOrCritical:0,responsive:true}));
   continue;
  }
  const orderInput=form.locator('input[name=photoOrder]'),initialOrder=await orderInput.inputValue();
  const second=figures.filter({has:page.getByRole('button',{name:'Убрать Фото 2',exact:true})});
  await second.getByRole('button',{name:/Изменить кадр/}).click();
  await page.getByRole('dialog',{name:'Кадр для карточки',exact:true}).waitFor();
  await page.getByRole('dialog').getByRole('button',{name:'Закрыть редактор фото',exact:true}).click();
  assert.equal(await orderInput.inputValue(),initialOrder,'Cancel leaves the saved order unchanged');
  assert.equal(await input.evaluate(element=>element.files.length),0,'Cancel must not create a replacement file');
  await second.getByRole('button',{name:/Изменить кадр/}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Применить',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  assert.deepEqual(JSON.parse(await orderInput.inputValue()),[{savedId:media[0].id},{uploadIndex:0},{savedId:media[2].id}],'Cropped saved photo is replaced in its original position');
  assert.equal(await input.evaluate(element=>element.files.length),1);
  await editor.getByRole('button',{name:'Убрать Фото 1',exact:true}).click();await countPhotos(form,2,max);
  await editor.getByRole('button',{name:'Вернуть фото',exact:true}).click();await countPhotos(form,3,max);
  await input.setInputFiles({name:'new-orange.png',mimeType:'image/png',buffer:extra});await countPhotos(form,4,max);
  await editor.getByRole('button',{name:'Сделать обложкой Фото 3',exact:true}).click();
  assert.deepEqual(JSON.parse(await orderInput.inputValue()),[{savedId:media[2].id},{savedId:media[0].id},{uploadIndex:0},{uploadIndex:1}]);
  if(kind==='workRequest'){
   const filler=await image({r:100,g:100,b:100});
   await input.setInputFiles([{name:'temporary-1.png',mimeType:'image/png',buffer:filler},{name:'temporary-2.png',mimeType:'image/png',buffer:filler}]);await countPhotos(form,6,max);
   await input.setInputFiles({name:'over-capacity.png',mimeType:'image/png',buffer:filler});await countPhotos(form,6,max);
   assert.equal(await input.evaluate(element=>element.files.length),4,'Saved media consumes capacity; over-limit selection does not alter pending files');
   await editor.getByRole('button',{name:'Убрать temporary-1.png',exact:true}).click();await editor.getByRole('button',{name:'Убрать temporary-2.png',exact:true}).click();await countPhotos(form,4,max);
   assert.equal(await form.getByText('Можно добавить не больше 6 фото.',{exact:true}).count(),0,'Removing photos below capacity clears the stale full-limit warning');
   let fail=true;const unavailable=async route=>fail?route.fulfill({status:503,json:{error:{code:'ACCOUNT_UNAVAILABLE'}}}):route.continue();
   await page.route('**/api/account/session',unavailable);
   const failed=page.waitForResponse(response=>response.url()===origin+'/api/account/session'&&response.status()===503);
   await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await failed;await form.waitFor({state:'hidden'});
   fail=false;await page.getByRole('button',{name:/Повторить проверку (входа|доступа)/}).first().click();await form.waitFor({state:'visible'});
   await countPhotos(form,4,max);assert.equal(await input.evaluate(element=>element.files.length),2,'Session recheck preserves pending replacement and new photo files');
   await page.unroute('**/api/account/session',unavailable);
  }
  assert.equal(writes,0,'Adding, cropping, removing, undo and cover selection must not autosave or mutate media');
  await page.screenshot({path:`/tmp/blizhniy-edit-photos-${kind}-desktop.png`,fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:`/tmp/blizhniy-edit-photos-${kind}-mobile.png`,fullPage:true});await page.setViewportSize({width:1440,height:1000});
  for(const name of listing?['placementRightsAccepted','publicOfferAccepted']:['placementRightConfirmed',work?'workLegalAccepted':'serviceLegalAccepted']){
   const checkbox=form.locator(`input[name="${name}"]`);if(await checkbox.count())await checkbox.check();
  }
  const savedResponse=page.waitForResponse(response=>response.url()===origin+endpoint&&response.request().method()==='PUT');
  await form.getByRole('button',{name:'Сохранить черновик',exact:true}).click();
  const response=await savedResponse;assert.equal(response.status(),200);await page.waitForURL(origin+definition.cabinet);
  page.off('request',countWrites);
  const latest=await api(endpoint,'POST',listing?{expectedOwnerId:owner,listingId:saved.id}:{action:'read',expectedOwnerId:owner,kind,publicationId:saved.id});
  const latestPhotos=listing?(await api('/api/account/listing-photos','POST',{expectedOwnerId:owner,listingId:saved.id})).photos:latest.photos;
  assert.equal(latestPhotos.length,4);assert.deepEqual(latestPhotos.slice(0,2).map(photo=>photo.id),[media[2].id,media[0].id]);
  assert.notEqual(latestPhotos[2].id,media[1].id,'Crop writes a new media record rather than mutating the original saved media');
  await assertColor(await photoBytes(owner,latestPhotos[2].id),sourceColors[1]);
  await assertColor(await photoBytes(owner,latestPhotos[3].id),[230,140,30]);
  for(let index=0;index<media.length;index++)assert.equal(digest(await photoBytes(owner,media[index].id)),originalDigests[index],'Original normalized bytes remain immutable');
  await page.goto(origin+definition.edit(saved.id));await reveal(kind);await countPhotos(page.locator('main'),4,max);
  const denied=await context.request.post(origin+'/api/account/media/read',{headers,data:{expectedOwnerId:randomUUID(),fileId:media[0].id}});
  assert.equal(denied.status(),409,'Media cannot be read under a foreign owner scope');
  console.log(JSON.stringify({kind,status:'passed',unifiedSavedAndNewCount:true,cancelNoChange:true,cropInPlace:true,removeUndo:true,coverOrder:true,noAutosave:true,persistedOrder:true,immutableOriginals:true,foreignOwnerDenied:true}));
 }
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({status:'passed',kinds:selected.length,realCharges:false,productionTouched:false}));
}catch(error){
 console.error(JSON.stringify({diagnostic:'edit-photo-browser',mediaFailures,path:new URL(page.url()).pathname}));
 await page.screenshot({path:'/tmp/blizhniy-edit-photos-failure.png',fullPage:true});
 throw error;
}finally{await browser.close();}
