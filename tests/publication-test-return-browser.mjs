// Real built page, isolated Chromium, synthetic same-origin transports only. Never merchant I/O.
import assert from 'node:assert/strict';import {test} from 'node:test';import {spawn} from 'node:child_process';
import {once} from 'node:events';import {createServer} from 'node:net';import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {rootCertificates} from 'node:tls';import {randomBytes} from 'node:crypto';import {chromium} from 'playwright';
test('TEST return waits for publication, keeps its saved TEST label and returns to the matching cabinet',{timeout:90000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'blizhniy-payment-return-browser-'));let app,browser;
 try{
  const key=join(directory,'key'),ca=join(directory,'ca');await writeFile(key,randomBytes(32),{mode:0o600});await writeFile(ca,rootCertificates[0],{mode:0o600});
  const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const origin=`http://127.0.0.1:${port}`,owner='12345678-1234-4321-8765-123456789abc',other='32345678-1234-4321-8765-123456789abc',id='22345678-1234-4321-8765-123456789abc';
  const env={PATH:process.env.PATH,LANG:'C.UTF-8',NODE_ENV:'production',__NEXT_PROCESSED_ENV:'true',NEXT_TELEMETRY_DISABLED:'1',BLIZHNIY_AUTH_MODE:'postgres',
   BLIZHNIY_AUTH_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai',BLIZHNIY_LISTING_WORKFLOW:'postmoderation',BLIZHNIY_LISTING_PAYMENT:'account-publication-test',
   BLIZHNIY_CHECKOUT_CANCELLATION:'hosted-test-v1',BLIZHNIY_LISTING_CHECKOUT:'prepare-only',BLIZHNIY_PAYMENT_MODE:'test',
   BLIZHNIY_PAYMENT_SHOP_ID:'12345678',YOOKASSA_SHOP_ID:'12345678',YOOKASSA_SECRET_KEY:'test_browser_synthetic_only',
   BLIZHNIY_PAYMENT_RECEIPT_VAT:'1',BLIZHNIY_PAYMENT_TEST_USER_ID:owner,
   BLIZHNIY_DB_HOST:'17e86f80f26733d39ef4b84d.twc1.net',BLIZHNIY_DB_PORT:'5432',BLIZHNIY_DB_NAME:'blizhniy_prod',BLIZHNIY_DB_USER:'blizhniy_runtime',
   BLIZHNIY_DB_PASSWORD:'synthetic-ui-db-password',BLIZHNIY_DB_SSL_MODE:'verify-full',BLIZHNIY_DB_CA_FILE:ca,BLIZHNIY_AUTH_MAIL_KEY_FILE:key,BLIZHNIY_AUTH_RATE_SECRET:'synthetic-ui-only-rate-secret-not-used-by-api',
   BLIZHNIY_MAIL_MODE:'timeweb',BLIZHNIY_SMTP_USER:'notifications@ближний-ру.рф',BLIZHNIY_SMTP_PASSWORD:'synthetic-ui-smtp-password',TURNSTILE_SECRET_KEY:'synthetic-ui-captcha-secret',NEXT_PUBLIC_TURNSTILE_SITE_KEY:''};
  let output='';app=spawn(process.execPath,['--experimental-strip-types','--require','./tests/listing-form-browser-pg.cjs','node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{env,detached:true,stdio:['ignore','pipe','pipe']});
  for(const stream of [app.stdout,app.stderr])stream.on('data',chunk=>{output=(output+chunk).slice(-12000);});
  const deadline=Date.now()+20000;for(;;){assert.equal(app.exitCode,null,output);try{if((await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)})).ok)break;}catch(error){assert.ok(error.cause?.code==='ECONNREFUSED'||error.name==='TimeoutError');}assert.ok(Date.now()<deadline,'owned app starts');await new Promise(resolve=>setTimeout(resolve,100));}
  browser=await chromium.launch({headless:true});const context=await browser.newContext(),page=await context.newPage(),errors=[],foreign=[],calls=[],cancellations=[];
  page.setDefaultTimeout(10000);page.on('pageerror',()=>errors.push('pageerror'));
  let active=owner,sessionGate=null,orderGate=null,fail=false,disabled=false,endpoint='/api/account/listing-checkout';
  const order={id,creationKey:other,targetId:owner,targetRevision:'9007199254740993',tariffId:'listing-publication',amount:'199.99',durationDays:30,status:'created',createdAt:'2026-10-19T12:00:00.123456Z'};
  let snapshot={order,fulfillment:null};
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());if(['http:','https:'].includes(url.protocol)&&url.origin!==origin){foreign.push(url.host);return route.abort();}
   if(!url.pathname.startsWith('/api/account/')&&!url.pathname.startsWith('/api/payments'))return route.continue();
   assert.equal(request.headers().authorization,undefined);
   if(url.pathname==='/api/account/session'){if(sessionGate)await sessionGate;return active?route.fulfill({json:{user:{id:active,email:'fixture@example.invalid',role:'user',isBlocked:false,...(active===owner?{workPublicationTest:true}:{})}}}):route.fulfill({status:401,json:{error:{code:'UNAUTHENTICATED'}}});}
   if(url.pathname==='/api/account/checkout-cancellation'){
    assert.equal(request.method(),'PUT');
    const input={paymentId:id,targetType:'workRequest'};
    assert.deepEqual(request.postDataJSON(),{...input,expectedOwnerId:owner});
    cancellations.push(input);
    snapshot={...snapshot,order:{...snapshot.order,status:'failed'}};
    return route.fulfill({json:{...input,state:'cancelled'}});
   }
   if(url.pathname!==endpoint){assert.equal(request.method(),'POST');return route.fulfill({status:503,json:{error:{code:'AUTH_UNAVAILABLE'}}});}
   assert.equal(request.method(),'POST');const body=request.postDataJSON();calls.push(body);
   assert.deepEqual(body,{expectedOwnerId:owner,action:'order',paymentId:id});
   const result=body.expectedOwnerId===owner?snapshot:null;if(orderGate)await orderGate;
   if(fail)return route.abort();if(disabled)return route.fulfill({status:503,json:{error:{code:'CHECKOUT_DISABLED'}}});
   return route.fulfill({json:result});
  });
  for(const [type,path,cabinet] of [['','listing-checkout','obyavleniya'],['vacancy','vacancy-checkout','vakansii'],['workRequest','work-request-checkout','zakazy']]){
   endpoint='/api/account/'+path;
   snapshot={order:{...order,status:'succeeded'},fulfillment:null,testPublication:true,testOnly:true};
   const url=origin+`/oplata/${id}`+(type?'?type='+type:'');
   assert.equal((await page.goto(url,{waitUntil:'domcontentloaded'})).status(),200);
   await page.getByRole('heading',{name:'Оплата подтверждена',exact:true}).waitFor();
   await page.getByText('Тестовый платёж · Без списания денег',{exact:true}).waitFor();
   await page.getByText('Размещение ещё не подтверждено. Не оплачивайте повторно; проверьте статус позже.',{exact:true}).waitFor();
   assert.equal(await page.getByText('Возвращаем в личный кабинет…',{exact:true}).count(),0);
   await page.waitForTimeout(2300);assert.equal(page.url(),url,'a provider success cannot masquerade as publication');
   snapshot={...snapshot,fulfillment:{publishedAt:order.createdAt,expiresAt:'2026-11-18T12:00:00.123456Z'}};
   await page.getByRole('button',{name:'Проверить статус',exact:true}).click();
   await page.getByRole('heading',{name:'Размещение выполнено',exact:true}).waitFor();
   await page.getByText('Тестовый платёж · Без списания денег',{exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Проверить статус',exact:true}).count(),0);
   assert.equal(await page.getByRole('link',{name:'Вернуться на сайт',exact:true}).getAttribute('href'),'/cabinet/'+cabinet);
   await page.waitForURL(origin+'/cabinet/'+cabinet);
  }
  endpoint='/api/account/listing-checkout';snapshot={order:{...order,status:'succeeded'},fulfillment:null,testOnly:true};
  await page.goto(origin+`/oplata/${id}`,{waitUntil:'domcontentloaded'});
  await page.getByText('TEST-платёж успешно проверен. Реальные деньги не списывались. Объявление не публикуется за тестовую оплату.',{exact:true}).waitFor();
  await page.waitForURL(origin+'/cabinet/obyavleniya');
  endpoint='/api/account/work-request-checkout';snapshot={order,fulfillment:null,testOnly:true,testPublication:true};
  await page.goto(origin+`/oplata/${id}?type=workRequest`,{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Отменить подготовку оплаты',exact:true}).click();
  await page.getByRole('heading',{name:'Платёж отменён',exact:true}).waitFor();
  assert.deepEqual(cancellations,[{paymentId:id,targetType:'workRequest'}]);
  assert.deepEqual(errors,[]);assert.deepEqual(foreign,[]);assert.ok(calls.length>=7);
 }finally{await browser?.close();if(app&&app.exitCode===null){process.kill(-app.pid,'SIGTERM');await once(app,'exit');}await rm(directory,{recursive:true});}
});
