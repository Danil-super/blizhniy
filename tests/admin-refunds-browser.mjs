// Actual Next production UI with isolated session/provider transport. Never reads dotenv or a real DB/provider.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {rootCertificates} from 'node:tls';
import {randomBytes,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';

test('local refund admin UI preserves uncertain IDs, scopes private data to current actor and stays accessible',{timeout:120000},async()=>{
 const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const origin='http://127.0.0.1:'+port,directory=await mkdtemp(join(tmpdir(),'blizhniy-refund-ui-')),key=join(directory,'key'),ca=join(directory,'ca');
 await writeFile(key,randomBytes(32),{mode:0o600});await writeFile(ca,rootCertificates[0],{mode:0o600});
 const env={PATH:process.env.PATH,LANG:'C.UTF-8',NODE_ENV:'production',__NEXT_PROCESSED_ENV:'true',NEXT_TELEMETRY_DISABLED:'1',
  BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai',BLIZHNIY_DB_HOST:'17e86f80f26733d39ef4b84d.twc1.net',BLIZHNIY_DB_PORT:'5432',BLIZHNIY_DB_NAME:'blizhniy_prod',BLIZHNIY_DB_USER:'blizhniy_runtime',BLIZHNIY_DB_PASSWORD:'synthetic-ui-db-password',BLIZHNIY_DB_SSL_MODE:'verify-full',BLIZHNIY_DB_CA_FILE:ca,
  BLIZHNIY_AUTH_MAIL_KEY_FILE:key,BLIZHNIY_AUTH_RATE_SECRET:'synthetic-ui-only-rate-secret-not-used-by-api',BLIZHNIY_MAIL_MODE:'timeweb',BLIZHNIY_SMTP_USER:'notifications@ближний-ру.рф',BLIZHNIY_SMTP_PASSWORD:'synthetic-ui-smtp-password',TURNSTILE_SECRET_KEY:'synthetic-ui-captcha-secret',
  BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://127.0.0.1:3045',BLIZHNIY_REFUND_ADMIN:'local-test'};
 const app=spawn(process.execPath,['--experimental-strip-types','--require','./tests/listing-form-browser-pg.cjs','node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{env,stdio:['ignore','pipe','pipe'],detached:true});
 let output='',browser;app.stdout.on('data',data=>output=(output+data).slice(-64000));app.stderr.on('data',data=>output=(output+data).slice(-64000));
 try{
  const deadline=Date.now()+20000;for(;;){assert.equal(app.exitCode,null,'owned Next fixture stays alive');try{if((await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)})).ok)break;}catch{ /* Wait only for the owned fixture. */ }assert.ok(Date.now()<deadline,'owned Next fixture starts');await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),calls=[],foreign=[],legacy=[],errors=[];
  page.on('pageerror',error=>errors.push(error.message));let role='admin',actor='22222222-2222-4222-8222-222222222222',lost=true,gate,entered;
  const id=randomUUID(),recoveryId=randomUUID(),providerId=randomUUID();
  const row={id,targetType:'listing',targetId:randomUUID(),amount:'199.00',createdAt:'2026-11-12T10:00:00.123456Z',status:'succeeded',capturedAt:'2026-11-12T10:01:00Z',operationId:null,attempted:false,approvalId:null,reason:null,approvedAt:null,providerRefundId:null,refundStatus:null,appliedAt:null};
  const unknown={...row,id:randomUUID(),targetType:'workRequest',targetId:randomUUID(),operationId:recoveryId,attempted:true,approvalId:recoveryId,reason:'Возврат за ошибочное размещение.',approvedAt:'2026-11-12T10:02:00Z'};
  const rows=[row,unknown],stale={...row,id:randomUUID(),targetId:randomUUID(),canRefund:true},failedClear={...stale,id:randomUUID(),targetId:randomUUID()};let approval;
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());if(['http:','https:'].includes(url.protocol)&&url.origin!==origin){foreign.push(url.hostname);return route.abort();}
   if(url.pathname==='/api/account/session')return route.fulfill({json:{user:{id:actor,email:'synthetic-admin@example.invalid',role,isBlocked:false}}});
   if(url.pathname==='/api/admin/refunds'){
    const command=req.postDataJSON();calls.push(command);assert.equal(req.method(),'POST');assert.equal(req.headers()['x-blizhniy-request'],'1');assert.equal(req.headers().authorization,undefined);
    if(command.action==='list'){if(gate){entered();await gate;}return route.fulfill({json:{items:rows,nextAfter:null}});}
    if(command.action==='approve'){
     if(command.input.paymentIntentId===stale.id||command.input.paymentIntentId===failedClear.id){(command.input.paymentIntentId===stale.id?stale:failedClear).canRefund=false;return route.fulfill({status:409,json:{error:{code:'REFUND_NOT_LATEST'}}});}
     approval={...command.input,amount:row.amount,approvedAt:'2026-11-12T10:02:00Z'};Object.assign(row,{approvalId:approval.id,reason:approval.reason,approvedAt:approval.approvedAt});
     if(lost){lost=false;return route.abort();}return route.fulfill({json:approval});
    }
    if(command.action==='read')return route.fulfill({json:approval});
    assert.equal(command.action,'recover');assert.equal(command.input.operationId,recoveryId);assert.equal(command.input.providerRefundId,providerId);
    Object.assign(unknown,{providerRefundId:providerId,refundStatus:'succeeded',appliedAt:'2026-11-12T10:04:00Z',status:'refunded'});
    return route.fulfill({json:{actionId:command.input.id,operationId:recoveryId,providerRefundId:providerId,status:'succeeded',state:'applied'}});
   }
   if(url.pathname.startsWith('/api/admin/')){legacy.push(url.pathname);return route.fulfill({status:503,json:{error:{code:'FORBIDDEN_LEGACY'}}});}
   return route.continue();
  });
  await page.goto(origin+'/admin/payments',{waitUntil:'domcontentloaded'});const region=()=>page.getByRole('region',{name:'Локальный журнал возвратов',exact:true});
  await region().getByRole('button',{name:'Вернуть плату',exact:true}).waitFor();
  await region().getByRole('button',{name:'Вернуть плату',exact:true}).click();const form=page.getByRole('form',{name:'Решение о полном возврате',exact:true});
  await form.getByRole('textbox',{name:'Причина',exact:true}).fill('Возврат по обращению владельца.');await form.getByRole('checkbox').check();await form.getByRole('button',{name:'Подтвердить возврат',exact:true}).click();
  await region().getByText('Результат операции не подтверждён.',{exact:false}).waitFor();
  await region().getByRole('alert').waitFor();assert.equal(calls.filter(c=>c.action==='approve').length,1);const original=calls.find(c=>c.action==='approve');await region().getByText(original.input.id,{exact:true}).waitFor();
  await page.reload({waitUntil:'domcontentloaded'});await region().getByRole('button',{name:'Проверить сохранённое решение',exact:true}).waitFor();assert.equal(calls.filter(c=>c.action==='approve').length,1);
  await region().getByRole('button',{name:'Проверить сохранённое решение',exact:true}).click();await region().getByText('Решение о возврате сохранено. Обработчик выполнит возврат отдельно.',{exact:true}).waitFor();assert.equal(calls.find(c=>c.action==='read').input,original.input.id);
  await region().getByRole('button',{name:'Сверить по номеру ЮKassa',exact:true}).click();const recover=page.getByRole('form',{name:'Сверка возврата',exact:true});
  await recover.getByRole('textbox',{name:/Номер возврата в ЮKassa/}).fill(providerId);await recover.getByRole('textbox',{name:'Причина',exact:true}).fill('Сверка известного возврата после потери ответа.');await recover.getByRole('button',{name:'Сверить возврат',exact:true}).click();
  await region().getByText('Результат возврата проверен. Обновите журнал для текущего состояния.',{exact:true}).waitFor();await region().getByRole('button',{name:'Обновить журнал',exact:true}).click();await region().getByText('Возврат выполнен',{exact:true}).waitFor();assert.equal(calls.filter(c=>c.action==='recover').length,1);
  rows.push(stale);await region().getByRole('button',{name:'Обновить журнал',exact:true}).click();await region().getByRole('button',{name:'Вернуть плату',exact:true}).click();
  await form.getByRole('textbox',{name:'Причина',exact:true}).fill('Возврат более ранней покупки.');await form.getByRole('checkbox').check();await form.getByRole('button',{name:'Подтвердить возврат',exact:true}).click();
  await region().getByText('Решение не принято. Сначала верните последнюю покупку и завершите начатую оплату. Обновите журнал.',{exact:true}).waitFor();
  assert.equal(await region().getByRole('heading',{name:'Сохранённая операция',exact:true}).count(),0);assert.equal(await page.evaluate(actor=>sessionStorage.getItem('blizhniy-refund-action:'+actor),actor),null);
  await region().getByRole('button',{name:'Обновить журнал',exact:true}).click();await region().getByText('Для возврата начните с последней покупки и завершите начатую оплату.',{exact:true}).waitFor();assert.equal(await region().getByRole('button',{name:'Вернуть плату',exact:true}).count(),0);
  await page.addScriptTag({path:createRequire(import.meta.url).resolve('axe-core/axe.min.js')});
  for(const width of [320,768,1024,1440]){
   await page.setViewportSize({width,height:900});assert.equal(await page.locator('body').evaluate(node=>node.scrollWidth>innerWidth),false);
   const failures=await region().evaluate(async node=>(await window.axe.run(node)).violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>v.id));assert.deepEqual(failures,[]);
  }
  await page.screenshot({path:'/home/danil/.local/state/blizhniy/audit-checks/refund-admin-1440-20261112.png',fullPage:true});
  let release;gate=new Promise(r=>release=r);const started=new Promise(r=>entered=r);await region().getByRole('button',{name:'Обновить журнал',exact:true}).click();await started;
  role='user';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByText('У этого аккаунта нет роли администратора.',{exact:true}).waitFor();release();gate=undefined;
  assert.equal(await region().count(),0);assert.equal(await page.getByText(row.id.slice(0,8),{exact:false}).count(),0);
  actor='44444444-4444-4444-8444-444444444444';role='admin';await page.reload({waitUntil:'domcontentloaded'});await region().getByRole('button',{name:'Обновить журнал',exact:true}).waitFor();await region().getByText('Возврат выполнен',{exact:true}).waitFor();
  assert.equal(await region().getByRole('heading',{name:'Сохранённая операция',exact:true}).count(),0);assert.equal(calls.at(-1).expectedAdminId,actor);
  rows.push(failedClear);await region().getByRole('button',{name:'Обновить журнал',exact:true}).click();await region().getByRole('button',{name:'Вернуть плату',exact:true}).click();
  await page.evaluate(()=>{const original=Storage.prototype.removeItem;Storage.prototype.removeItem=function(key){if(key.startsWith('blizhniy-refund-action:'))throw Error('Synthetic removal failure');return original.call(this,key);};});
  await form.getByRole('textbox',{name:'Причина',exact:true}).fill('Проверка отказа очистки операции.');await form.getByRole('checkbox').check();await form.getByRole('button',{name:'Подтвердить возврат',exact:true}).click();
  await region().getByText('Браузер не очистил отклонённое решение. Новые решения недоступны.',{exact:true}).waitFor();assert.equal(await region().getByRole('button',{name:'Повторить ту же операцию',exact:true}).isDisabled(),true);
  const retained=calls.at(-1);assert.equal(retained.action,'approve');assert.equal(await page.evaluate(actor=>JSON.parse(sessionStorage.getItem('blizhniy-refund-action:'+actor)).input.id,actor),retained.input.id);
  await page.reload({waitUntil:'domcontentloaded'});await region().getByRole('button',{name:'Повторить ту же операцию',exact:true}).click();await region().getByText('Решение не принято. Сначала верните последнюю покупку и завершите начатую оплату. Обновите журнал.',{exact:true}).waitFor();assert.equal(calls.at(-1).input.id,retained.input.id);assert.equal(await page.evaluate(actor=>sessionStorage.getItem('blizhniy-refund-action:'+actor),actor),null);
  rows.push({...row,id:randomUUID(),targetId:randomUUID(),approvalId:null,reason:null,approvedAt:null});const beforeBlocked=calls.filter(c=>c.action==='approve').length;
  await page.addInitScript(()=>Object.defineProperty(window,'sessionStorage',{get(){throw Error('Synthetic blocked storage');}}));
  await page.reload({waitUntil:'domcontentloaded'});await region().locator('p').filter({hasText:'Браузер не может прочитать сохранённую операцию. Новые решения о возврате недоступны.'}).waitFor();
  const blockedButton=region().getByRole('button',{name:'Вернуть плату',exact:true});await blockedButton.waitFor();assert.equal(await blockedButton.isDisabled(),true);assert.equal(calls.filter(c=>c.action==='approve').length,beforeBlocked);
  assert.deepEqual(legacy,[]);assert.deepEqual(foreign,[]);assert.deepEqual(errors,[]);await context.close();
 }finally{
  await browser?.close();if(app.exitCode===null){process.kill(-app.pid,'SIGTERM');await once(app,'exit');}await rm(directory,{recursive:true,force:true});
 }
});
