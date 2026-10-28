// Controlled card DTOs, real local account/session, isolated browser; no production or payment writes.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import {REGISTRATION_LEGAL_VERSIONS as legal} from '../src/lib/registration-legal.ts';
import {parseListingCabinetPage} from '../src/lib/listing-cabinet-contract.ts';
import {parseWorkCabinetPage} from '../src/lib/work-cabinet-contract.ts';
import {stateFile,stateDirectory,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';

const state=readLocalPrimaryState(stateFile,process.cwd());
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
assert.equal(new URL(state.origin).hostname,'127.0.0.1');
const origin=state.origin,email='two-rows-'+randomUUID()+'@local.invalid',password='SyntheticRows-'+randomUUID()+'!';
const headers={Origin:origin,'Content-Type':'application/json','X-Blizhniy-Request':'1','Sec-Fetch-Site':'same-origin'};
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',viewport:{width:1440,height:1600}});
const page=await context.newPage(),errors=[],report=[];page.setDefaultTimeout(12000);
page.on('pageerror',error=>errors.push(error.name));
const wait=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
async function until(read,predicate,message){const deadline=Date.now()+10000;let value;while(Date.now()<deadline){value=await read();if(predicate(value))return value;await wait(50);}assert.fail(message+' '+JSON.stringify(value));}

async function geometry(region){
 return region.evaluate(element=>{
  const list=element.querySelector('ul'),cards=Array.from(list.children),styles=getComputedStyle(element),gridStyles=getComputedStyle(list);
  const first=cards[0].getBoundingClientRect(),rowTops=[...new Set(cards.map(card=>Math.round(card.getBoundingClientRect().top-first.top)))].sort((a,b)=>a-b);
  const padding=parseFloat(styles.paddingTop)+parseFloat(styles.paddingBottom),border=parseFloat(styles.borderTopWidth)+parseFloat(styles.borderBottomWidth);
  const gap=parseFloat(gridStyles.rowGap)||0,expected=first.height*2+gap+padding+border;
  return {height:element.getBoundingClientRect().height,expected,firstHeight:first.height,rowTops,overflow:styles.overflowY,scrollTop:element.scrollTop,client:element.clientHeight,total:element.scrollHeight,
   fitsDocument:document.documentElement.scrollWidth<=innerWidth};
 });
}

try{
 const registered=await context.request.post(origin+'/api/account/register',{headers,data:{name:'Два ряда карточек',email,password,captchaToken:'',acceptedAgreement:true,acknowledgedPrivacy:true,agreementVersion:legal.agreement,privacyVersion:legal.privacy}});
 assert.equal(registered.status(),202);
 let token;const deadline=Date.now()+10000;
 while(!token&&Date.now()<deadline){
  for(const name of(await readdir(stateDirectory)).filter(name=>/^mail-[a-f0-9-]{36}\.json$/.test(name))){const mail=JSON.parse(await readFile(join(stateDirectory,name),'utf8'));if(mail.to===email)token=mail.text.match(/#token=([a-f0-9]{64})/)?.[1];}
  if(!token)await wait(100);
 }
 assert.ok(token,'Confirmation is captured only in the owned local mail fixture');
 assert.equal((await context.request.post(origin+'/api/account/confirm',{headers,data:{token}})).status(),200);
 await page.goto(origin+'/auth');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Пароль',{exact:true}).fill(password);
 await page.getByRole('button',{name:'Войти',exact:true}).click();await page.waitForURL(origin+'/');
 const session=await context.request.post(origin+'/api/account/session',{headers,data:{}});assert.equal(session.status(),200);const owner=(await session.json()).user.id;
 for(const definition of [
  {kind:'listing',path:'/cabinet/obyavleniya',label:'Прокручиваемый список моих объявлений',endpoint:'/api/account/listings'},
  {kind:'vacancy',path:'/cabinet/vakansii',label:'Список вакансий',endpoint:'/api/account/work-cabinet'},
  {kind:'workRequest',path:'/cabinet/zakazy',label:'Список заказов',endpoint:'/api/account/work-cabinet'},
 ]){
  const {kind}=definition,records=Array.from({length:39},(_,index)=>{
   const common={id:randomUUID(),revision:'1',title:`Два ряда ${kind} — ${String(index+1).padStart(2,'0')}`};
   return kind==='listing'?{...common,kind:'prodam',price:'3500.00',card:{city:'Сочи',district:'Центральный',coverPhotoId:null,status:'published',blockReason:null}}:
    {...common,kind,status:'published',paid:true,updatedAt:'2026-10-23T12:00:00.123456Z',amount:'65000.00',organization:'Мастерская',city:'Сочи',district:'Центральный',profession:'Сантехник',schedule:kind==='vacancy'?'5/2':null,workFormat:kind==='vacancy'?'На месте':null,coverPhotoId:null};
  });
  const cursor={id:records[19].id,updatedAt:'2026-10-23T12:00:00.123456Z'};
  const first={items:records.slice(0,20),nextCursor:cursor,...(kind==='listing'?{workflow:'postmoderation'}:{})};
  // One overlap deliberately models records changing between bounded server pages.
  const second={items:records.slice(19),nextCursor:null,...(kind==='listing'?{workflow:'postmoderation'}:{})};
  if(kind==='listing'){parseListingCabinetPage(first);parseListingCabinetPage(second);}else{parseWorkCabinetPage(first,kind);parseWorkCabinetPage(second,kind);}
  let initialRequests=0,nextRequests=0,failNext=true;
  const handler=async route=>{
   const body=route.request().postDataJSON();assert.equal(body.expectedOwnerId,owner,'Card projection must be scoped to the authenticated account');
   if(kind!=='listing')assert.equal(body.kind,kind);
   const after=kind==='listing'?body.cursor:body.after;
   if(!after){initialRequests++;await route.fulfill({status:200,json:first});return;}
   assert.deepEqual(after,cursor);nextRequests++;
   if(failNext){failNext=false;await route.fulfill({status:503,json:{error:{code:'SYNTHETIC_UNAVAILABLE'}}});return;}
   await route.fulfill({status:200,json:second});
  };
  await page.route('**'+definition.endpoint,handler);
  await page.goto(origin+definition.path);
  const region=page.getByRole('region',{name:definition.label,exact:true});await region.waitFor();
  await until(()=>region.getByRole('article').count(),count=>count===20,kind+' initial bounded page');
  assert.equal(initialRequests,1);assert.equal(nextRequests,0);
  assert.equal(await page.getByRole('button',{name:'Следующая страница',exact:true}).count(),0);
  if(kind==='vacancy'){
   assert.equal(await region.getByRole('button',{name:/^Подробнее/}).count(),0);
   assert.equal(await region.getByRole('link',{name:'Редактировать',exact:true}).count(),20);
   assert.equal(await region.getByRole('link',{name:'Посмотреть',exact:true}).count(),20);
  }
  const dimensions=[];
  for(const width of [320,768,1024,1440]){
   await page.setViewportSize({width,height:1600});
   const measured=await until(()=>geometry(region),result=>Math.abs(result.height-result.expected)<=2&&result.firstHeight>0,kind+' two full rows at '+width);
   assert.equal(measured.overflow,'auto');assert.equal(measured.fitsDocument,true);
   assert.ok(measured.rowTops.length>=3);assert.ok(measured.total>measured.client);
   assert.ok(Math.abs(measured.rowTops[1]-(measured.firstHeight+12))<=2,kind+' second row follows the first with a single grid gap');
   dimensions.push({width,height:measured.height,cardHeight:measured.firstHeight});
  }
  await page.addScriptTag({path:createRequire(import.meta.url).resolve('axe-core/axe.min.js')});
  const accessibility=await region.evaluate(async element=>{
   const result=await window.axe.run(element,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});
   return result.violations.filter(item=>['serious','critical'].includes(item.impact)).map(item=>item.id);
  });
  assert.deepEqual(accessibility,[],kind+' card viewport serious/critical accessibility findings');
  await page.screenshot({path:'/tmp/blizhniy-two-rows-'+kind+'-desktop.png',fullPage:true});
  await region.scrollIntoViewIfNeeded();await region.press('PageDown');
  await until(()=>geometry(region),result=>result.scrollTop>0,kind+' native PageDown scrolls the focused list');
  for(let step=0;step<12&&nextRequests===0;step++){
   const bounds=await region.boundingBox(),viewport=page.viewportSize();
   await page.mouse.move(bounds.x+20,Math.max(40,Math.min(bounds.y+bounds.height,viewport.height)-60));
   await page.mouse.wheel(0,500);await wait(150);
  }
  const retry=page.getByRole('button',{name:'Повторить загрузку',exact:true});await retry.waitFor();
  assert.equal(nextRequests,1);assert.equal(await region.getByRole('article').count(),20,'An error must not replace the previous cards');
  for(let repeat=0;repeat<3;repeat++)await page.mouse.wheel(0,10000);
  await wait(500);assert.equal(nextRequests,1,'Scroll error cannot auto-retry forever');
  const beforeRetry=await geometry(region);await retry.click();
  await until(()=>region.getByRole('article').count(),count=>count===39,kind+' append after explicit retry');
  assert.equal(nextRequests,2);assert.equal(initialRequests,1);
  const titles=await region.locator('h3').allTextContents();assert.deepEqual(titles,records.map(record=>record.title));assert.equal(new Set(titles).size,39);
  assert.ok(Math.abs((await geometry(region)).scrollTop-beforeRetry.scrollTop)<=2,kind+' append does not reset scroll position');
  await page.mouse.wheel(0,100000);await wait(250);assert.equal(nextRequests,2,'The exhausted cursor must not load additional pages');
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/blizhniy-two-rows-'+kind+'-mobile.png',fullPage:true});
  await page.unroute('**'+definition.endpoint,handler);
  report.push({kind,initialCards:20,appendedCards:39,twoRows:dimensions,nextButton:false,duplicateCards:false,nativeWheel:true,nativePageDown:true,errorKeepsCards:true,errorRequiresExplicitRetry:true});
 }
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({status:'passed',report,controlledCardDtos:true,realLocalSession:true,realCharges:false,productionTouched:false}));
}finally{await browser.close();}
