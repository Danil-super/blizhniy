// Owned, isolated HTTPS fixture only. The real provider is blocked; this is not live-counter acceptance.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {get} from 'node:http';
import {chromium} from 'playwright';
import {startReportTestTls} from './local-csp-https-fixture.mjs';

const tag='https://mc.yandex.ru/metrika/tag.js',counterId=987654321;
const stub=`{const queued=window.ym?.a??[];window.__metricaEvents=[];window.ym=(...args)=>window.__metricaEvents.push(args);for(const args of queued)window.ym(...args);}`;
const tagResponse={contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},body:stub};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label,timeout=15000){
 const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await sleep(50);}throw new Error('Timed out: '+label);
}
async function start(id, isolation){
 const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
 const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 const tls=await startReportTestTls(port),env={};
 for(const name of ['PATH','HOME','TMPDIR'])if(process.env[name])env[name]=process.env[name];
 Object.assign(env,{NODE_ENV:'production',__NEXT_PROCESSED_ENV:'true',NEXT_TELEMETRY_DISABLED:'1',
  BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_CSP_MODE:'enforce',NEXT_PUBLIC_SITE_URL:tls.origin,SITE_URL:tls.origin,BLIZHNIY_YANDEX_METRICA_ID:id});
 if(isolation)env.BLIZHNIY_HTML_ISOLATION='enforce';
 let log='';const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{cwd:process.cwd(),env,stdio:['ignore','pipe','pipe']});
 for(const stream of [server.stdout,server.stderr])stream.on('data',value=>{log=(log+value).slice(-8000);});
 const close=async()=>{if(server.exitCode===null){server.kill('SIGTERM');await once(server,'exit');}tls.close();};
 try{
  await until(()=>new Promise(resolve=>{if(server.exitCode!==null)throw new Error('Fixture server exited: '+log);const request=get(`http://127.0.0.1:${port}/o-proekte`,response=>{response.resume();resolve(response.statusCode===200);});request.on('error',()=>resolve(false));request.setTimeout(1000,()=>request.destroy());}),'fixture startup',45000);
  return{origin:tls.origin,close};
 }catch(error){await close();throw error;}
}
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||undefined}),checks=[];
let fixture;
async function context({transport='stub',cookies=[]}={}){
 const ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:390,height:844}}),requests=[],unexpected=[],errors=[];
 let pending;
 await ctx.addInitScript(()=>{
  window.__cspViolations=[];
  document.addEventListener('securitypolicyviolation',event=>window.__cspViolations.push({directive:event.effectiveDirective,blocked:event.blockedURI}));
 });
 ctx.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
 await ctx.route('**/*',async route=>{
  const url=route.request().url();
  if(url===tag){
   requests.push({url,headers:await route.request().allHeaders()});
   if(transport==='delay'){pending=route;return;}
   if(transport==='block')return route.abort();
   return route.fulfill(tagResponse);
  }
  if(new URL(url).origin!==fixture.origin){unexpected.push(url);return route.abort();}
  if(new URL(url).pathname==='/api/account/session')return route.fulfill({contentType:'application/json',body:'{"user":null}'});
  return route.continue();
 });
 if(cookies.length)await ctx.addCookies(cookies.map(cookie=>({url:fixture.origin,secure:true,sameSite:'Lax',...cookie})));
 return{ctx,requests,unexpected,errors,release:async()=>{assert.ok(pending,'a delayed tag request exists');await pending.fulfill(tagResponse);pending=undefined;}};
}
const notice=page=>page.getByRole('region',{name:'Файлы cookie',exact:true});
const events=page=>page.evaluate(()=>window.__metricaEvents??[]);
const count=(page,method)=>page.evaluate(method=>(window.__metricaEvents??[]).filter(row=>row[1]===method).length,method);
const settings=async page=>{await page.getByRole('button',{name:'Настройки cookie',exact:true}).click();await notice(page).waitFor();await until(()=>notice(page).evaluate(element=>document.activeElement===element),'settings focus');};
const ready=async page=>{await page.getByRole('button',{name:'Принять все',exact:true}).waitFor();await until(()=>page.getByRole('button',{name:'Принять все',exact:true}).isEnabled(),'hydrated consent');};
async function clean(f,pages){
 assert.deepEqual(f.errors,[]);assert.deepEqual(f.unexpected,[]);
 for(const page of pages)assert.deepEqual(await page.evaluate(()=>window.__cspViolations),[]);
 await f.ctx.close();
}
try{
 fixture=await start(String(counterId));
 {
  const f=await context(),page=await f.ctx.newPage();
  await page.setViewportSize({width:320,height:568});
  let resumeHydration;
  const hydration=new Promise(resolve=>{resumeHydration=resolve;});
  await f.ctx.route(url=>url.pathname.startsWith('/_next/static/')&&url.pathname.endsWith('.js'),async route=>{
   await hydration;await route.fallback();
  });
  try{
   await page.goto(fixture.origin+'/o-proekte',{waitUntil:'commit'});
   const buttons=notice(page).getByRole('button');
   await until(async()=>await buttons.count()===2&&await buttons.evaluateAll(items=>
    items.every(button=>button.disabled&&Number(getComputedStyle(button).opacity)<1)),'disabled consent before hydration');
   await notice(page).evaluate(panel=>{
    const controls=[...panel.querySelectorAll('button')];
    window.__enabledConsentOpacity=null;
    const observer=new MutationObserver(()=>{
     if(controls.some(button=>button.disabled))return;
     window.__enabledConsentOpacity=controls.map(button=>getComputedStyle(button).opacity);
     observer.disconnect();
    });
    observer.observe(panel,{subtree:true,attributes:true,attributeFilter:['disabled']});
   });
   resumeHydration();
   await page.waitForFunction(()=>window.__enabledConsentOpacity!==null);
   assert.deepEqual(await page.evaluate(()=>window.__enabledConsentOpacity),['1','1'],
    'Consent buttons have full opacity as soon as they become interactive');
  }finally{resumeHydration();}
  await clean(f,[page]);checks.push('enabled consent buttons have full opacity immediately');
 }
 {
  const f=await context({cookies:[{name:'__Host-blizhniy_cookie_notice',value:'v1'}]}),page=await f.ctx.newPage();
  const response=await page.goto(fixture.origin+'/o-proekte?q=private-query-sentinel#private-fragment');await ready(page);
  assert.ok((await response.allHeaders())['content-security-policy'].includes("'strict-dynamic'"));
  assert.equal(await page.locator('meta[name="blizhniy-metrica-id"]').getAttribute('content'),String(counterId));
  await page.waitForLoadState('networkidle');assert.equal(f.requests.length,0,'old acknowledgement is not consent');
  for(const [width,height]of [[320,740],[390,844],[768,1000],[1440,1000],[740,360]]){
   await page.setViewportSize({width,height});const box=await notice(page).boundingBox();
   assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=width&&box.y+box.height<=height,'consent fits the viewport');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   if(width<768){const nav=await page.getByRole('navigation',{name:'Мобильная навигация',exact:true}).boundingBox();assert.ok(box.y+box.height<nav.y,'consent leaves mobile navigation accessible');}
  }
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Только необходимые',exact:true}).click();await notice(page).waitFor({state:'detached'});
  assert.deepEqual(await page.evaluate(()=>window.__cspViolations),[]);
  await page.reload();await page.waitForLoadState('networkidle');assert.equal(f.requests.length,0);assert.equal(await notice(page).count(),0);
  await settings(page);assert.equal(await notice(page).evaluate(element=>document.activeElement===element),true);
  await page.getByRole('button',{name:'Принять все',exact:true}).click();await until(async()=>await count(page,'hit')===1,'first public view');
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].headers.referer,undefined);
  assert.deepEqual((await events(page)).map(row=>row[1]),['init','hit']);
  const options=(await events(page))[0][2];for(const field of ['webvisor','clickmap','trackLinks','trackHash','ecommerce','sendTitle'])assert.equal(options[field],false);
  const cookies=await f.ctx.cookies(fixture.origin),choice=cookies.find(row=>row.name==='__Host-blizhniy_analytics');
  assert.ok(choice.secure);assert.equal(choice.sameSite,'Lax');assert.equal(choice.path,'/');assert.equal(choice.value,'v1.granted');
  await page.evaluate(()=>{window.__sameDocument='yes';});
  await page.getByRole('navigation',{name:'Нижняя навигация',exact:true}).getByRole('link',{name:'Как работает',exact:true}).click();
  await page.waitForURL('**/kak-rabotaet');await until(async()=>await count(page,'hit')===2,'SPA public view');
  assert.equal(await page.evaluate(()=>window.__sameDocument),'yes');assert.equal(f.requests.length,1);
  await page.getByRole('navigation',{name:'Мобильная навигация',exact:true}).getByRole('link',{name:'Вход',exact:true}).click();
  await page.waitForURL('**/auth');await until(async()=>await count(page,'destruct')===1,'private route stops counter');assert.equal(await count(page,'hit'),2);
  await page.goBack();await page.waitForURL('**/kak-rabotaet');await until(async()=>await count(page,'hit')===3,'history back to public');
  const second=await f.ctx.newPage();await second.goto(fixture.origin+'/o-proekte');await until(async()=>await count(second,'hit')===1,'saved consent in second tab');
  await settings(page);await page.getByRole('button',{name:'Отключить аналитику',exact:true}).click();
  await until(async()=>await count(page,'destruct')===2&&await count(second,'destruct')===1,'cross-tab withdrawal');
  assert.doesNotMatch(JSON.stringify(await events(page)),/private-query-sentinel|private-fragment|\/auth/);
  assert.deepEqual(await page.evaluate(()=>window.__cspViolations),[]);
  await page.reload();await page.waitForLoadState('networkidle');assert.equal(await count(page,'hit'),0);assert.equal(f.requests.length,2);
  await clean(f,[page,second]);checks.push('consent, old acknowledgement, viewport, SPA/history, private route, cross-tab withdrawal, reload, sanitized commands, CSP');
 }
 for(const action of ['withdraw','private']){
  const f=await context({transport:'delay'}),page=await f.ctx.newPage();await page.goto(fixture.origin+'/o-proekte');await ready(page);
  await page.getByRole('button',{name:'Принять все',exact:true}).click();await until(()=>f.requests.length===1,'pending tag');
  if(action==='withdraw'){await settings(page);await page.getByRole('button',{name:'Отключить аналитику',exact:true}).click();}
  else{await page.getByRole('navigation',{name:'Мобильная навигация',exact:true}).getByRole('link',{name:'Вход',exact:true}).click();await page.waitForURL('**/auth');}
  await f.release();await page.waitForLoadState('networkidle');assert.deepEqual(await events(page),[]);await clean(f,[page]);checks.push('late tag after '+action);
 }
 {
  const f=await context(),page=await f.ctx.newPage();
  await page.addInitScript(()=>{Object.defineProperty(Document.prototype,'cookie',{configurable:true,get(){throw new Error('Synthetic blocked storage');},set(){throw new Error('Synthetic blocked storage');}});});
  await page.goto(fixture.origin+'/o-proekte');await ready(page);await page.getByRole('button',{name:'Принять все',exact:true}).click();
  await notice(page).getByRole('alert').waitFor();assert.match(await notice(page).getByRole('alert').innerText(),/Аналитика не включена/);assert.equal(f.requests.length,0);
  await page.getByRole('button',{name:'Закрыть настройки',exact:true}).click();
  await page.getByRole('navigation',{name:'Нижняя навигация',exact:true}).getByRole('link',{name:'Как работает',exact:true}).click();await page.waitForURL('**/kak-rabotaet');
  await clean(f,[page]);checks.push('blocked cookie storage fails closed without breaking navigation');
 }
 {
  const f=await context({transport:'block'}),page=await f.ctx.newPage();await page.goto(fixture.origin+'/o-proekte');await ready(page);
  await page.getByRole('button',{name:'Принять все',exact:true}).click();await until(()=>f.requests.length===1,'blocked tag');
  await page.getByRole('navigation',{name:'Нижняя навигация',exact:true}).getByRole('link',{name:'Как работает',exact:true}).click();await page.waitForURL('**/kak-rabotaet');
  await page.waitForLoadState('networkidle');assert.equal(f.requests.length,1);assert.deepEqual(await events(page),[]);await clean(f,[page]);checks.push('blocked provider leaves navigation working without retry loop');
 }
 await fixture.close();fixture=null;
 {
  fixture=await start(String(counterId),true);
  const f=await context(),page=await f.ctx.newPage();
  const response=await page.goto(fixture.origin+'/o-proekte');await ready(page);
  assert.equal((await response.allHeaders())['cross-origin-embedder-policy'],'require-corp');
  assert.equal((await response.allHeaders())['cross-origin-opener-policy'],'same-origin');
  assert.equal(f.requests.length,0);
  await page.getByRole('button',{name:'Принять все',exact:true}).click();
  await until(()=>f.requests.length===1,'tag request under strict isolation');
  assert.equal(f.requests[0].headers.referer,undefined);
  await until(async()=>await count(page,'hit')===1,'CORS-only tag under strict isolation',7000);
  assert.equal(await page.locator('#blizhniy-yandex-metrica').getAttribute('crossorigin'),'anonymous');
  await clean(f,[page]);await fixture.close();fixture=null;
  checks.push('strict isolation with a CORS-only tag and no analytics before consent');
 }
 for(const id of ['', 'invalid-id']){
  fixture=await start(id);const f=await context({cookies:[{name:'__Host-blizhniy_analytics',value:'v1.granted'}]}),page=await f.ctx.newPage();
  const response=await page.goto(fixture.origin+'/o-proekte');await page.getByRole('button',{name:'Понятно',exact:true}).waitFor();await page.waitForLoadState('networkidle');
  assert.equal(await page.locator('meta[name="blizhniy-metrica-id"]').count(),0);assert.equal(f.requests.length,0);assert.doesNotMatch((await response.allHeaders())['content-security-policy'],/mc\.yandex\.ru/);
  await clean(f,[page]);await fixture.close();fixture=null;checks.push('runtime '+(id?'invalid':'empty')+' ID disables analytics');
 }
 console.log(JSON.stringify({passed:true,checks,transport:'isolated synthetic tag',realProviderContacted:false,productionTouched:false}));
}finally{await browser.close();await fixture?.close();}
