import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { rootCertificates } from 'node:tls';
import { chromium } from 'playwright';

test('the built admin page reads TEST payment stages, paginates and clears the journal on denial', { timeout:60000 }, async () => {
 const probe=createServer();
 probe.listen(0,'127.0.0.1');
 await once(probe,'listening');
 const { port }=probe.address(), origin='http://127.0.0.1:'+port;
 await new Promise(resolve=>probe.close(resolve));
 const directory=await mkdtemp(join(tmpdir(),'blizhniy-journal-ui-')), key=join(directory,'key'), ca=join(directory,'ca');
 await writeFile(key,randomBytes(32),{mode:0o600});
 await writeFile(ca,rootCertificates[0],{mode:0o600});
 const env={
  PATH:process.env.PATH, LANG:'C.UTF-8', NODE_ENV:'production', __NEXT_PROCESSED_ENV:'true', NEXT_TELEMETRY_DISABLED:'1',
  BLIZHNIY_AUTH_MODE:'postgres', BLIZHNIY_AUTH_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai',
  BLIZHNIY_DB_HOST:'17e86f80f26733d39ef4b84d.twc1.net', BLIZHNIY_DB_PORT:'5432', BLIZHNIY_DB_NAME:'blizhniy_prod',
  BLIZHNIY_DB_USER:'blizhniy_runtime', BLIZHNIY_DB_PASSWORD:'synthetic-ui-db-password', BLIZHNIY_DB_SSL_MODE:'verify-full', BLIZHNIY_DB_CA_FILE:ca,
  BLIZHNIY_AUTH_MAIL_KEY_FILE:key, BLIZHNIY_AUTH_RATE_SECRET:'synthetic-ui-only-rate-secret-not-used-by-api',
  BLIZHNIY_MAIL_MODE:'timeweb', BLIZHNIY_SMTP_USER:'notifications@ближний-ру.рф', BLIZHNIY_SMTP_PASSWORD:'synthetic-ui-smtp-password',
  TURNSTILE_SECRET_KEY:'synthetic-ui-captcha-secret', BLIZHNIY_ADMIN_PAYMENT_JOURNAL:'test-v1',
  BLIZHNIY_PAYMENT_MODE:'test', BLIZHNIY_PAYMENT_SHOP_ID:'journal-browser',
 };
 const app=spawn(process.execPath,['--require','./tests/listing-form-browser-pg.cjs','node_modules/next/dist/bin/next',
  'start','--hostname','127.0.0.1','--port',String(port)],{env,stdio:['ignore','pipe','pipe']});
 let output='',browser;
 for(const stream of [app.stdout,app.stderr]) stream.on('data',data=>output=(output+data).slice(-6000));
 try {
  const deadline=Date.now()+20000;
  for (;;) {
   assert.equal(app.exitCode,null,output);
   try { if ((await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)})).ok) break; }
   catch { /* The fixture may still be starting. */ }
   assert.ok(Date.now()<deadline,output);
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  browser=await chromium.launch();
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const page=await context.newPage(), requests=[], foreign=[], legacy=[], errors=[];
  const id=index=>'10000000-0000-4000-8000-'+String(index).padStart(12,'0');
  const adminId=id(200), createdAt='2026-11-25T14:00:00.123456Z', effectAt='2026-11-25T14:01:00.123456Z';
  const row={
   id:id(1), targetId:id(201), targetType:'listing', amount:'199.30', createdAt, orderStatus:'created',
   providerStatus:'unknown', capturedAt:null, reconciliation:'blocked', reconciliationCode:'attempts_exhausted',
   fulfillment:'not_recorded', fulfilledAt:null, refund:'unavailable', refundedAt:null, compensation:'not_applicable',
  };
  const delivered={
   ...row, id:id(52), targetType:'application', orderStatus:'succeeded', providerStatus:'succeeded', capturedAt:effectAt,
   reconciliation:'completed', reconciliationCode:null, fulfillment:'delivered', fulfilledAt:effectAt,
   refund:'applied', refundedAt:effectAt, compensation:'applied',
  };
  const first=[delivered,...Array.from({length:49},(_,index)=>({...row,id:id(51-index)}))];
  const nextAfter={id:first.at(-1).id,createdAt};
  let role='admin', refuse=false, lost=false;
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if (['http:','https:'].includes(url.protocol) && url.origin!==origin) { foreign.push(url.hostname);return route.abort(); }
   if (url.pathname==='/api/account/session') return route.fulfill({json:{user:{id:adminId,email:'admin@example.invalid',role,isBlocked:false}}});
   if (url.pathname==='/api/admin/payment-journal') {
    const body=request.postDataJSON();
    requests.push({body,method:request.method(),csrf:request.headers()['x-blizhniy-request']});
    if (refuse) return route.fulfill({status:403,json:{error:{code:'ADMIN_REQUIRED'}}});
    if (lost) { lost=false;return route.abort(); }
    if (body.kind) return route.fulfill({json:{items:[delivered],nextAfter:null}});
    if (body.after) return route.fulfill({json:{items:[{...row,id:id(2)},row],nextAfter:null}});
    return route.fulfill({json:{items:first,nextAfter}});
   }
   if (url.pathname.startsWith('/api/admin/')) { legacy.push(url.pathname);return route.abort(); }
   return route.continue();
  });
  await page.goto(origin+'/admin/payments',{waitUntil:'domcontentloaded'});
  const region=page.getByRole('region',{name:'Журнал TEST-платежей'}), cards=region.getByRole('listitem');
  const deliveredLabel=region.getByText('Отклик доставлен');
  await deliveredLabel.waitFor();
  assert.equal(await cards.count(),50);
  await region.getByText('Исчерпаны попытки',{exact:true}).first().waitFor();
  await region.getByText('Результат отправки неизвестен',{exact:true}).first().waitFor();
  await region.getByText('Применена',{exact:true}).waitFor();
  assert.ok(await region.evaluate(element=>element.scrollWidth<=element.clientWidth));
  await region.getByRole('button',{name:'Следующие платежи'}).click();
  await cards.nth(1).waitFor();
  assert.equal(await cards.count(),2);
  assert.deepEqual(requests.at(-1),{body:{expectedAdminId:adminId,kind:null,status:null,after:nextAfter},method:'POST',csrf:'1'});
  await region.getByLabel('Тип платежа').selectOption('application');
  await deliveredLabel.waitFor();
  await region.getByLabel('Статус заказа').selectOption('succeeded');
  await deliveredLabel.waitFor();
  assert.deepEqual(requests.at(-1).body,{expectedAdminId:adminId,kind:'application',status:'succeeded',after:null});
  lost=true;
  const refresh=region.getByRole('button',{name:'Обновить журнал'});
  await refresh.click();
  await region.getByRole('alert').getByText('Журнал платежей недоступен. Повторите загрузку.').waitFor();
  await refresh.click();
  await deliveredLabel.waitFor();
  refuse=true;
  await refresh.click();
  await region.getByRole('alert').getByText('Доступ администратора не подтверждён.').waitFor();
  assert.equal(await cards.count(),0);
  assert.equal(await region.getByText('По выбранным условиям платежей нет.').count(),0);
  refuse=false;
  await refresh.click();
  await region.getByText('Идентификаторы заказа и назначения').click();
  await region.getByText('Заказ '+delivered.id,{exact:true}).waitFor();
  role='user';
  const before=requests.length;
  await page.evaluate(()=>window.dispatchEvent(new Event('blizhniy-account-changed')));
  await region.waitFor({state:'detached'});
  assert.equal(await page.getByText('Заказ '+delivered.id,{exact:true}).count(),0);
  assert.equal(requests.length,before);
  assert.deepEqual(errors,[]);
  assert.deepEqual(foreign,[]);
  assert.deepEqual(legacy,[]);
 } finally {
  await browser?.close();
  if (app.exitCode===null) { app.kill();await once(app,'exit'); }
  await rm(directory,{recursive:true,force:true});
 }
});
