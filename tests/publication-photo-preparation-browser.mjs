// Owned built loopback pages, synthetic account/catalog responses, unsaved forms only.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes} from 'node:crypto';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {stateFile,docker} from '../scripts/local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from '../scripts/local-primary-config.mjs';
import {createDefaultCabinetProfile} from '../src/lib/cabinet-profile.ts';

const profession={id:'32345678-1234-4321-8765-123456789abc',slug:'master-remonta-kvartir',name:'Мастер ремонта квартир',parent:'Ремонт и строительство',active:true};
async function withPage(work){
 const state=readLocalPrimaryState(stateFile,process.cwd());
 validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
 assert.equal(state.origin,'https://127.0.0.1:3045');
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',viewport:{width:1440,height:1000}}),page=await context.newPage();
  const errors=[],foreign=[],writes=[];page.setDefaultTimeout(10000);page.on('pageerror',()=>errors.push('pageerror'));
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(['http:','https:'].includes(url.protocol)&&url.origin!==state.origin){foreign.push(url.host);return route.abort();}
   if(url.pathname==='/api/reference/professions'){assert.equal(request.method(),'GET');return route.fulfill({json:{items:[profession]}});}
   if(!url.pathname.startsWith('/api/account/'))return route.continue();
   assert.equal(request.method(),'POST','The test only reads account state');assert.equal(request.headers().authorization,undefined);
   if(url.pathname==='/api/account/session')return route.fulfill({json:{user:{id:'12345678-1234-4321-8765-123456789abc',email:'fixture@example.invalid',role:'user',isBlocked:false}}});
   if(url.pathname==='/api/account/profile')return route.fulfill({json:{exists:false,profile:createDefaultCabinetProfile({name:'Проверка фотографии',email:'fixture@example.invalid'}),revision:null}});
   writes.push(url.pathname);return route.fulfill({status:403,json:{error:{code:'FORBIDDEN_TEST_WRITE'}}});
  });
  await work(page,state.origin);
  assert.deepEqual(errors,[]);assert.deepEqual(foreign,[]);assert.deepEqual(writes,[]);
 }finally{await browser.close();}
}

for(const [name,path]of [['listing','/razmestit/obyavlenie'],['workRequest','/rabota/zakazy/sozdat']]){
 test(`${name}: a PNG larger than 10 MiB is prepared automatically and keeps preview/crop usable`,{timeout:45000},async()=>{
  const source=await sharp(randomBytes(2400*2000*3),{raw:{width:2400,height:2000,channels:3}}).png({compressionLevel:0}).toBuffer();
  assert.ok(source.length>10*1024*1024&&source.length<50*1024*1024);
  await withPage(async(page,origin)=>{
   await page.goto(origin+path);const file=page.locator('input[type=file][name=photos]');await file.waitFor({state:'attached'});
   await file.setInputFiles({name:'large-phone-photo.png',mimeType:'image/png',buffer:source});
   await page.waitForFunction(()=>{
    const input=document.querySelector('input[type=file][name=photos]');
    return input?.files?.length===1&&input.files[0].type==='image/webp'&&!input.disabled;
   },null,{timeout:12000});
   const prepared=await file.evaluate(async input=>{
    const file=input.files[0],image=await createImageBitmap(file);
    const result={name:file.name,type:file.type,size:file.size,width:image.width,height:image.height};image.close();return result;
   });
   assert.equal(prepared.name,'large-phone-photo.png');assert.equal(prepared.type,'image/webp');
   assert.ok(prepared.size>0&&prepared.size<=2*1024*1024);assert.ok(Math.max(prepared.width,prepared.height)<=2048);
   assert.ok(Math.abs(prepared.width/prepared.height-2400/2000)<0.002,'Preparation preserves the original aspect ratio');
   const image=page.locator('figure img').first();await image.waitFor();
   await page.waitForFunction(()=>{const img=document.querySelector('figure img');return img?.complete&&img.naturalWidth>0;});
   const hint=page.getByText(/Фото сжимаются автоматически/,{exact:false}).first();await hint.waitFor();
   for(const text of ['JPEG','PNG','WebP','50 МБ','статичный GIF'])assert.ok((await hint.innerText()).includes(text));
   await page.getByRole('button',{name:/^(Кадр|Изменить кадр|Кадр Изменить кадр)$/}).first().click();
   const crop=page.getByRole('dialog',{name:'Кадр для карточки',exact:true});await crop.waitFor();await page.keyboard.press('Escape');await crop.waitFor({state:'detached'});
   assert.equal(await file.evaluate(input=>input.files.length),1,'Canceling crop retains the prepared photo');
  });
 });
}

test('JPEG camera orientation is applied before preparing the photo',{timeout:30000},async()=>{
 const source=await sharp({create:{width:80,height:40,channels:3,background:'#0875d1'}}).jpeg().withMetadata({orientation:6}).toBuffer();
 const fixture=await sharp(source).metadata();assert.equal(fixture.width,80);assert.equal(fixture.height,40);assert.equal(fixture.orientation,6);
 await withPage(async(page,origin)=>{
  await page.goto(origin+'/razmestit/obyavlenie');const file=page.locator('input[type=file][name=photos]');await file.waitFor({state:'attached'});
  await file.setInputFiles({name:'camera-portrait.jpg',mimeType:'image/jpeg',buffer:source});
  await page.waitForFunction(()=>document.querySelector('input[type=file][name=photos]')?.files?.[0]?.type==='image/webp');
  const result=await file.evaluate(async input=>{const image=await createImageBitmap(input.files[0]);const size={width:image.width,height:image.height};image.close();return size;});
  assert.deepEqual(result,{width:40,height:80},'Camera orientation produces the upright portrait, not sideways pixels');
 });
});

test('order professions show Russian category without the technical slug',{timeout:30000},async()=>{
 await withPage(async(page,origin)=>{
  await page.goto(origin+'/rabota/zakazy/sozdat');
  const select=page.getByRole('combobox',{name:'Профессия / специализация',exact:true});
  await select.fill('Мастер');const option=page.getByRole('option',{name:new RegExp(profession.name)});await option.waitFor();
  const text=await option.innerText();assert.ok(text.includes(profession.name));assert.ok(text.includes(profession.parent));assert.equal(text.includes(profession.slug),false);
  await page.screenshot({path:'/tmp/blizhniy-profession-russian-options.png',fullPage:true});
  await option.click();assert.equal(await select.inputValue(),profession.name);assert.equal(await page.locator('input[name=professionId]').inputValue(),profession.id);
 });
});

test('work amount accepts only decimal money and explains the optional empty value',{timeout:30000},async()=>{
 await withPage(async(page,origin)=>{
  await page.goto(origin+'/rabota/zakazy/sozdat');const amount=page.locator('input[name=budget]');await amount.waitFor();
  assert.equal(await amount.inputValue(),'');assert.equal(await amount.evaluate(input=>input.checkValidity()),true);
  for(const value of ['5000','5000,50','5000.50']){await amount.fill(value);assert.equal(await amount.inputValue(),value);assert.equal(await amount.evaluate(input=>input.checkValidity()),true);}
  for(const value of ['1e3','По договоренности','12,345','12.34.56','-1']){
   await amount.fill(value);const actual=await amount.inputValue();assert.notEqual(actual,value);assert.notEqual(actual,'13','Scientific notation must not silently become a different amount');
   assert.match(actual,/^(?:|\d+(?:[.,]\d{0,2})?)$/);
  }
  await amount.fill('');assert.equal(await amount.inputValue(),'');assert.equal(await amount.evaluate(input=>input.checkValidity()),true);
  assert.equal(await amount.getAttribute('placeholder'),'5000');assert.equal(await amount.getAttribute('inputmode'),'decimal');
  await page.getByText('Если сумма не определена, оставьте поле пустым.',{exact:true}).waitFor();
  await amount.locator('..').locator('..').screenshot({path:'/tmp/blizhniy-work-numeric-amount.png'});
 });
});
