// Synthetic local fixture only: exercises the current admin cards and every saved photo.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {stateFile,stateDirectory,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
const state=readLocalPrimaryState(stateFile,process.cwd());
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const accounts=JSON.parse(await readFile(join(stateDirectory,'accounts.json'),'utf8'));
const browser=await chromium.launch({headless:true});
const userContext=await browser.newContext({ignoreHTTPSErrors:true}),adminContext=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}});
const page=await userContext.newPage(),admin=await adminContext.newPage(),errors=[];
page.on('pageerror',error=>errors.push(error.name));admin.on('pageerror',error=>errors.push(error.name));
const origin=state.origin,title='Проверка всех фото — '+randomUUID().slice(0,8);
const headers={Origin:origin,'Content-Type':'application/json','X-Blizhniy-Request':'1','Sec-Fetch-Site':'same-origin'};
async function login(page,role){const account=accounts.find(item=>item.role===role);await page.goto(origin+'/auth');await page.getByLabel('Email',{exact:true}).fill(account.email);await page.getByLabel('Пароль',{exact:true}).fill(account.password);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.waitForURL(origin+'/');return account;}
async function rpc(context,data,method='POST',path='/api/admin/listing-management'){
 const response=await context.request.fetch(origin+path,{method,headers,data});assert.equal(response.status(),200);return response.json();
}
try{
 const user=await login(page,'user');
 const draft=await rpc(userContext,{expectedOwnerId:user.id,creationKey:randomUUID()},'PUT','/api/account/listing-drafts/collection');
 const photos=[];
 for(let index=0;index<9;index++){
  const bytes=await sharp({create:{width:640,height:480,channels:3,background:{r:40+index*20,g:80+index*10,b:200-index*15}}}).webp().toBuffer();
  const response=await userContext.request.post(origin+'/api/account/media',{headers:{...headers,'Content-Type':'image/webp','X-Blizhniy-Owner':user.id,'X-Blizhniy-Intent':randomUUID()},data:bytes});
  assert.equal(response.status(),200);photos.push(await response.json());
 }
 await rpc(userContext,{expectedOwnerId:user.id,listingId:draft.id,expectedRevision:draft.revision,form:{kind:'prodam',title,description:'Синтетическое объявление: девять различных фотографий для локальной проверки галереи администратора.',price:'3500.00',categorySlug:'otdyh',subcategoryName:null,cityName:'Краснодар',district:'Центральный',address:null,latitude:null,longitude:null,showExactAddress:false,contactPhone:'+79990000000',messengerUrl:null,booking:null,photoIds:photos.map(photo=>photo.id)}},'PUT','/api/account/listing-form');
 const actor=await login(admin,'admin');
 const denied=await userContext.request.post(origin+'/api/admin/listing-management',{headers,data:{expectedAdminId:actor.id,action:'photo',listingId:draft.id,fileId:photos[0].id}});
 assert.equal(denied.status(),403,'Ordinary owner cannot use the administrative image reader');
 const listing=await rpc(adminContext,{expectedAdminId:actor.id,action:'list',after:null});
 const summary=listing.items.find(item=>item.id===draft.id);assert.ok(summary);assert.equal(summary.card.coverPhotoId,photos[0].id);assert.equal(summary.card.price,'3500.00');
 const inspected=await rpc(adminContext,{expectedAdminId:actor.id,action:'inspect',listingId:draft.id});
 assert.deepEqual(inspected.snapshot.photos.map(photo=>photo.id),photos.map(photo=>photo.id),'Inspect retains every saved photograph in order');
 await admin.goto(origin+'/admin/obyavleniya');
 const card=admin.getByRole('article').filter({has:admin.getByRole('heading',{name:title,exact:true})});
 const cover=card.getByRole('img',{name:title,exact:true});await cover.waitFor();await cover.evaluate(image=>image.decode());
 await admin.screenshot({path:'/tmp/blizhniy-admin-cards.png',fullPage:true});
 for(const width of [320,768,1024,1440]){
  await admin.setViewportSize({width,height:1000});
  assert.equal(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No horizontal page overflow at '+width);
  const dimensions=await admin.locator('[aria-label="Все объявления"] article').evaluateAll(cards=>cards.map(card=>{const box=card.getBoundingClientRect();return{w:box.width,h:box.height};}));
  assert.ok(dimensions.every(box=>Math.abs(box.w-dimensions[0].w)<1&&Math.abs(box.h-dimensions[0].h)<1),'Uniform card dimensions at '+width);
 }
 await card.getByRole('button',{name:'Открыть объявление: '+title,exact:true}).click();
 const detail=admin.getByRole('region',{name:'Управление объявлением'});
 for(let index=0;index<photos.length;index++){
  const image=detail.getByRole('img',{name:`Фотография ${index+1} из ${photos.length}`,exact:true});
  await image.waitFor();await image.evaluate(image=>image.decode());
  const pixel=await image.evaluate(image=>{const canvas=document.createElement('canvas');canvas.width=1;canvas.height=1;const context=canvas.getContext('2d');context.drawImage(image,0,0,1,1);return Array.from(context.getImageData(0,0,1,1).data);});
  assert.ok(Math.abs(pixel[0]-(40+index*20))<8&&Math.abs(pixel[1]-(80+index*10))<8&&Math.abs(pixel[2]-(200-index*15))<8,'Selected photo has its own pixels, not the previous image');
  const frame=await image.evaluate(image=>({fit:getComputedStyle(image).objectFit,w:image.parentElement.clientWidth,h:image.parentElement.clientHeight}));
  assert.equal(frame.fit,'cover');assert.ok(Math.abs(frame.w/frame.h-4/3)<0.02);
  if(index<photos.length-1)await detail.getByRole('button',{name:'Следующее фото',exact:true}).click();
 }
 await detail.getByRole('button',{name:'Показать фото 9 из 9',exact:true}).waitFor();
 await admin.screenshot({path:'/tmp/blizhniy-admin-gallery.png',fullPage:true});
 await detail.getByRole('button',{name:'Предыдущее фото',exact:true}).click();
 await detail.getByRole('button',{name:'Показать фото 1 из 9',exact:true}).click();
 await detail.getByRole('img',{name:'Фотография 1 из 9',exact:true}).waitFor();
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({status:'passed',allNinePhotos:true,cardCover:true,uniformCards:true,responsive:[320,768,1024,1440],ordinaryUserDenied:true,productionTouched:false,realPayments:false,syntheticListingRetained:true}));
}finally{await browser.close();}
