// Compiled Next UI on loopback with synthetic session and operator replies. No production traffic.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {createServer} from 'node:net';
import {test} from 'node:test';
import {chromium} from 'playwright';

const url='/admin/publication-restrictions',api='/api/admin/publication-restriction';

async function withNext(enabled,check){
 const probe=createServer().listen(0,'127.0.0.1');
 await once(probe,'listening');
 const port=probe.address().port;
 await new Promise(resolve=>probe.close(resolve));
 const origin='http://127.0.0.1:'+port;
 const app=spawn(process.execPath,['--experimental-strip-types','--require','./tests/listing-form-browser-pg.cjs',
  'node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{
  env:{PATH:process.env.PATH,LANG:'C.UTF-8',NODE_ENV:'production',__NEXT_PROCESSED_ENV:'true',NEXT_TELEMETRY_DISABLED:'1',
   BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai',
   BLIZHNIY_DB_PLACEMENT:'same-host',BLIZHNIY_DB_HOST:'127.0.0.1',BLIZHNIY_DB_PASSWORD:'synthetic-ui-db-password',
   ...(enabled?{BLIZHNIY_PUBLICATION_RESTRICTION_OPERATOR:'hosted-v1'}:{})},
  stdio:['ignore','pipe','pipe'],detached:true,
 });
 let output='';
 for(const stream of [app.stdout,app.stderr])stream.on('data',data=>{output=(output+data).slice(-12000);});
 try{
  const deadline=Date.now()+20000;
  for(;;){
   assert.equal(app.exitCode,null,output);
   try{if((await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)})).ok)break;}catch{ /* Wait for owned fixture only. */ }
   assert.ok(Date.now()<deadline,output);
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  return await check(origin);
 }finally{
  if(app.exitCode===null){process.kill(-app.pid,'SIGTERM');await once(app,'exit');}
 }
}

test('publication restriction stays unavailable without the explicit runtime flag',{timeout:30000},async()=>{
 await withNext(false,async origin=>{
  assert.equal((await fetch(origin+url)).status,404);
  const result=await fetch(origin+api,{method:'POST'});
  assert.equal(result.status,404);
  assert.equal(result.headers.get('cache-control'),'no-store');
 });
});

test('admin confirms the inspected revision, repeats the same decision after loss and hides prior actor state',{timeout:90000},async()=>{
 await withNext(true,async origin=>{
  const browser=await chromium.launch({headless:true});
  try{
   const context=await browser.newContext({viewport:{width:390,height:900}}),page=await context.newPage();
   const foreign=[],pageErrors=[],calls=[];
   const outcomes=['lost','accepted','lost','conflict','denied'];
   page.on('pageerror',error=>pageErrors.push(error.message));
   let actor=randomUUID(),role='admin',restrictAttempts=0,waitForSession,sessionStarted;
   const publicationId=randomUUID(),caseId=randomUUID(),title='Синтетическая карточка в журнале жалоб';
   const preview={kind:'fair',publicationId,revision:'7',restricted:false,title};
   await context.route('**/*',async route=>{
    const req=route.request(),target=new URL(req.url());
    if(target.origin!==origin){foreign.push(target.origin);return route.abort();}
    if(target.pathname==='/api/account/session'){
     if(waitForSession){sessionStarted();await waitForSession;}
     return route.fulfill({json:{user:{id:actor,email:'synthetic-admin@example.invalid',role,isBlocked:false}}});
    }
    if(target.pathname!==api)return route.continue();
    const command=req.postDataJSON();
    calls.push(command);
    assert.equal(req.method(),'POST');
    assert.equal(req.headers()['x-blizhniy-request'],'1');
    if(command.action==='inspect')return route.fulfill({json:preview});
    const outcome=outcomes[restrictAttempts++];
    if(outcome==='lost')return route.abort();
    if(outcome==='conflict')return route.fulfill({status:409,json:{error:{code:'RESTRICTION_CONFLICT'}}});
    if(outcome==='denied')return route.fulfill({status:401,json:{error:{code:'UNAUTHENTICATED'}}});
    return route.fulfill({json:{kind:command.kind,publicationId:command.publicationId,revision:command.expectedRevision,
     caseId:command.caseId,restrictedAt:'2026-11-28T10:00:00.123456Z'}});
   });
   await page.goto(origin+'/admin',{waitUntil:'domcontentloaded'});
   await page.getByRole('link',{name:'Жалобы на публикации',exact:true}).click();
   const region=page.getByRole('region',{name:'Решение по публикации'});
   const type=region.getByLabel('Тип публикации'),id=region.getByLabel('ID публикации');
   const find=region.getByRole('button',{name:'Найти публикацию',exact:true});
   const confirm=region.getByRole('button',{name:'Ограничить публикацию',exact:true});
   await type.selectOption('fair');
   await id.fill(publicationId);
   assert.equal(await confirm.count(),0);
   await id.press('Tab');
   assert.equal(await find.evaluate(el=>el===document.activeElement&&el.matches(':focus-visible')),true);
   await find.press('Enter');
   await region.getByRole('heading',{name:title}).waitFor();
   assert.equal(await region.getByText('7',{exact:true}).count(),1);
   await type.selectOption('marquee');
   assert.equal(await confirm.count(),0);
   await type.selectOption('fair');
   await find.click();
   const caseInput=region.getByLabel('Номер обращения (UUID)');
   await caseInput.fill('некорректный номер');
   await confirm.click();
   await region.getByRole('alert').filter({hasText:'Укажите номер обращения в формате UUID.'}).waitFor();
   assert.equal(restrictAttempts,0);
   await caseInput.fill(caseId);
   await confirm.click();
   await region.getByText('Результат пока не подтверждён.',{exact:false}).waitFor();
   assert.equal(await caseInput.getAttribute('readonly'),'');
   assert.equal(await find.isDisabled(),true);
   await region.getByRole('button',{name:'Проверить результат',exact:true}).click();
   await region.getByText('Ограничение сохранено',{exact:true}).waitFor();
   assert.deepEqual(calls.filter(command=>command.action==='restrict'),Array(2).fill({
    action:'restrict',kind:'fair',expectedAdminId:actor,publicationId,expectedRevision:'7',caseId,
   }));
   await page.addScriptTag({path:createRequire(import.meta.url).resolve('axe-core/axe.min.js')});
   for(const width of [320,390,1280]){
    await page.setViewportSize({width,height:900});
    assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth>innerWidth),false);
    const violations=await region.evaluate(async el=>(await window.axe.run(el)).violations.map(v=>v.id));
    assert.deepEqual(violations,[]);
   }
   let release;
   waitForSession=new Promise(resolve=>{release=resolve;});
   const refreshing=new Promise(resolve=>{sessionStarted=resolve;});
   await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
   await refreshing;
   await region.waitFor({state:'detached'});
   assert.equal(await page.getByText(caseId,{exact:true}).count(),0);
   actor=randomUUID();
   release();
   waitForSession=undefined;
   await region.waitFor();
   assert.equal(await id.inputValue(),'');
   assert.equal(await page.getByText(title,{exact:true}).count(),0);
   await type.selectOption('fair');
   await id.fill(publicationId);
   await find.click();
   await caseInput.fill(randomUUID());
   await confirm.click();
   await region.getByText('Результат пока не подтверждён.',{exact:false}).waitFor();
   await region.getByRole('button',{name:'Проверить результат',exact:true}).click();
   await region.getByRole('alert').filter({hasText:'Ревизия, состояние карточки или номер обращения изменились.'}).waitFor();
   assert.equal(await find.isEnabled(),true);
   await find.click();
   await caseInput.fill(randomUUID());
   role='user';
   await confirm.click();
   await page.getByText('Доступ администратора не подтверждён.',{exact:true}).waitFor();
   assert.equal(await region.count(),0);
   assert.deepEqual(foreign,[]);
   assert.deepEqual(pageErrors,[]);
  }finally{
   await browser.close();
  }
 });
});
