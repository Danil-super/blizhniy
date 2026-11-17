// Two accounts on the owned synthetic HTTPS stand. No provider calls or new drafts.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {join} from 'node:path';
import {once} from 'node:events';
import {chromium} from 'playwright';
import pg from 'pg';
import {stateFile,stateDirectory,docker,localPrimaryDatabaseConfig} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';

const state=readLocalPrimaryState(stateFile,process.cwd()), origin=state.origin;
assert.equal(origin,'https://127.0.0.1:3045');
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const accounts=JSON.parse(await readFile(join(stateDirectory,'accounts.json'),'utf8'));
const first=accounts.find(a=>a.role==='user'),second=accounts.find(a=>a.role==='admin');
for(const a of [first,second])assert.ok(a?.email.endsWith('@local.invalid'));
assert.notEqual(first.id,second.id);
const db=new pg.Client(localPrimaryDatabaseConfig(state,'runtime'));
await db.connect();
let draftId;
try {
 const found=await db.query(`select l.id from app.listings l where l.author_id=$1 and l.status='draft'
  and l.title<>'' and l.contact_phone<>'' and l.price>0
  and exists(select 1 from app.listing_photos p where p.listing_id=l.id) order by l.updated_at desc limit 1`,[first.id]);
 assert.ok(found.rowCount,'The synthetic owner needs a saved draft with a phone, price and photo');
 draftId=found.rows[0].id;
} finally {await db.end();}

const browser=await chromium.launch({channel:'chromium',ignoreDefaultArgs:['--disable-back-forward-cache']});
const headers={Origin:origin,'X-Blizhniy-Request':'1','Sec-Fetch-Site':'same-origin'};
async function verifyBrowserCache(){
 const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<title>Local control</title>');});
 const page=await browser.newPage();
 try {
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  await page.addInitScript(()=>addEventListener('pageshow',e=>{window.controlRestored=e.persisted;}));
  await page.goto(base+'/one');await page.goto(base+'/two');await page.evaluate(()=>history.back());
  await page.waitForURL(base+'/one',{waitUntil:'commit'});await page.waitForFunction(()=>window.controlRestored===true);
 } finally {await page.close();if(server.listening)await new Promise(resolve=>server.close(resolve));}
}

// Hold only the session lookup on Back. Request interception through Playwright
// can itself affect cache eligibility, so delay the page's own fetch instead.
function observeRestoration(){
 window.privateFields=()=>{
  const expected=JSON.parse(sessionStorage.privacyExpected??'{}');
  const inputs=Array.from(document.querySelectorAll('input,textarea'));
  return {
   marker:!!expected.marker&&(document.body?.textContent?.includes(expected.marker)||inputs.some(el=>el.value===expected.marker)),
   photo:!!document.querySelector('figure img[src]'),
   phone:!!expected.phone&&inputs.some(el=>el.value===expected.phone),
   price:!!expected.price&&inputs.some(el=>el.name==='price'&&el.value===expected.price),
   amount:Array.from(document.querySelectorAll('[aria-label="История платежей"] li p')).some(el=>el.textContent.includes('₽')),
  };
 };
 addEventListener('pageshow',e=>{window.privatePageShow={persisted:e.persisted,fields:window.privateFields()};});
 const nativeFetch=window.fetch.bind(window);
 window.fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:input,location.href);
  if(sessionStorage.privacyHold==='yes'&&url.pathname==='/api/account/session'){
   await new Promise(resolve=>(window.privateWaiters??=[]).push(resolve));
  }
  return nativeFetch(input,init);
 };
}

async function checkScreen(screen){
 const draft=screen==='draft', context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block'});
 const tab=await context.newPage(),other=await context.newPage(),errors=[];
 const api=(path,data)=>context.request.post(origin+'/api/account/'+path,{headers,data,maxRedirects:0});
 for(const page of [tab,other]){page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.name));}
 async function login(user){
  await other.goto(origin+'/auth');await other.getByLabel('Email',{exact:true}).fill(user.email);
  await other.getByLabel('Пароль',{exact:true}).fill(user.password);
  const [reply]=await Promise.all([
   other.waitForResponse(r=>r.url()===origin+'/api/account/login'),
   other.getByRole('button',{name:'Войти',exact:true}).click(),
  ]);
  assert.equal(reply.status(),200,'Login on the owned synthetic stand');
  await other.waitForURL(origin+'/');assert.equal((await (await api('session',{})).json()).user.id,user.id);
 }
 const resource=draft?'listing-form':'payments';
 const claim=id=>draft?{expectedOwnerId:id,listingId:draftId}:{expectedOwnerId:id,cursor:null};
 const path=draft?'/razmestit/obyavlenie?draft='+draftId:'/cabinet/oplata';
 let entered=false;
 try {
  await tab.addInitScript(observeRestoration);
  await login(first);entered=true;
  const firstRead=await api(resource,claim(first.id));assert.equal(firstRead.status(),200);const body=await firstRead.json();
  assert.ok(draft?body.form.title:body.items?.length,'A populated synthetic screen is required');
  const marker=draft?body.form.title:'Заказ '+body.items[0].id;
  const html=await tab.goto(origin+path);assert.match(html.headers()['cache-control'],/\bno-store\b/);
  if(draft){
   await tab.waitForFunction(title=>document.querySelector('input[name=title]')?.value===title,marker);
   await tab.waitForFunction(()=>Array.from(document.querySelectorAll('figure img')).some(el=>el.complete&&el.naturalWidth));
  }else await tab.getByText(marker,{exact:true}).waitFor();
  await tab.evaluate(({draft,marker})=>{
   const phone=document.querySelector('input[type=tel],input[name=phone],input[name=contactPhone]')?.value;
   const price=document.querySelector('input[name=price]')?.value;
   sessionStorage.privacyExpected=JSON.stringify(draft?{marker,phone,price}:{marker});
  },{draft,marker});
  const fields=draft?['marker','photo','phone','price']:['marker','amount'];
  const before=await tab.evaluate(()=>window.privateFields());
  for(const key of fields)assert.equal(before[key],true,'Fixture must display '+key);
  await tab.evaluate(()=>{sessionStorage.privacyHold='yes';});
  await tab.goto(origin+'/robots.txt');
  await other.goto(origin+'/auth');await other.getByRole('button',{name:'Выйти',exact:true}).click();
  await other.getByLabel('Email',{exact:true}).waitFor();await login(second);
  const denied=await api(resource,claim(first.id));assert.equal(denied.status(),draft?404:401);
  if(draft)assert.equal((await api(resource,claim(second.id))).status(),404);
  const verified=tab.waitForResponse(r=>r.url()===origin+'/api/account/session');
  await tab.evaluate(()=>history.back());await tab.waitForURL(origin+path,{waitUntil:'commit'});
  await tab.waitForFunction(()=>window.privateWaiters?.length&&window.privatePageShow);
  const shown=await tab.evaluate(()=>window.privatePageShow);
  const pending=await tab.evaluate(()=>window.privateFields());
  for(const key of fields){assert.equal(shown.fields[key],false,key+' on pageshow');assert.equal(pending[key],false,key+' while verifying');}
  await tab.evaluate(()=>{sessionStorage.removeItem('privacyHold');for(const release of window.privateWaiters)release();});
  assert.equal((await (await verified).json()).user.id,second.id);
  if(draft)await tab.waitForLoadState('networkidle');
  else {
   const region=tab.getByRole('region',{name:'История платежей'});await region.waitFor();
   const current=await api(resource,claim(second.id));assert.equal(current.status(),200);
   const rows=(await current.json()).items;
   if(!rows.length)await region.getByText('Платежей пока нет',{exact:true}).waitFor();
   for(const row of rows)await region.getByText('Заказ '+row.id,{exact:true}).waitFor();
   assert.equal(await region.locator('li').count(),rows.length);
  }
  const after=await tab.evaluate(()=>window.privateFields());
  for(const key of (draft?fields:['marker']))assert.equal(after[key],false,key+' after verifying');
  assert.deepEqual(errors,[]);
  const reasons=await tab.evaluate(()=>performance.getEntriesByType('navigation')[0]?.notRestoredReasons?.reasons?.map(r=>r.reason)??[]);
  return {screen,persisted:shown.persisted,reasons,checkedFields:fields,foreignStatus:denied.status()};
 } finally {
  try{if(entered)await api('logout',{});}finally{await context.close();}
 }
}
try {
 await verifyBrowserCache();
 const payments=await checkScreen('payments'),draft=await checkScreen('draft');
 console.log(JSON.stringify({browser:browser.version(),controlRestored:true,results:[payments,draft]}));
} finally {await browser.close();}
