// Real built page, isolated Chromium, synthetic same-origin transports only. Never merchant I/O.
import assert from 'node:assert/strict';import {test} from 'node:test';import {spawn} from 'node:child_process';
import {once} from 'node:events';import {createServer} from 'node:net';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {rootCertificates} from 'node:tls';import {randomBytes} from 'node:crypto';import {chromium} from 'playwright';
test('primary payment return reads only its owner order, survives loss of response, hides private state during rechecks and never creates charges',{timeout:90000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'blizhniy-payment-return-browser-'));let app,browser;
 try{
  const key=join(directory,'key'),ca=join(directory,'ca');await writeFile(key,randomBytes(32),{mode:0o600});await writeFile(ca,rootCertificates[0],{mode:0o600});
  const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const origin=`http://127.0.0.1:${port}`,owner='12345678-1234-4321-8765-123456789abc',other='32345678-1234-4321-8765-123456789abc',id='22345678-1234-4321-8765-123456789abc';
  const env={PATH:process.env.PATH,LANG:'C.UTF-8',NODE_ENV:'production',__NEXT_PROCESSED_ENV:'true',NEXT_TELEMETRY_DISABLED:'1',BLIZHNIY_AUTH_MODE:'postgres',
   BLIZHNIY_AUTH_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai',BLIZHNIY_DB_HOST:'17e86f80f26733d39ef4b84d.twc1.net',BLIZHNIY_DB_PORT:'5432',BLIZHNIY_DB_NAME:'blizhniy_prod',BLIZHNIY_DB_USER:'blizhniy_runtime',
   BLIZHNIY_DB_PASSWORD:'synthetic-ui-db-password',BLIZHNIY_DB_SSL_MODE:'verify-full',BLIZHNIY_DB_CA_FILE:ca,BLIZHNIY_AUTH_MAIL_KEY_FILE:key,BLIZHNIY_AUTH_RATE_SECRET:'synthetic-ui-only-rate-secret-not-used-by-api',
   BLIZHNIY_MAIL_MODE:'timeweb',BLIZHNIY_SMTP_USER:'notifications@ближний-ру.рф',BLIZHNIY_SMTP_PASSWORD:'synthetic-ui-smtp-password',TURNSTILE_SECRET_KEY:'synthetic-ui-captcha-secret',NEXT_PUBLIC_TURNSTILE_SITE_KEY:''};
  let output='';app=spawn(process.execPath,['--experimental-strip-types','--require','./tests/listing-form-browser-pg.cjs','node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{env,detached:true,stdio:['ignore','pipe','pipe']});
  for(const stream of [app.stdout,app.stderr])stream.on('data',chunk=>{output=(output+chunk).slice(-12000);});
  const deadline=Date.now()+20000;for(;;){assert.equal(app.exitCode,null,output);try{if((await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)})).ok)break;}catch(error){assert.ok(error.cause?.code==='ECONNREFUSED'||error.name==='TimeoutError');}assert.ok(Date.now()<deadline,'owned app starts');await new Promise(resolve=>setTimeout(resolve,100));}
  browser=await chromium.launch({headless:true});const context=await browser.newContext(),page=await context.newPage(),errors=[],foreign=[],calls=[];
  page.setDefaultTimeout(10000);page.on('pageerror',()=>errors.push('pageerror'));
  let active=owner,sessionGate=null,orderGate=null,fail=false,disabled=false;
  const order={id,creationKey:other,targetId:owner,targetRevision:'9007199254740993',tariffId:'listing-publication',amount:'199.99',durationDays:30,status:'created',createdAt:'2026-10-19T12:00:00.123456Z'};
  let snapshot={order,fulfillment:null};
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());if(['http:','https:'].includes(url.protocol)&&url.origin!==origin){foreign.push(url.host);return route.abort();}
   if(!url.pathname.startsWith('/api/account/')&&!url.pathname.startsWith('/api/payments'))return route.continue();
   assert.equal(request.headers().authorization,undefined);
   if(url.pathname.endsWith('/session')){if(sessionGate)await sessionGate;return active?route.fulfill({json:{user:{id:active,email:'fixture@example.invalid',role:'user',isBlocked:false}}}):route.fulfill({status:401,json:{error:{code:'UNAUTHENTICATED'}}});}
   assert.equal(url.pathname,'/api/account/listing-checkout');assert.equal(request.method(),'POST');const body=request.postDataJSON();calls.push(body);
   assert.deepEqual(body,{expectedOwnerId:body.expectedOwnerId,action:'order',paymentId:id});
   const result=body.expectedOwnerId===owner?snapshot:null;if(orderGate)await orderGate;
   if(fail)return route.abort();if(disabled)return route.fulfill({status:503,json:{error:{code:'CHECKOUT_DISABLED'}}});
   return route.fulfill({json:result});
  });
  assert.equal((await page.goto(origin+`/oplata/${id}`,{waitUntil:'domcontentloaded'})).status(),200);
  await page.getByRole('heading',{name:'Заказ подготовлен',exact:true}).waitFor();assert.equal(calls.length,1);
  snapshot={order:{...order,status:'pending'},fulfillment:null};await page.getByRole('button',{name:'Проверить статус',exact:true}).click();await page.getByRole('heading',{name:'Платёж обрабатывается',exact:true}).waitFor();
  snapshot={order:{...order,status:'succeeded'},fulfillment:null};await page.getByRole('button',{name:'Проверить статус',exact:true}).click();await page.getByRole('heading',{name:'Оплата подтверждена',exact:true}).waitFor();
  snapshot={...snapshot,fulfillment:{publishedAt:order.createdAt,expiresAt:'2026-11-18T12:00:00.123456Z'}};await page.getByRole('button',{name:'Проверить статус',exact:true}).click();await page.getByRole('heading',{name:'Размещение выполнено',exact:true}).waitFor();
  fail=true;await page.getByRole('button',{name:'Проверить статус',exact:true}).click();await page.getByRole('region',{name:'Статус оплаты',exact:true}).getByRole('alert').waitFor();assert.equal(await page.getByRole('heading',{name:'Размещение выполнено',exact:true}).isVisible(),true);
  assert.equal(await page.getByText('Последний полученный статус. Актуальность пока не подтверждена.',{exact:true}).isVisible(),true,await page.getByRole('region',{name:'Статус оплаты',exact:true}).innerText());
  fail=false;await page.getByRole('button',{name:'Проверить статус',exact:true}).click();await page.getByRole('region',{name:'Статус оплаты',exact:true}).getByRole('alert').waitFor({state:'hidden'});
  await page.addScriptTag({path:createRequire(import.meta.url).resolve('axe-core/axe.min.js')});
  for(const width of [320,768,1024,1440]){await page.setViewportSize({width,height:900});assert.equal(await page.locator('body').evaluate(node=>node.scrollWidth>innerWidth),false);
   assert.deepEqual(await page.evaluate(async()=>{const result=await window.axe.run(document.querySelector('section[aria-label="Статус оплаты"]'));return result.violations.filter(item=>['serious','critical'].includes(item.impact)).map(item=>item.id);}),[]);}
  await page.getByRole('region',{name:'Статус оплаты',exact:true}).screenshot({path:'/tmp/blizhniy-payment-return-browser.png'});
  await page.getByRole('button',{name:'Проверить статус',exact:true}).focus();await page.keyboard.press('Space');await page.getByRole('button',{name:'Проверить статус',exact:true}).waitFor();
  let releaseSession;sessionGate=new Promise(resolve=>{releaseSession=resolve;});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.getByText('Проверяем доступ. Данные заказа временно скрыты.',{exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'Размещение выполнено',exact:true}).count(),0);
  releaseSession();sessionGate=null;await page.getByRole('heading',{name:'Размещение выполнено',exact:true}).waitFor();
  let releaseOrder;orderGate=new Promise(resolve=>{releaseOrder=resolve;});const before=calls.length;await page.getByRole('button',{name:'Проверить статус',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[aria-busy="true"]'));
  active=other;await page.evaluate(()=>window.dispatchEvent(new Event('blizhniy-account-changed')));await page.getByText('Проверяем доступ. Данные заказа временно скрыты.',{exact:true}).waitFor();
  releaseOrder();orderGate=null;await page.getByText('Платёж недоступен.',{exact:false}).waitFor();assert.ok(calls.length>=before+2);assert.equal(calls.at(-1).expectedOwnerId,other);assert.equal(await page.getByRole('heading',{name:'Размещение выполнено',exact:true}).count(),0);
  active=null;await page.evaluate(()=>window.dispatchEvent(new Event('blizhniy-account-changed')));await page.getByRole('link',{name:'Войти и проверить оплату',exact:true}).waitFor();
  const signedOutCalls=calls.length;await page.waitForTimeout(100);assert.equal(calls.length,signedOutCalls);
  active=owner;disabled=true;await page.evaluate(()=>window.dispatchEvent(new Event('blizhniy-account-changed')));await page.getByText('Оплата пока недоступна. Новый платёж не создавался.',{exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'Размещение выполнено',exact:true}).count(),0);
  assert.deepEqual(errors,[]);assert.deepEqual(foreign,[]);
 }finally{await browser?.close();if(app&&app.exitCode===null){process.kill(-app.pid,'SIGTERM');await once(app,'exit');}await rm(directory,{recursive:true});}
});
