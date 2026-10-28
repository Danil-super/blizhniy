// Owned loopback fixture only. Synthetic drafts are retained for manual inspection.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {stateFile,stateDirectory,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
const state=readLocalPrimaryState(stateFile,process.cwd());
assert.equal(state.origin,'https://127.0.0.1:3045','Only the explicitly owned local UI stand is allowed');
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const accounts=JSON.parse(await readFile(join(stateDirectory,'accounts.json'),'utf8'));
const origin=state.origin,headers={Origin:origin,'Content-Type':'application/json','X-Blizhniy-Request':'1','Sec-Fetch-Site':'same-origin'};
const browser=await chromium.launch({headless:true});
const userContext=await browser.newContext({ignoreHTTPSErrors:true}),adminContext=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}});
const user=await userContext.newPage(),admin=await adminContext.newPage(),errors=[];
admin.on('pageerror',error=>errors.push(error.name));user.on('pageerror',error=>errors.push(error.name));
async function login(page,role){const account=accounts.find(item=>item.role===role);await page.goto(origin+'/auth');await page.getByLabel('Email',{exact:true}).fill(account.email);await page.getByLabel('Пароль',{exact:true}).fill(account.password);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.waitForURL(origin+'/');return account;}
async function rpc(context,path,data,method='POST'){const response=await context.request.fetch(origin+path,{method,headers,data});assert.equal(response.status(),200,'Synthetic local request failed: '+path);return response.json();}
try{
 const owner=await login(user,'user'),stamp=randomUUID().slice(0,8),photos=[];
 for(let index=0;index<9;index++){
  const bytes=await sharp({create:{width:640,height:480,channels:3,background:{r:40+index*20,g:80+index*10,b:200-index*15}}}).webp().toBuffer();
  const response=await userContext.request.post(origin+'/api/account/media',{headers:{...headers,'Content-Type':'image/webp','X-Blizhniy-Owner':owner.id,'X-Blizhniy-Intent':randomUUID()},data:bytes});
  assert.equal(response.status(),200);photos.push(await response.json());
 }
 let target;
 // Enough actual cards to overflow the bounded viewport at every desktop grid width.
 for(let index=0;index<6;index++){
  const draft=await rpc(userContext,'/api/account/listing-drafts/collection',{expectedOwnerId:owner.id,creationKey:randomUUID()},'PUT');
  const title=`Проверка отдельной админ-карточки ${stamp} — ${index+1}`;
  await rpc(userContext,'/api/account/listing-form',{expectedOwnerId:owner.id,listingId:draft.id,expectedRevision:draft.revision,form:{kind:'prodam',title,description:'Полное синтетическое описание для проверки отдельной страницы, контактов, галереи и блокировки с причиной.',price:'3500.00',categorySlug:'otdyh',subcategoryName:null,cityName:'Краснодар',district:'Центральный',address:'Тестовая улица, 1',latitude:45.03,longitude:38.97,showExactAddress:false,contactPhone:'+79990000000',messengerUrl:'https://t.me/local_fixture',contactMethod:'messenger',booking:null,photoIds:index===0?photos.map(photo=>photo.id):[]}},'PUT');
  if(index===0)target={id:draft.id,title};
 }
 const actor=await login(admin,'admin');
 const denial=await userContext.request.post(origin+'/api/admin/listing-management',{headers,data:{expectedAdminId:actor.id,action:'inspect',listingId:target.id}});assert.equal(denial.status(),403);
 await admin.goto(origin+'/admin');
 const nav=admin.getByRole('navigation',{name:'Разделы админки',exact:true});await nav.getByRole('link',{name:'Объявления',exact:true}).waitFor();
 assert.equal(await nav.getByRole('link').count(),11);
 assert.equal(await admin.getByRole('main').getByRole('link',{name:'Объявления',exact:true}).count(),1,'No duplicate lower navigation grid in the admin workspace');
 await nav.getByRole('link',{name:'Объявления',exact:true}).click();
 const area=admin.getByRole('region',{name:'Список объявлений',exact:true});await area.waitFor();
 for(const width of [320,768,1024,1440]){
  await admin.setViewportSize({width,height:1000});
  assert.equal(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No page overflow at '+width);
  const box=await area.evaluate(element=>({height:element.clientHeight,scroll:element.scrollHeight,overflow:getComputedStyle(element).overflowY,limit:innerHeight*.65}));
  assert.equal(box.overflow,'auto');assert.ok(box.height<=box.limit+2);assert.ok(box.scroll>box.height,'Actual cards scroll within the bounded area');
 }
 await area.focus();await admin.keyboard.press('End');
 await admin.waitForFunction(()=>document.querySelector('[aria-label="Список объявлений"]').scrollTop>0);
 const card=area.getByRole('article').filter({has:admin.getByRole('heading',{name:target.title,exact:true})});
 let pages=0;
 while(await card.count()===0){
  assert.ok(++pages<=20,'The synthetic target must be found in the bounded server pages');
  const next=admin.getByRole('button',{name:'Следующие объявления',exact:true});assert.equal(await next.count(),1);
  const pending=admin.waitForResponse(response=>response.url().endsWith('/api/admin/listing-management')&&response.request().postDataJSON()?.action==='list');
  await next.click();const response=await pending;assert.equal(response.status(),200);const data=await response.json();
  await area.getByRole('article').first().getByRole('heading',{name:data.items[0].title,exact:true}).waitFor();
 }
 const link=card.getByRole('link',{name:'Открыть объявление: '+target.title,exact:true});
 assert.equal(await link.getAttribute('href'),'/admin/obyavleniya/'+target.id);
 // Enter on a native link must navigate, rather than expand an inline section.
 await link.focus();await admin.keyboard.press('Enter');await admin.waitForURL(origin+'/admin/obyavleniya/'+target.id);
 const detail=admin.getByRole('region',{name:'Управление объявлением',exact:true});await detail.waitFor();
 assert.equal(await admin.getByRole('region',{name:'Список объявлений',exact:true}).count(),0);
 assert.equal(await admin.getByRole('navigation',{name:'Разделы админки'}).getByRole('link').count(),11);
 for(const value of ['Полное синтетическое описание','Тестовая улица, 1','+79990000000','https://t.me/local_fixture','Мессенджер'])assert.ok((await detail.innerText()).includes(value));
 await admin.reload();await detail.waitFor();assert.equal(await detail.getByRole('heading',{name:target.title,exact:true}).count(),1,'Direct refresh restores details by route ID');
 for(let index=0;index<photos.length;index++){
  const image=detail.getByRole('img',{name:`Фотография ${index+1} из ${photos.length}`,exact:true});await image.waitFor();await image.evaluate(image=>image.decode());
  const pixel=await image.evaluate(image=>{const canvas=document.createElement('canvas');canvas.width=1;canvas.height=1;const context=canvas.getContext('2d');context.drawImage(image,0,0,1,1);return Array.from(context.getImageData(0,0,1,1).data);});
  assert.ok(Math.abs(pixel[0]-(40+index*20))<8&&Math.abs(pixel[1]-(80+index*10))<8&&Math.abs(pixel[2]-(200-index*15))<8,'Each saved photo has its own pixels');
  if(index<photos.length-1)await detail.getByRole('button',{name:'Следующее фото',exact:true}).click();
 }
 await admin.screenshot({path:'/tmp/blizhniy-admin-detail-page.png',fullPage:true});
 await detail.getByRole('button',{name:'Заблокировать объявление',exact:true}).click();
 await admin.getByRole('alert').filter({hasText:'Укажите причину'}).waitFor();
 const reason='Локальная проверка отдельной карточки: нарушение правил.';
 await detail.getByLabel('Причина блокировки',{exact:true}).fill(reason);
 let blocks=0,reads=0,loseRead=false;
 await admin.route('**/api/admin/listing-management',async route=>{
  const body=route.request().postDataJSON();
  if(body.action==='block'){blocks++;assert.equal(body.reason,reason);assert.equal(body.expectedAdminId,actor.id);const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed');return;}
  if(body.action==='inspect'){reads++;if(loseRead){loseRead=false;await route.abort('failed');return;}}
  await route.continue();
 });
 await detail.getByRole('button',{name:'Заблокировать объявление',exact:true}).click();
 await admin.getByRole('alert').filter({hasText:'Результат не подтверждён'}).waitFor();
 assert.equal(await detail.getByRole('button',{name:'Заблокировать объявление',exact:true}).isDisabled(),true);
 assert.equal(await detail.getByLabel('Причина блокировки',{exact:true}).inputValue(),reason);
 assert.equal(blocks,1);assert.equal(reads,0,'Unknown writes are not retried or read back implicitly');
 let releaseSession;
 const sessionBarrier=new Promise(resolve=>{releaseSession=resolve;});
 const sessionRoute=async route=>{await sessionBarrier;await route.continue();};
 await admin.route('**/api/account/session',sessionRoute);
 const otherTab=await adminContext.newPage();await otherTab.goto(origin+'/');await otherTab.bringToFront();
 const rechecking=admin.waitForRequest(request=>request.url().endsWith('/api/account/session'));
 // Headless tabs do not reliably emit an OS focus event. Exercise the public
 // lifecycle listener with Playwright's ordinary bubbling focus event instead.
 await admin.bringToFront();await admin.locator('body').dispatchEvent('focus');await rechecking;await detail.waitFor({state:'hidden'});
 assert.equal(await admin.getByText(reason,{exact:true}).count(),0,'Private pending details are hidden during a session recheck');
 releaseSession();await detail.waitFor();await admin.unroute('**/api/account/session',sessionRoute);
 assert.equal(await detail.getByLabel('Причина блокировки',{exact:true}).inputValue(),reason);
 assert.equal(await detail.getByRole('button',{name:'Заблокировать объявление',exact:true}).isDisabled(),true);
 assert.equal(blocks,1);assert.equal(reads,0,'A focus recheck cannot silently retry or clear an unknown write');
 loseRead=true;await admin.getByRole('button',{name:'Перечитать объявление',exact:true}).click();await admin.getByRole('alert').filter({hasText:'Результат не подтверждён'}).waitFor();
 assert.equal(blocks,1);assert.equal(await detail.getByRole('button',{name:'Заблокировать объявление',exact:true}).isDisabled(),true);
 await admin.getByRole('button',{name:'Перечитать объявление',exact:true}).click();await detail.getByRole('heading',{name:'Причина блокировки',exact:true}).waitFor();
 assert.equal(blocks,1);assert.ok((await detail.innerText()).includes(reason));assert.equal(await detail.locator('textarea').count(),0);
 const notices=await rpc(userContext,'/api/account/notifications',{expectedOwnerId:owner.id,action:'list',after:null});assert.ok(notices.items.some(item=>item.message.includes(reason)));
 const mail=await userContext.request.get(origin+'/__local/mail');assert.equal(mail.status(),200);assert.ok((await mail.text()).includes(reason));
 await rpc(adminContext,'/api/account/logout',{});await login(otherTab,'user');await otherTab.bringToFront();
 const changed=admin.waitForResponse(response=>response.url().endsWith('/api/account/session'));
 await admin.bringToFront();await admin.locator('body').dispatchEvent('focus');await changed;await detail.waitFor({state:'hidden'});
 assert.equal(await admin.getByText(reason,{exact:true}).count(),0,'An ordinary account cannot retain the previous administrator detail');
 await rpc(adminContext,'/api/account/logout',{});await login(otherTab,'admin');await otherTab.bringToFront();
 const restored=admin.waitForResponse(response=>response.url().endsWith('/api/account/session'));
 await admin.bringToFront();await admin.locator('body').dispatchEvent('focus');await restored;await detail.waitFor();await otherTab.close();
 await admin.getByRole('link',{name:'Вернуться к объявлениям',exact:false}).click();await area.waitFor();assert.equal(await admin.getByRole('heading',{name:'Карточка объявления',exact:true}).count(),0);
 assert.equal((await admin.goto(origin+'/admin/obyavleniya/not-an-id')).status(),404);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({status:'passed',boundedActualCards:true,separateDetailPage:true,refreshAndKeyboard:true,allNinePhotos:true,requiredReason:true,lostBlockReadback:true,recheckHidesPending:true,accountSwitchHidesDetails:true,inboxAndLocalMail:true,adminTabs:11,responsive:[320,768,1024,1440],productionTouched:false,realCharges:false}));
}finally{await browser.close();}
