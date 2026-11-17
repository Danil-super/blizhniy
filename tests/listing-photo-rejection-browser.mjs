// Owned built loopback page; account/media/draft transports are synthetic and never write SQL.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {stateFile,docker} from '../scripts/local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from '../scripts/local-primary-config.mjs';
import {parseListingFormDraft} from '../src/lib/listing-form-contract.ts';
import {createDefaultCabinetProfile} from '../src/lib/cabinet-profile.ts';
import {parseWorkPublicationForm} from '../src/lib/work-publication-contract.ts';

test('rejected photo upload unlocks crop/removal and permits correcting the draft without creating it twice',{timeout:45000},async()=>{
 const state=readLocalPrimaryState(stateFile,process.cwd());
 validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
 assert.equal(state.origin,'https://127.0.0.1:3045');
 const owner='12345678-1234-4321-8765-123456789abc',id='22345678-1234-4321-8765-123456789abc';
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block'}),page=await context.newPage();
  page.setDefaultTimeout(10000);
  const errors=[],foreign=[],mediaIntents=[];let creates=0,writes=0,rejectMedia=true,saved=null;
  page.on('pageerror',()=>errors.push('pageerror'));
  const pixels=await sharp({create:{width:400,height:300,channels:3,background:'#0875d1'}}).png().toBuffer();
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(['http:','https:'].includes(url.protocol)&&url.origin!==state.origin){foreign.push(url.host);return route.abort();}
   if(!url.pathname.startsWith('/api/account/'))return route.continue();
   assert.equal(request.headers().authorization,undefined);
   if(url.pathname==='/api/account/session')return route.fulfill({json:{user:{id:owner,email:'fixture@example.invalid',role:'user',isBlocked:false}}});
   if(url.pathname==='/api/account/profile')return route.fulfill({json:{exists:false,profile:createDefaultCabinetProfile({name:'Проверка фотографии',email:'fixture@example.invalid'}),revision:null}});
   if(url.pathname==='/api/account/media'){
    mediaIntents.push(request.headers()['x-blizhniy-intent']);
    if(rejectMedia)return route.fulfill({status:422,json:{error:{code:'INVALID_INPUT'}}});
    return route.fulfill({json:{id:request.headers()['x-blizhniy-intent'],mimeType:'image/webp',width:400,height:300,size:100}});
   }
   const body=request.postDataJSON();assert.equal(body.expectedOwnerId,owner);
   if(url.pathname==='/api/account/listing-drafts/collection'){
    if(request.method()==='POST')return route.fulfill({json:{items:[],nextCursor:null}});
    assert.equal(request.method(),'PUT');creates++;saved={id,revision:'1',form:parseListingFormDraft({kind:'prodam'}),photos:[]};
    return route.fulfill({json:{id,revision:'1',draft:{kind:'prodam',title:'',description:'',price:null,categoryId:null,cityId:null}}});
   }
   if(url.pathname==='/api/account/listing-form'){
    if(request.method()==='POST')return route.fulfill({json:saved});
    assert.equal(request.method(),'PUT');assert.equal(body.listingId,id);assert.equal(body.expectedRevision,saved.revision);writes++;saved={id,revision:'2',form:parseListingFormDraft(body.form),photos:body.form.photoIds.map(id=>({id,mimeType:'image/webp',width:400,height:300,size:100}))};
    return route.fulfill({json:saved});
   }
   if(url.pathname==='/api/account/listings')return route.fulfill({json:{items:[],nextCursor:null,workflow:'postmoderation'}});
   assert.fail('Unexpected account route '+url.pathname);
  });
  await page.goto(state.origin+'/razmestit/obyavlenie');
  await page.locator('input[name=title]').fill('Исправление фотографии');
  await page.locator('input[name=photos]').setInputFiles({name:'first.png',mimeType:'image/png',buffer:pixels});
  await page.getByRole('button',{name:'Удалить файл 1',exact:true}).waitFor();
  await page.locator('input[name=placementRightsAccepted]').check();
  await page.getByRole('button',{name:'Сохранить черновик',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Проверьте файл'}).waitFor();
  assert.equal(creates,1);assert.equal(writes,0);assert.equal(mediaIntents.length,1);
  const remove=page.getByRole('button',{name:'Удалить файл 1',exact:true}),crop=page.getByRole('button',{name:'Кадр',exact:true}).first();
  await page.waitForFunction(()=>document.querySelector('button[aria-label="Удалить файл 1"]')?.disabled===false,null,{timeout:3000});
  assert.equal(await remove.isEnabled(),true,'A definite photo rejection must restore removal controls');
  assert.equal(await crop.isEnabled(),true,'A definite photo rejection must restore crop controls');
  await crop.click();await page.getByRole('dialog',{name:'Кадр для карточки',exact:true}).waitFor();
  await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'Кадр для карточки',exact:true}).waitFor({state:'detached'});
  await remove.click();assert.equal(await page.locator('input[name=photos]').evaluate(input=>input.files.length),0);
  await page.locator('input[name=photos]').setInputFiles({name:'corrected.png',mimeType:'image/png',buffer:pixels});
  await remove.waitFor();
  rejectMedia=false;
  await page.getByRole('button',{name:'Сохранить черновик',exact:true}).click();await page.waitForURL(state.origin+'/cabinet/obyavleniya');
  assert.equal(creates,1,'Correcting a rejected upload reuses the created empty draft');
  assert.equal(writes,1);assert.equal(mediaIntents.length,2);assert.notEqual(mediaIntents[0],mediaIntents[1]);
  assert.equal(saved.form.title,'Исправление фотографии');assert.equal(saved.form.photoIds.length,1);
  assert.deepEqual(errors,[]);assert.deepEqual(foreign,[]);
 }finally{await browser.close();}
});

test('order photo rejection unlocks the form and preserves an earlier successful upload on corrected save',{timeout:45000},async()=>{
 const state=readLocalPrimaryState(stateFile,process.cwd());
 validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
 assert.equal(state.origin,'https://127.0.0.1:3045');
 const owner='12345678-1234-4321-8765-123456789abc',id='22345678-1234-4321-8765-123456789abc';
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block'}),page=await context.newPage();
  page.setDefaultTimeout(10000);const errors=[],foreign=[],uploads=[];let creates=0,saved=null;
  page.on('pageerror',()=>errors.push('pageerror'));
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(['http:','https:'].includes(url.protocol)&&url.origin!==state.origin){foreign.push(url.host);return route.abort();}
   if(url.pathname==='/api/reference/professions')return route.fulfill({json:{items:[{id:'32345678-1234-4321-8765-123456789abc',slug:'santehnik',name:'Сантехник',parent:'Ремонт',active:true}]}});
   if(!url.pathname.startsWith('/api/account/'))return route.continue();
   assert.equal(request.headers().authorization,undefined);
   if(url.pathname==='/api/account/session')return route.fulfill({json:{user:{id:owner,email:'fixture@example.invalid',role:'user',isBlocked:false}}});
   if(url.pathname==='/api/account/profile')return route.fulfill({json:{exists:false,profile:createDefaultCabinetProfile({name:'Проверка фотографий',email:'fixture@example.invalid'}),revision:null}});
   if(url.pathname==='/api/account/media'){
    assert.equal(request.method(),'POST');uploads.push(request.headers()['x-blizhniy-intent']);
    if(uploads.length===2)return route.fulfill({status:422,json:{error:{code:'INVALID_INPUT'}}});
    return route.fulfill({json:{id:uploads.at(-1),mimeType:'image/webp',width:400,height:300,size:100}});
   }
   const body=request.postDataJSON();assert.equal(body.expectedOwnerId,owner);
   if(url.pathname==='/api/account/work-publications'){
    assert.equal(request.method(),'PUT');assert.equal(body.action,'create');assert.equal(body.kind,'workRequest');creates++;
    const form=parseWorkPublicationForm('workRequest',body.form),stamp='2026-11-17T12:00:00.123456Z';
    saved={id,kind:'workRequest',revision:'1',status:'draft',paid:false,form,photos:form.photoIds.map(id=>({id,mimeType:'image/webp',width:400,height:300,size:100})),professionId:form.professionId??null,createdAt:stamp,updatedAt:stamp,publishedAt:null,expiresAt:null};
    return route.fulfill({json:saved});
   }
   if(url.pathname==='/api/account/work-cabinet'){assert.equal(request.method(),'POST');return route.fulfill({json:{items:[],nextCursor:null}});}
   assert.fail('Unexpected account route '+url.pathname);
  });
  await page.goto(state.origin+'/rabota/zakazy/sozdat');
  await page.locator('input[name=title]').fill('Замена второго фото');
  await page.getByRole('combobox',{name:'Профессия / специализация',exact:true}).fill('Сант');await page.getByRole('option',{name:/Сантехник/}).click();
  const first=await sharp({create:{width:400,height:300,channels:3,background:'#0875d1'}}).png().toBuffer();
  const second=await sharp({create:{width:400,height:300,channels:3,background:'#087535'}}).png().toBuffer();
  const file=page.locator('input[type=file][name=photos]');
  await file.setInputFiles([{name:'first.png',mimeType:'image/png',buffer:first},{name:'second.png',mimeType:'image/png',buffer:second}]);
  const secondRemove=page.getByRole('button',{name:'Убрать second.png',exact:true});await secondRemove.waitFor();
  await page.waitForFunction(()=>{const input=document.querySelector('input[type=file][name=photos]');return input?.files?.length===2&&[...input.files].every(file=>file.type==='image/webp')&&!input.disabled;});
  await page.getByRole('button',{name:'Сохранить черновик',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Проверьте файл'}).waitFor();
  assert.equal(uploads.length,2);assert.equal(creates,0,'The order is not created before all photos have uploaded');
  await page.waitForFunction(()=>document.querySelector('button[aria-label="Убрать second.png"]')?.matches(':enabled'),null,{timeout:3000});
  await secondRemove.click();assert.equal(await file.evaluate(input=>input.files.length),1);
  await file.setInputFiles({name:'replacement.png',mimeType:'image/png',buffer:second});
  await page.getByRole('button',{name:'Убрать replacement.png',exact:true}).waitFor();
  await page.waitForFunction(()=>{const input=document.querySelector('input[type=file][name=photos]');return input?.files?.length===2&&!input.disabled;});
  await page.getByRole('button',{name:'Сохранить черновик',exact:true}).click();await page.waitForURL(state.origin+'/cabinet/zakazy');
  assert.equal(creates,1);assert.equal(uploads.length,3,'The successful first photo must not be uploaded a second time');
  assert.deepEqual(saved.form.photoIds,[uploads[0],uploads[2]]);assert.equal(saved.form.title,'Замена второго фото');
  assert.equal(saved.photos.length,2);assert.equal(new Set(uploads).size,3);assert.deepEqual(errors,[]);assert.deepEqual(foreign,[]);
 }finally{await browser.close();}
});
