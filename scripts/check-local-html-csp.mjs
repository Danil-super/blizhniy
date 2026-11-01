// Owned loopback only. No account creation, mail, provider requests or credential reads.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {stateFile,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';

const state=readLocalPrimaryState(stateFile,process.cwd());
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
assert.equal(state.origin,'https://127.0.0.1:3045');
const origin=state.origin;
const incomingNonce='synthetic-attacker-controlled-nonce';
const routes=['/','/auth','/cabinet','/admin','/rabota','/katalog','/katalog/posuda','/obyavleniya'];
const foreignRequests=new Set();

function verifyPolicy(response,label,expectedStatus=200){
 assert.equal(response.status(),expectedStatus,label+' document status');
 const headers=response.headers(),policy=headers['content-security-policy'];
 assert.ok(policy,label+': HTML must have an enforced Content-Security-Policy in the owned local acceptance environment');
 assert.ok(!headers['content-security-policy-report-only'],label+': local acceptance explicitly enforces the policy');
 const entries=policy.split(';').map(entry=>entry.trim().split(/\s+/)).filter(entry=>entry[0]);
 const directives=new Map(entries.map(([name,...values])=>[name,values]));
 assert.equal(directives.size,entries.length,label+': duplicate directives are ambiguous');
 const scripts=directives.get('script-src')??[];
 const nonces=scripts.filter(value=>value.startsWith("'nonce-"));
 assert.equal(nonces.length,1,label+': exactly one script nonce');
 const nonce=nonces[0].slice(7,-1);
 assert.ok(/^[A-Za-z0-9+/]{32}$/.test(nonce)&&Buffer.from(nonce,'base64').length===24,label+': nonce must contain 192 random bits');
 assert.ok(nonce!==incomingNonce,label+': incoming nonce is replaced');
 for(const token of ["'self'","'strict-dynamic'"])assert.ok(scripts.includes(token),label+': required script source '+token);
 for(const token of ["'unsafe-inline'","'unsafe-eval'","'unsafe-hashes'"])assert.ok(!scripts.includes(token),label+': forbidden script source '+token);
 for(const [name,expected] of [['script-src-attr',["'none'"]],['object-src',["'none'"]],['base-uri',["'none'"]],['frame-ancestors',["'self'"]],['report-uri',['/api/csp-report']]]){
  assert.ok(JSON.stringify(directives.get(name))===JSON.stringify(expected),label+': '+name+' must use its restrictive contract');
 }
 assert.ok(directives.get('style-src')?.includes("'unsafe-inline'"),label+': current SDK style compatibility remains explicit');
 assert.ok(/\bprivate\b/.test(headers['cache-control']??'')&&/\bno-store\b/.test(headers['cache-control']??''),label+': nonce HTML must not be shared or stored');
 return nonce;
}

async function assertDocumentScripts(page,nonce,label){
 const scripts=await page.locator('script').evaluateAll(elements=>elements.filter(element=>!element.type||['module','text/javascript','application/javascript'].includes(element.type.toLowerCase())).map(element=>({nonce:element.nonce,external:Boolean(element.src)})));
 assert.ok(scripts.length>0,label+': Next bootstrap scripts exist');
 assert.ok(scripts.some(script=>script.external),label+': Next bundles exist');
 assert.ok(scripts.every(script=>script.nonce===nonce),label+': every executable document script and bundle carries the response nonce');
}

async function assertHydrates(page,label){
 if(label==='/auth'){
  const password=page.getByLabel('Пароль',{exact:true});
  await page.getByRole('button',{name:'Показать пароль',exact:true}).click();
  assert.equal(await password.getAttribute('type'),'text','Auth React event toggles the empty password field');
  await page.getByRole('button',{name:'Скрыть пароль',exact:true}).click();
  assert.equal(await password.getAttribute('type'),'password','Auth React event restores password concealment');
  return;
 }
 const button=page.locator('header button[aria-haspopup="listbox"]:visible');
 await button.click();
 const search=page.getByPlaceholder('Введите город',{exact:true});
 await search.fill('Краснодар');
 await page.getByRole('option',{name:'Краснодар',exact:true}).waitFor();
 assert.equal(await button.getAttribute('aria-expanded'),'true',label+': React event handling opens and filters city options');
 await button.click();
}

async function observeContext(context){
 await context.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.origin===origin)return route.continue();
  foreignRequests.add(url.origin);
  return route.abort();
 });
 await context.addInitScript(()=>{
  window.__blizhniyCspAcceptanceViolations=[];
  document.addEventListener('securitypolicyviolation',event=>{
   window.__blizhniyCspAcceptanceViolations.push({directive:event.effectiveDirective,disposition:event.disposition,inline:event.blockedURI==='inline'});
  });
 });
}

const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',viewport:{width:1440,height:1000}});
 await observeContext(context);
 const page=await context.newPage();
 const pageErrors=[];page.on('pageerror',()=>pageErrors.push('uncaught-page-error'));
 let clientRscSeen=false;
 page.on('response',response=>{if(new URL(response.url()).pathname==='/kak-rabotaet'&&(response.headers()['content-type']??'').includes('text/x-component'))clientRscSeen=true;});
 const nonces=new Set();
 for(const path of routes){
  const response=await page.goto(origin+path,{waitUntil:'networkidle'});
  const nonce=verifyPolicy(response,path);assert.ok(!nonces.has(nonce),path+': full document nonce is fresh');nonces.add(nonce);
  await assertDocumentScripts(page,nonce,path);
  if(path==='/katalog/posuda'){
   const structured=await page.locator('script[type="application/ld+json"]').evaluateAll(elements=>elements.map(element=>{
    const data=JSON.parse(element.textContent);
    return {nonce:element.nonce,context:data['@context'],types:(data['@graph']??[]).map(item=>item['@type'])};
   }));
   assert.ok(structured.length>0,'Catalog structured data remains present');
   assert.ok(structured.every(item=>item.nonce===nonce&&item.context==='https://schema.org'),'Catalog JSON-LD uses the document nonce and valid schema context');
   assert.ok(structured.some(item=>item.types.includes('BreadcrumbList')&&item.types.includes('CollectionPage')),'Catalog breadcrumb and collection SEO metadata remain intact');
  }
  await assertHydrates(page,path);
  assert.deepEqual(await page.evaluate(()=>window.__blizhniyCspAcceptanceViolations),[],path+': no unexpected CSP violations');
 }
 const first=verifyPolicy(await page.goto(origin+'/',{waitUntil:'networkidle'}),'reload initial');
 const second=verifyPolicy(await page.reload({waitUntil:'networkidle'}),'reload');
 assert.ok(first!==second,'Full reload rotates the nonce');
 await assertDocumentScripts(page,second,'reload');
 await assertHydrates(page,'reload');

 const documentTime=await page.evaluate(()=>performance.timeOrigin);
 await page.getByRole('navigation',{name:'Основная навигация',exact:true}).getByRole('link',{name:'Как работает',exact:true}).click();
 await page.waitForURL(origin+'/kak-rabotaet');await page.waitForLoadState('networkidle');
 assert.equal(await page.evaluate(()=>performance.timeOrigin),documentTime,'Next link navigation keeps the hydrated document');
 assert.ok(clientRscSeen,'Next link navigation uses an observed RSC response, including its prefetch cache');
 await assertHydrates(page,'client navigation');
 assert.deepEqual(await page.evaluate(()=>window.__blizhniyCspAcceptanceViolations),[],'Client navigation has no unexpected CSP violations');

 await page.setExtraHTTPHeaders({'x-nonce':incomingNonce,'Content-Security-Policy':"script-src 'unsafe-inline'",'Next-Router-Prefetch':'1',Purpose:'prefetch'});
 const forged=await page.goto(origin+'/',{waitUntil:'networkidle'});
 const forgedNonce=verifyPolicy(forged,'forged incoming nonce/CSP and prefetch headers');
 await assertDocumentScripts(page,forgedNonce,'forged incoming headers');await assertHydrates(page,'forged incoming headers');
 assert.deepEqual(await page.evaluate(()=>window.__blizhniyCspAcceptanceViolations),[],'Forged incoming headers do not disrupt trusted hydration');
 await page.setExtraHTTPHeaders({});
 const missingNonce=verifyPolicy(await page.goto(origin+'/__csp-acceptance-missing.foo',{waitUntil:'networkidle'}),'unknown dotted path',404);
 await assertDocumentScripts(page,missingNonce,'unknown dotted path');
 assert.deepEqual(await page.evaluate(()=>window.__blizhniyCspAcceptanceViolations),[],'404 framework HTML keeps a working nonce policy');
 const api=await context.request.post(origin+'/api/account/session',{headers:{Origin:origin,'X-Blizhniy-Request':'1','Sec-Fetch-Site':'same-origin'},data:{}});
 assert.equal(api.status(),401,'Anonymous session read retains the existing unauthenticated rejection');
 assert.ok((api.headers()['content-security-policy']??'').includes("default-src 'none'"),'API keeps its existing non-HTML CSP');
 assert.ok(!(api.headers()['content-security-policy']??'').includes('nonce-'),'HTML middleware does not overwrite API CSP');

 const mobile=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await observeContext(mobile);
 const mobilePage=await mobile.newPage();mobilePage.on('pageerror',()=>pageErrors.push('mobile-uncaught-page-error'));
 const mobileNonce=verifyPolicy(await mobilePage.goto(origin+'/',{waitUntil:'networkidle'}),'mobile');
 await assertDocumentScripts(mobilePage,mobileNonce,'mobile');await assertHydrates(mobilePage,'mobile');
 await mobilePage.getByRole('button',{name:'Открыть меню',exact:true}).click();
 await mobilePage.getByRole('button',{name:'Закрыть меню',exact:true}).waitFor();
 await mobilePage.getByRole('button',{name:'Закрыть меню',exact:true}).click();
 assert.deepEqual(await mobilePage.evaluate(()=>window.__blizhniyCspAcceptanceViolations),[],'Mobile hydration has no unexpected CSP violations');
 assert.deepEqual(pageErrors,[],'Ordinary desktop/mobile pages have no uncaught browser errors');

 const injected=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',viewport:{width:1440,height:1000}});
 await observeContext(injected);
 await injected.route(origin+'/',async route=>{
  if(!route.request().isNavigationRequest()||route.request().resourceType()!=='document')return route.fallback();
  const response=await route.fetch();
  assert.equal(response.status(),200,'Synthetic injection uses the real local HTML response');
  const html=await response.text();assert.ok(html.includes('</body>'));
  const probe='<script>window.__blizhniyCspInlineExecuted=true</script><button type="button" id="blizhniy-csp-attribute-probe" onclick="window.__blizhniyCspAttributeExecuted=true">Synthetic CSP attribute probe</button>';
  await route.fulfill({response,body:html.replace('</body>',probe+'</body>')});
 });
 const probe=await injected.newPage(),reportStatuses=[];
 probe.on('response',response=>{if(response.url()===origin+'/api/csp-report')reportStatuses.push(response.status());});
 verifyPolicy(await probe.goto(origin+'/',{waitUntil:'networkidle'}),'synthetic HTML injection');
 await assertHydrates(probe,'synthetic HTML injection');
 await probe.locator('#blizhniy-csp-attribute-probe').click();
 await probe.waitForFunction(()=>window.__blizhniyCspAcceptanceViolations.some(event=>event.directive==='script-src-attr'));
 const result=await probe.evaluate(()=>({inlineExecuted:window.__blizhniyCspInlineExecuted===true,attributeExecuted:window.__blizhniyCspAttributeExecuted===true,violations:window.__blizhniyCspAcceptanceViolations}));
 assert.equal(result.inlineExecuted,false,'Synthetic no-nonce inline script is blocked');
 assert.equal(result.attributeExecuted,false,'Synthetic onclick attribute is blocked');
 for(const directive of ['script-src-elem','script-src-attr'])assert.ok(result.violations.some(event=>event.directive===directive&&event.disposition==='enforce'&&event.inline),'Expected enforced synthetic violation '+directive);
 assert.ok(result.violations.every(event=>['script-src-elem','script-src-attr'].includes(event.directive)&&event.disposition==='enforce'&&event.inline),'Synthetic scenario has only expected inline-script violations');
 const report=await context.request.post(origin+'/api/csp-report',{headers:{Origin:origin,'Content-Type':'application/csp-report'},data:JSON.stringify({'csp-report':{'effective-directive':'script-src-elem','violated-directive':'script-src-elem','blocked-uri':'inline',disposition:'enforce'}})});
 assert.equal(report.status(),204,'Sanitized synthetic CSP report collector');
 await probe.waitForTimeout(150);
 assert.ok(reportStatuses.length>=1&&reportStatuses.every(status=>status===204),'Browser CSP reports reach the local collector');
 console.log(JSON.stringify({passed:true,documentRoutes:routes.length,freshFullReloadNonce:true,nonceBits:192,hydration:true,clientNavigation:true,mobile:true,catalogJsonLd:true,missing404:true,incomingHeadersReplaced:true,apiCspPreserved:true,syntheticInlineBlocked:true,syntheticAttributeBlocked:true,syntheticViolations:result.violations.map(({directive,disposition})=>({directive,disposition})),browserReports:reportStatuses,foreignOriginsAborted:foreignRequests.size,foreignProvidersVerified:false,productionTouched:false}));
}finally{await browser.close();}
