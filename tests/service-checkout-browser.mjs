// Real compiled Next/Chromium; local isolated transport only, no DB/provider.
import assert from 'node:assert/strict';import {test} from 'node:test';import {spawn} from 'node:child_process';import {once} from 'node:events';import {createServer} from 'node:net';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomBytes,randomUUID} from 'node:crypto';import {rootCertificates} from 'node:tls';import {createRequire} from 'node:module';import {chromium} from 'playwright';
test('service checkout preserves event terms and one purchase through lost replies, queue status and cancellation',{timeout:120000},async()=>{
 const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
 const origin='http://127.0.0.1:'+port,directory=await mkdtemp(join(tmpdir(),'blizhniy-service-checkout-ui-')),key=join(directory,'mail-key'),ca=join(directory,'ca');await writeFile(key,randomBytes(32),{mode:0o600});await writeFile(ca,rootCertificates[0],{mode:0o600});
 const env={PATH:process.env.PATH,LANG:'C.UTF-8',NODE_ENV:'production',__NEXT_PROCESSED_ENV:'true',NEXT_TELEMETRY_DISABLED:'1',BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai',BLIZHNIY_DB_HOST:'17e86f80f26733d39ef4b84d.twc1.net',BLIZHNIY_DB_PORT:'5432',BLIZHNIY_DB_NAME:'blizhniy_prod',BLIZHNIY_DB_USER:'blizhniy_runtime',BLIZHNIY_DB_PASSWORD:'synthetic-ui-db-password',BLIZHNIY_DB_SSL_MODE:'verify-full',BLIZHNIY_DB_CA_FILE:ca,BLIZHNIY_AUTH_MAIL_KEY_FILE:key,BLIZHNIY_AUTH_RATE_SECRET:'synthetic-renewal-ui-rate-key',BLIZHNIY_MAIL_MODE:'timeweb',BLIZHNIY_SMTP_USER:'notifications@ближний-ру.рф',BLIZHNIY_SMTP_PASSWORD:'synthetic-ui-mail-password',TURNSTILE_SECRET_KEY:'synthetic-ui-captcha-secret',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://127.0.0.1:3045',BLIZHNIY_LISTING_WORKFLOW:'postmoderation',BLIZHNIY_PLACEMENT_RENEWALS:'local-v1',BLIZHNIY_SERVICE_CHECKOUT:'local-v1'};
 const app=spawn(process.execPath,['--experimental-strip-types','--require','./tests/listing-form-browser-pg.cjs','node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{env,stdio:['ignore','pipe','pipe'],detached:true});let output='',browser;app.stdout.on('data',b=>output=(output+b).slice(-64000));app.stderr.on('data',b=>output=(output+b).slice(-64000));
 try{
  const deadline=Date.now()+20000;for(;;){assert.equal(app.exitCode,null,'Owned UI server stays running');try{if((await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)})).ok)break;}catch{assert.equal(app.exitCode,null,'Owned UI stays alive while starting');}assert.ok(Date.now()<deadline,'Owned UI starts');await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),actor=randomUUID(),errors=[],foreign=[],prepared=new Map(),writes=[],reads=[];page.on('pageerror',e=>errors.push(e.message));
  let signedIn=true;const dispatches=[],endedEvents=new Set();
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());if(['http:','https:'].includes(url.protocol)&&url.origin!==origin){foreign.push(url.hostname);return route.abort();}
   if(url.pathname==='/api/account/session')return route.fulfill({json:{user:signedIn?{id:actor,email:'synthetic-service@example.invalid',role:'user',isBlocked:false}:null}});
   if(['/api/account/fair-checkout','/api/account/marquee-checkout'].includes(url.pathname)){
    const command=request.postDataJSON(),kind=url.pathname.includes('/fair-')?'fair':'marquee';assert.equal(command.expectedOwnerId,actor);
    if(command.action==='preview')return route.fulfill({json:{publicationId:command.publicationId,revision:command.expectedRevision,tariff:{id:kind==='fair'?'fair-participation':'ad-marquee',name:kind==='fair'?'Ярмарка':'Бегущая строка',amount:kind==='fair'?'1000.00':'299.00',durationDays:kind==='fair'?null:7},fairEvent:kind==='fair'?{date:'2026-11-29',endsAt:'2026-11-29T21:00:00.000000Z'}:null,activePayment:null}});
    if(command.action==='intent'){reads.push(command.creationKey);return route.fulfill({json:prepared.get(command.creationKey)??null});}
    if(command.action==='order'){const order=[...prepared.values()].find(o=>o.id===command.paymentId);assert.ok(order);return route.fulfill({json:{order,eventEnded:endedEvents.has(order.id),fulfillment:null}});}
    if(command.action==='dispatch'){dispatches.push(command.paymentId);return route.fulfill({json:{confirmationUrl:'https://yookassa.ru/local-fixture/'+command.paymentId,isTest:true}});}
    assert.equal(request.method(),'PUT');assert.equal(prepared.has(command.creationKey),false);writes.push(command);
    prepared.set(command.creationKey,{id:randomUUID(),creationKey:command.creationKey,targetId:command.publicationId,targetRevision:command.expectedRevision,tariffId:command.expectedTariffId,amount:command.expectedAmount,durationDays:command.expectedDurationDays,status:'created',createdAt:'2026-11-13T10:00:00.000000Z',fairEvent:kind==='fair'?{date:command.expectedFairDate,endsAt:'2026-11-29T21:00:00.000000Z'}:null});return route.abort('failed');
   }
   if(url.pathname==='/api/account/checkout-cancellation'){
    const command=request.postDataJSON(),order=[...prepared.values()].find(o=>o.id===command.paymentId);assert.ok(order);assert.equal(command.expectedOwnerId,actor);
    if(request.method()==='PUT'){assert.equal(order.status,'created');order.status='failed';return route.fulfill({json:{paymentId:order.id,targetType:command.targetType,state:'cancelled'}});}return route.fulfill({json:null});
   }
   if(url.pathname==='/__local/payment'){
    const id=url.searchParams.get('intent'),kind=url.searchParams.get('type'),order=[...prepared.values()].find(o=>o.id===id);assert.ok(order);order.status='succeeded';
    return route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><html lang="ru"><meta charset="utf-8"><title>Синтетическая оплата</title><body><a href="/oplata/uslugi/${id}?type=${kind}">Вернуться к заказу</a></body></html>`});
   }
   return route.continue();
  });
  for(const kind of ['fair','marquee']){
   const target=randomUUID(),url=origin+`/cabinet/oplata-uslugi?type=${kind}&id=${target}&revision=2`;await page.goto(url,{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Перейти к оплате',exact:true}).waitFor();
   if(kind==='fair')await page.getByText('Ярмарка 29 ноября 2026 г.',{exact:false}).waitFor();else await page.getByText('Оплаченный срок начнётся после появления места.',{exact:false}).waitFor();
   await page.addScriptTag({path:createRequire(import.meta.url).resolve('axe-core/axe.min.js')});for(const width of [320,768,1024,1440]){await page.setViewportSize({width,height:900});assert.equal(await page.locator('body').evaluate(n=>n.scrollWidth>innerWidth),false);assert.deepEqual(await page.getByRole('main').evaluate(async n=>(await window.axe.run(n)).violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>v.id)),[]);}
   await page.screenshot({path:`/home/danil/.local/state/blizhniy/audit-checks/service-checkout-${kind}-20261113.png`});
   const before=writes.length;await page.getByRole('button',{name:'Перейти к оплате',exact:true}).click();await page.getByRole('main').getByRole('alert').waitFor();assert.equal(writes.length,before+1);const key=writes.at(-1).creationKey;assert.equal(new URL(page.url()).hash,'#checkout='+key);
   await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Проверить начатую оплату',exact:true}).waitFor();assert.equal(writes.length,before+1);await page.getByRole('button',{name:'Проверить начатую оплату',exact:true}).click();
   const order=prepared.get(key);await page.waitForURL(origin+`/oplata/uslugi/${order.id}?type=${kind}`);await page.getByRole('button',{name:'Открыть локальный симулятор',exact:true}).waitFor();assert.equal(reads.at(-1),key);assert.equal(writes.length,before+1);
   if(kind==='fair'){
    await page.getByRole('button',{name:'Отменить подготовку оплаты',exact:true}).click();await page.getByText('Оплата отменена',{exact:true}).waitFor();assert.equal(order.status,'failed');assert.equal(await page.getByRole('button',{name:'Открыть локальный симулятор',exact:true}).count(),0);assert.equal(dispatches.length,0);
   }else{
    await page.getByRole('button',{name:'Открыть локальный симулятор',exact:true}).click();await page.waitForURL(origin+`/__local/payment?intent=${order.id}&type=${kind}`);await page.getByRole('link',{name:'Вернуться к заказу',exact:true}).click();await page.getByText('Ожидаем место или проверку размещения.',{exact:false}).waitFor();assert.equal(dispatches.length,1);assert.equal(await page.getByRole('button',{name:'Открыть локальный симулятор',exact:true}).count(),0);
    signedIn=false;await page.evaluate(()=>window.dispatchEvent(new Event('blizhniy-account-changing')));await page.getByText('Данные оплаты временно скрыты.',{exact:false}).waitFor();assert.equal(await page.getByRole('main').getByText('299,00 ₽',{exact:true}).isVisible(),false);assert.equal(await page.getByRole('main').getByText('299,00 ₽',{exact:true}).evaluate(n=>n.parentElement.hidden&&n.parentElement.inert),true);
   }
  }
  signedIn=true;const endedOrder={...[...prepared.values()][0],id:randomUUID(),creationKey:randomUUID(),status:'succeeded'};prepared.set(endedOrder.creationKey,endedOrder);endedEvents.add(endedOrder.id);
  await page.goto(origin+`/oplata/uslugi/${endedOrder.id}?type=fair`,{waitUntil:'domcontentloaded'});await page.getByText('Ярмарка завершилась. Размещение не началось; обратитесь к администратору за возвратом.',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Открыть локальный симулятор',exact:true}).count(),0);
  endedOrder.status='created';await page.reload({waitUntil:'domcontentloaded'});await page.getByText('Эта ярмарка уже завершилась. Отмените подготовку оплаты и оформите заявку на новое событие.',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Открыть локальный симулятор',exact:true}).count(),0);await page.getByRole('button',{name:'Отменить подготовку оплаты',exact:true}).waitFor();
  assert.equal(writes.length,2);assert.deepEqual(errors,[]);assert.deepEqual(foreign,[]);await context.close();
 }catch(error){const page=browser?.contexts()[0]?.pages()[0];console.error(JSON.stringify({uiFailure:String(error.message).slice(0,500),url:page?.url(),body:page?await page.locator('body').innerText().catch(()=>null):null}));if(page)await page.screenshot({path:'/home/danil/.local/state/blizhniy/audit-checks/service-checkout-ui-failure.png'});throw error;}finally{await browser?.close();if(app.exitCode===null){process.kill(-app.pid,'SIGTERM');await once(app,'exit');}await rm(directory,{recursive:true,force:true});}
});
