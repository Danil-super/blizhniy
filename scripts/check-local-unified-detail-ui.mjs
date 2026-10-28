// Synthetic public fixtures and isolated cabinet transport. No SQL writes or publication/payment mutations.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import pg from 'pg';
import {stateFile,localPrimaryDatabaseConfig,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
import {createDefaultCabinetProfile} from '../src/lib/cabinet-profile.ts';

const state=readLocalPrimaryState(stateFile,process.cwd());
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const db=new pg.Client(localPrimaryDatabaseConfig(state,'owner')),fixtures=[];
await db.connect();
try{
 const load=createRequire(import.meta.url)('./local-primary-modules.cjs').loadLocalPrimaryModule;
 const publicListings=new(load('postgres-public-listings').PostgresPublicListingStore)(db,{postmoderation:true});
 const candidates=(await db.query("select id from app.listings where title like $1 order by created_at desc limit 30",['Проверка полного пути%'])).rows;
 let listing;
 for(const candidate of candidates)if(await publicListings.read(candidate.id)){listing=candidate;break;}
 assert.ok(listing,'A prior synthetic published listing fixture is required');fixtures.push({kind:'listing',path:'/obyavlenie/'+listing.id});
 for(const [kind,prefix,route] of [['vacancy','Локальная вакансия %','/vakansiya/'],['workRequest','Проверка вида оплаченного заказа %','/rabota/zakazy/']]){
  const row=(await db.query("select id from app.work_publications where kind=$1 and status='published' and is_paid and form->>'title' like $2 and expires_at>clock_timestamp() order by created_at desc limit 1",[kind,prefix])).rows[0];
  assert.ok(row,`A prior synthetic ${kind} fixture is required`);fixtures.push({kind,path:route+row.id});
 }
}finally{await db.end();}
const browser=await chromium.launch({headless:true}),origin=state.origin;
async function cabinetActions(context,page){
 const owner='12345678-1234-4321-8765-123456789abc',states=['draft','pending_payment','paid','published','sold','archived','expired','blocked'],writes=[],errors=[];
 const items=states.map((status,index)=>({id:`22345678-1234-4321-8765-123456789ab${index}`,revision:'2',kind:'prodam',title:`Комод — ${status}`,price:'3500.00',card:{city:'Крымск',district:null,coverPhotoId:null,status,blockReason:status==='blocked'?'Исправьте описание':null}}));
 page.on('pageerror',error=>errors.push(error.name));
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(['http:','https:'].includes(url.protocol)&&url.origin!==origin)throw Error('Unexpected external cabinet request');
  if(!url.pathname.startsWith('/api/account/'))return route.continue();
  assert.equal(request.headers().authorization,undefined);
  if(url.pathname==='/api/account/session')return route.fulfill({json:{user:{id:owner,email:'synthetic-cabinet@local.invalid',role:'user',isBlocked:false}}});
  if(url.pathname==='/api/account/profile')return route.fulfill({json:{exists:false,revision:null,profile:createDefaultCabinetProfile({name:'Локальная проверка',email:'synthetic-cabinet@local.invalid'})}});
  if(url.pathname==='/api/account/listings'){
   assert.equal(request.method(),'POST');assert.equal(request.postDataJSON().expectedOwnerId,owner);
   return route.fulfill({json:{items,nextCursor:null,workflow:'postmoderation'}});
  }
  writes.push(url.pathname);return route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});
 });
 await page.goto(origin+'/cabinet/obyavleniya');
 const cards=page.getByRole('region',{name:'Список моих объявлений',exact:true});await cards.locator('article').last().waitFor();
 assert.equal(await cards.locator('article').count(),8);
 for(const status of states)await cards.getByRole('heading',{name:'Комод — '+status,exact:true}).waitFor();
 assert.equal(await cards.getByRole('button',{name:/Подробнее/}).count(),0);
 assert.equal(await cards.getByRole('button',{name:'Статус и оплата',exact:true}).count(),3);
 const published=cards.getByRole('article').filter({hasText:'Комод — published'});await published.locator('summary').press('Enter');
 await published.getByRole('link',{name:'Редактировать',exact:true}).waitFor();await published.getByRole('link',{name:'Посмотреть',exact:true}).waitFor();
 await published.getByRole('button',{name:'Снять с публикации',exact:true}).waitFor();await published.locator('summary').press('Enter');
 const blocked=cards.getByRole('article').filter({hasText:'Комод — blocked'});await blocked.getByText('Исправьте описание',{exact:false}).waitFor();await blocked.locator('summary').click();await blocked.getByRole('link',{name:'Редактировать',exact:true}).waitFor();await blocked.locator('summary').click();
 await page.addScriptTag({path:createRequire(import.meta.url).resolve('axe-core/axe.min.js')});
 for(const width of [320,768,1024,1440]){
  await page.setViewportSize({width,height:1000});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const violations=await cards.evaluate(async element=>{const result=await window.axe.run(element,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return result.violations.filter(item=>['serious','critical'].includes(item.impact)).map(item=>({id:item.id,nodes:item.nodes.map(node=>({target:node.target,summary:node.failureSummary}))}));});assert.deepEqual(violations,[]);
  await page.screenshot({path:`/tmp/blizhniy-unified-cabinet-${width}.png`,fullPage:true});
 }
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
}
try{
 const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
 page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.name));
 for(const {kind,path} of (process.argv.includes('--cabinet-only')?[]:fixtures)){
  const response=await page.goto(origin+path);assert.equal(response.status(),200,kind+' public eligibility');
  const heading=page.locator('[data-publication-heading]');await heading.waitFor();assert.equal(await page.locator('h1').count(),1);
  assert.equal(await heading.locator('[data-publication-price]').count(),1);
  const main=page.locator('main'),photos=main.locator(kind==='listing'?'[data-listing-photo-frame]':'section button img').first();
  await photos.waitFor();
  for(const width of [320,768,1024,1440]){
   await page.setViewportSize({width,height:1000});
   await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,kind+' responsive width '+width);
   const titleBox=await heading.locator('h1').boundingBox(),priceBox=await heading.locator('[data-publication-price]').boundingBox(),photoBox=await photos.boundingBox();
   assert.ok(titleBox&&priceBox&&photoBox);assert.ok(priceBox.y>=titleBox.y+titleBox.height-1);assert.ok(photoBox.y>=priceBox.y+priceBox.height-1);
   await page.screenshot({path:`/tmp/blizhniy-unified-detail-${kind}-${width}.png`,fullPage:true});
  }
  await page.addScriptTag({path:createRequire(import.meta.url).resolve('axe-core/axe.min.js')});
  const violations=await page.evaluate(async()=>{const report=await window.axe.run(document.querySelector('main'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return report.violations.filter(item=>['serious','critical'].includes(item.impact)).map(item=>({id:item.id,nodes:item.nodes.map(node=>node.target)}));});
  assert.deepEqual(violations,[],kind+' accessibility');
  if(kind==='listing'){await main.getByRole('button',{name:/Поделиться/}).waitFor();}
  else await main.getByRole('heading',{name:'Связаться',exact:true}).waitFor();
 }
 assert.deepEqual(errors,[]);await context.close();
 const cabinet=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block'}),cabinetPage=await cabinet.newPage();
 await cabinetActions(cabinet,cabinetPage);
 await cabinet.close();
 console.log(JSON.stringify({status:'passed',publicKinds:process.argv.includes('--cabinet-only')?[]:fixtures.map(item=>item.kind),responsive:[320,768,1024,1440],axeSeriousCritical:0,cabinetNoDetails:true,paymentAndOwnerActionsPreserved:true,realCharges:false,productionTouched:false}));
}finally{await browser.close();}
