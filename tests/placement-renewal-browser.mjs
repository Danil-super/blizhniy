// Real compiled Next/Chromium; local isolated transport only, no DB/provider.
import assert from 'node:assert/strict';import {test} from 'node:test';import {spawn} from 'node:child_process';import {once} from 'node:events';import {createServer} from 'node:net';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomBytes,randomUUID} from 'node:crypto';import {rootCertificates} from 'node:tls';import {createRequire} from 'node:module';import {chromium} from 'playwright';
for(const hosted of [false,true])test((hosted?'hosted TEST':'local simulator')+' renewal UI preserves one attempt through a lost reply/reload for all three target types',{timeout:120000},async()=>{
 const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
 const origin='http://127.0.0.1:'+port,directory=await mkdtemp(join(tmpdir(),'blizhniy-renewal-ui-')),key=join(directory,'mail-key'),ca=join(directory,'ca');await writeFile(key,randomBytes(32),{mode:0o600});await writeFile(ca,rootCertificates[0],{mode:0o600});
 const env={PATH:process.env.PATH,LANG:'C.UTF-8',NODE_ENV:'production',__NEXT_PROCESSED_ENV:'true',NEXT_TELEMETRY_DISABLED:'1',BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai',BLIZHNIY_DB_HOST:'17e86f80f26733d39ef4b84d.twc1.net',BLIZHNIY_DB_PORT:'5432',BLIZHNIY_DB_NAME:'blizhniy_prod',BLIZHNIY_DB_USER:'blizhniy_runtime',BLIZHNIY_DB_PASSWORD:'synthetic-ui-db-password',BLIZHNIY_DB_SSL_MODE:'verify-full',BLIZHNIY_DB_CA_FILE:ca,BLIZHNIY_AUTH_MAIL_KEY_FILE:key,BLIZHNIY_AUTH_RATE_SECRET:'synthetic-renewal-ui-rate-key',BLIZHNIY_MAIL_MODE:'timeweb',BLIZHNIY_SMTP_USER:'notifications@ближний-ру.рф',BLIZHNIY_SMTP_PASSWORD:'synthetic-ui-mail-password',TURNSTILE_SECRET_KEY:'synthetic-ui-captcha-secret',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://127.0.0.1:3045',BLIZHNIY_LISTING_WORKFLOW:'postmoderation',BLIZHNIY_PLACEMENT_RENEWALS:'local-v1'};
 if(hosted){
  delete env.BLIZHNIY_LOCAL_PRIMARY;delete env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN;
  Object.assign(env,{BLIZHNIY_PLACEMENT_RENEWALS:'account-publication-test',BLIZHNIY_LISTING_PAYMENT:'account-publication-test',
   BLIZHNIY_LISTING_CHECKOUT:'prepare-only',BLIZHNIY_PAYMENT_MODE:'test',BLIZHNIY_PAYMENT_TEST_USER_ID:'10000000-0000-4000-8000-000000000001',
   BLIZHNIY_PAYMENT_SHOP_ID:'900000001',BLIZHNIY_PAYMENT_RECEIPT_VAT:'1',YOOKASSA_SHOP_ID:'900000001',YOOKASSA_SECRET_KEY:'test_synthetic_only'});
 }
 const app=spawn(process.execPath,['--experimental-strip-types','--require','./tests/listing-form-browser-pg.cjs','node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{env,stdio:['ignore','pipe','pipe'],detached:true});let output='',browser;app.stdout.on('data',b=>output=(output+b).slice(-64000));app.stderr.on('data',b=>output=(output+b).slice(-64000));
 try{
  const deadline=Date.now()+20000;for(;;){assert.equal(app.exitCode,null,'Owned UI server stays running');try{if((await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)})).ok)break;}catch{assert.equal(app.exitCode,null,'Owned UI stays alive while starting');}assert.ok(Date.now()<deadline,'Owned UI starts');await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),actor=randomUUID(),errors=[],foreign=[],prepared=new Map(),writes=[],reads=[];page.on('pageerror',e=>errors.push(e.message));
  const conflictingId=randomUUID(),conflicts=[];let enrolled=!hosted;
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());if(['http:','https:'].includes(url.protocol)&&url.origin!==origin){foreign.push(url.hostname);return route.abort();}
   if(url.pathname==='/api/account/session')return route.fulfill({headers:hosted&&enrolled?{'X-Blizhniy-Work-Publication-Test':'1'}:{},json:{user:{id:actor,email:'synthetic-renewal@example.invalid',role:'user',isBlocked:false}}});
   if(['/api/account/listing-checkout','/api/account/vacancy-checkout','/api/account/work-request-checkout'].includes(url.pathname)){
    if(hosted)assert.equal(enrolled,true);
    const command=request.postDataJSON();assert.equal(command.expectedOwnerId,actor);assert.equal(request.headers()['x-blizhniy-request'],'1');
    if(command.action==='testPreview')return route.fulfill({json:{listingId:command.listingId,revision:command.expectedRevision,tariff:{id:'renewal-offer',name:'Дополнительный срок',amount:'199.00',currency:'RUB',durationDays:30},activePayment:null}});
    if(command.action==='intent'){reads.push(command.creationKey);return route.fulfill({json:prepared.get(command.creationKey)??null});}
    if(command.action==='order'){const order=[...prepared.values()].find(o=>o.id===command.paymentId);assert.ok(order);return route.fulfill({json:{order,fulfillment:null}});}
    if(command.listingId===conflictingId){assert.equal(request.method(),'PUT');conflicts.push(command);return route.fulfill({status:409,json:{error:{code:'CHECKOUT_CHANGED'}}});}
    assert.equal(request.method(),'PUT');writes.push(command);assert.equal(prepared.has(command.creationKey),false,'No second write for an unresolved key');
    const order={id:randomUUID(),creationKey:command.creationKey,targetId:command.listingId,targetRevision:command.expectedRevision,tariffId:command.expectedTariffId,amount:command.expectedAmount,durationDays:command.expectedDurationDays,status:'created',createdAt:new Date().toISOString().replace(/(\.\d{3})Z$/,'$1000Z')};prepared.set(command.creationKey,order);return route.abort('failed');
   }
   return route.continue();
  });
  if(hosted){
   await page.goto(origin+`/cabinet/prodlit?type=listing&id=${randomUUID()}&revision=2`,{waitUntil:'domcontentloaded'});
   await page.getByText('TEST-продление недоступно этому аккаунту.',{exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Оплатить продление',exact:true}).count(),0);
   enrolled=true;
  }
  for(const kind of ['listing','vacancy','workRequest']){
   const id=randomUUID(),url=origin+`/cabinet/prodlit?type=${kind}&id=${id}&revision=2`;await page.goto(url,{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Оплатить продление',exact:true}).waitFor();await page.getByText('Оставшееся оплаченное время сохранится.',{exact:false}).waitFor();
   if(hosted)await page.getByText('TEST-оплата, без списания денег.',{exact:true}).waitFor();
   await page.addScriptTag({path:createRequire(import.meta.url).resolve('axe-core/axe.min.js')});for(const width of [320,768,1440]){await page.setViewportSize({width,height:900});assert.equal(await page.locator('body').evaluate(n=>n.scrollWidth>innerWidth),false);assert.deepEqual(await page.getByRole('main').evaluate(async n=>(await window.axe.run(n)).violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>v.id)),[]);}
   const count=writes.length;await page.getByRole('button',{name:'Оплатить продление',exact:true}).click();await page.getByRole('main').getByRole('alert').waitFor();assert.equal(writes.length,count+1);const key=writes.at(-1).creationKey;assert.equal(new URL(page.url()).hash,'#checkout='+key);
   await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Проверить начатую оплату',exact:true}).waitFor();assert.equal(writes.length,count+1);assert.equal(await page.getByRole('button',{name:'Оплатить продление',exact:true}).count(),0);
   await page.getByRole('button',{name:'Проверить начатую оплату',exact:true}).click();await page.waitForURL(origin+'/oplata/'+prepared.get(key).id+(kind==='listing'?'':'?type='+kind),{waitUntil:'domcontentloaded',timeout:15000}).catch(async error=>{console.error(JSON.stringify({at:page.url(),readKeys:reads,lastKey:key,alerts:await page.getByRole('alert').allTextContents(),statuses:await page.getByRole('status').allTextContents()}));throw error;});assert.equal(reads.at(-1),key);assert.equal(writes.length,count+1);
  }
  await page.goto(origin+`/cabinet/prodlit?type=listing&id=${conflictingId}&revision=2`,{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Оплатить продление',exact:true}).click();
  await page.getByRole('alert').getByText('Условия продления изменились.',{exact:false}).waitFor({timeout:5000});
  const rejectedKey=conflicts.at(-1).creationKey;
  assert.equal(new URL(page.url()).hash,'#checkout='+rejectedKey);
  await page.getByRole('button',{name:'Проверить начатую оплату',exact:true}).click();
  await page.getByText('Заказ пока не найден.',{exact:false}).waitFor();
  assert.equal(reads.at(-1),rejectedKey);
  assert.equal(prepared.has(rejectedKey),false);
  assert.equal(conflicts.length,1);
  assert.equal(writes.length,3);assert.deepEqual(errors,[]);assert.deepEqual(foreign,[]);await context.close();
 }catch(error){console.error(JSON.stringify({uiFailure:String(error.message).slice(0,500)}));throw error;}finally{await browser?.close();if(app.exitCode===null){process.kill(-app.pid,'SIGTERM');await once(app,'exit');}await rm(directory,{recursive:true,force:true});}
});
