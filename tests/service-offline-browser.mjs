// One independent reproduction: real built specialist UI, isolated localhost APIs.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {rootCertificates} from 'node:tls';
import {randomBytes} from 'node:crypto';
import {chromium} from 'playwright';
import {createDefaultCabinetProfile} from '../src/lib/cabinet-profile.ts';
import {parseServicePublicationForm} from '../src/lib/service-publication-contract.ts';
import {parseWorkPublicationForm} from '../src/lib/work-publication-contract.ts';

const owner='10000000-0000-4000-8000-000000000001';
const render=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));

test('specialist unsaved title survives a temporary session 503 and same-owner recovery without a write',{timeout:45000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'blizhniy-service-offline-'));let app,browser;
 try{
  const key=join(directory,'key'),ca=join(directory,'ca');
  await writeFile(key,randomBytes(32),{mode:0o600});await writeFile(ca,rootCertificates[0],{mode:0o600});
  const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;
  await new Promise(resolve=>socket.close(resolve));const origin=`http://127.0.0.1:${port}`;
  const env={PATH:process.env.PATH,LANG:'C.UTF-8',NODE_ENV:'production',__NEXT_PROCESSED_ENV:'true',NEXT_TELEMETRY_DISABLED:'1',BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai',
   BLIZHNIY_DB_HOST:'17e86f80f26733d39ef4b84d.twc1.net',BLIZHNIY_DB_PORT:'5432',BLIZHNIY_DB_NAME:'blizhniy_prod',BLIZHNIY_DB_USER:'blizhniy_runtime',BLIZHNIY_DB_PASSWORD:'synthetic-ui-db-password',
   BLIZHNIY_DB_SSL_MODE:'verify-full',BLIZHNIY_DB_CA_FILE:ca,BLIZHNIY_AUTH_MAIL_KEY_FILE:key,BLIZHNIY_AUTH_RATE_SECRET:'synthetic-ui-only-rate-secret-not-used-by-api',BLIZHNIY_MAIL_MODE:'timeweb',
   BLIZHNIY_SMTP_USER:'notifications@ближний-ру.рф',BLIZHNIY_SMTP_PASSWORD:'synthetic-ui-smtp-password',TURNSTILE_SECRET_KEY:'synthetic-ui-captcha-secret'};
  app=spawn(process.execPath,['--experimental-strip-types','--require','./tests/listing-form-browser-pg.cjs','node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],
   {env,detached:true,stdio:'ignore'});
  const deadline=Date.now()+20000;
  for(;;){
   assert.equal(app.exitCode,null,'owned production process is running');
   try{if((await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)})).ok)break;}
   catch(error){assert.ok(error.cause?.code==='ECONNREFUSED'||error.name==='TimeoutError');}
   assert.ok(Date.now()<deadline,'owned production process starts');await new Promise(resolve=>setTimeout(resolve,100));
  }
  browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
  page.setDefaultTimeout(7000);
  const state={unavailable:false,replies:[],puts:[],foreign:[],unexpected:[],errors:[]};
  page.on('pageerror',()=>state.errors.push('pageerror'));
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(['http:','https:'].includes(url.protocol)&&url.origin!==origin){state.foreign.push(url.host);return route.abort();}
   if(!url.pathname.startsWith('/api/'))return route.continue();
   assert.equal(request.headers().authorization,undefined,'the reproduction never uses legacy Bearer authority');
   if(request.method()==='PUT')state.puts.push(url.pathname);
   const body=request.postDataJSON();
   if(url.pathname==='/api/account/session'){
    assert.equal(request.method(),'POST');assert.deepEqual(body,{});state.replies.push(state.unavailable?503:200);
    return route.fulfill(state.unavailable?{status:503,json:{error:{code:'AUTH_UNAVAILABLE'}}}:
     {json:{user:{id:owner,email:'fixture@example.invalid',role:'user',isBlocked:false}}});
   }
   if(url.pathname==='/api/account/profile'){
    assert.equal(request.method(),'POST');assert.deepEqual(body,{expectedOwnerId:owner});
    return route.fulfill({json:{exists:false,revision:null,profile:createDefaultCabinetProfile({name:'Сохранённое техническое имя',email:'fixture@example.invalid'})}});
   }
   if(url.pathname==='/api/account/service-publications'){
    assert.equal(request.method(),'POST');assert.deepEqual(body,{action:'list',expectedOwnerId:owner,kind:'specialist',after:null});
    return route.fulfill({json:{items:[],nextCursor:null}});
   }
   state.unexpected.push(url.pathname);return route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});
  });
  await page.goto(origin+'/cabinet/specialist');
  const form=page.getByRole('form',{name:'Анкета специалиста',exact:true});await form.waitFor();
  const title='Несохранённая анкета после краткого обрыва';await form.locator('input[name="title"]').fill(title);
  state.unavailable=true;
  const failed=page.waitForResponse(response=>response.url()===origin+'/api/account/session'&&response.status()===503);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await failed;await render(page);
  assert.equal(await form.isVisible(),false,'an unverified session must hide the private specialist form');
  assert.equal(await page.getByRole('heading',{name:'Нужно войти',exact:true}).count(),0,'503 is not a confirmed logout');
  assert.deepEqual(state.puts,[],'a background failure never submits the user\'s form');
  state.unavailable=false;
  const recovered=page.waitForResponse(response=>response.url()===origin+'/api/account/session'&&response.status()===200);
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));await recovered;await form.waitFor();await render(page);
  assert.equal(page.url(),origin+'/cabinet/specialist');
  assert.deepEqual(state.puts,[],'restoring session access does not autosave the unsaved title');
  assert.equal(await form.locator('input[name="title"]').inputValue(),title,'same-owner recovery restores the exact unsaved title, not a blank or persisted default');
  assert.ok(state.replies.includes(503));assert.deepEqual(state.puts,[]);
  assert.deepEqual(state.foreign,[]);assert.deepEqual(state.unexpected,[]);assert.deepEqual(state.errors,[]);
 }finally{
  await browser?.close();if(app&&app.exitCode===null){process.kill(-app.pid,'SIGTERM');await once(app,'exit');}await rm(directory,{recursive:true});
 }
});

// Independent sibling reproductions. Keep the original specialist scenario intact.
for(const scenario of [
 {path:'/cabinet/fair-applications',kind:'fair',title:'Сохранённая заявка на ярмарку',label:'Заявка на ярмарку',family:'service'},
 {path:'/cabinet/vakansii',kind:'vacancy',title:'Сохранённая вакансия',label:'Редактирование публикации',family:'work'},
 {path:'/cabinet/zakazy',kind:'workRequest',title:'Сохранённый заказ',label:'Редактирование публикации',family:'work'},
])test(scenario.path+' restores its selected editor and unsaved title after session 503 with no PUT',{timeout:45000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'blizhniy-cabinet-sibling-offline-'));let app,browser;
 try{
  const key=join(directory,'key'),ca=join(directory,'ca');
  await writeFile(key,randomBytes(32),{mode:0o600});await writeFile(ca,rootCertificates[0],{mode:0o600});
  const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;
  await new Promise(resolve=>socket.close(resolve));const origin=`http://127.0.0.1:${port}`;
  const env={PATH:process.env.PATH,LANG:'C.UTF-8',NODE_ENV:'production',__NEXT_PROCESSED_ENV:'true',NEXT_TELEMETRY_DISABLED:'1',BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai',
   BLIZHNIY_DB_HOST:'17e86f80f26733d39ef4b84d.twc1.net',BLIZHNIY_DB_PORT:'5432',BLIZHNIY_DB_NAME:'blizhniy_prod',BLIZHNIY_DB_USER:'blizhniy_runtime',BLIZHNIY_DB_PASSWORD:'synthetic-ui-db-password',
   BLIZHNIY_DB_SSL_MODE:'verify-full',BLIZHNIY_DB_CA_FILE:ca,BLIZHNIY_AUTH_MAIL_KEY_FILE:key,BLIZHNIY_AUTH_RATE_SECRET:'synthetic-ui-only-rate-secret-not-used-by-api',BLIZHNIY_MAIL_MODE:'timeweb',
   BLIZHNIY_SMTP_USER:'notifications@ближний-ру.рф',BLIZHNIY_SMTP_PASSWORD:'synthetic-ui-smtp-password',TURNSTILE_SECRET_KEY:'synthetic-ui-captcha-secret'};
  app=spawn(process.execPath,['--experimental-strip-types','--require','./tests/listing-form-browser-pg.cjs','node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],
   {env,detached:true,stdio:'ignore'});
  const deadline=Date.now()+20000;
  for(;;){
   assert.equal(app.exitCode,null,'owned sibling production process is running');
   try{if((await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)})).ok)break;}
   catch(error){assert.ok(error.cause?.code==='ECONNREFUSED'||error.name==='TimeoutError');}
   assert.ok(Date.now()<deadline,'owned sibling production process starts');await new Promise(resolve=>setTimeout(resolve,100));
  }
  const id='10000000-0000-4000-8000-000000000002',stamp='2026-10-18T00:00:00.123456Z';
  const input={kind:scenario.kind,title:scenario.title,description:'Синтетическое сохранённое описание для изолированного восстановления формы.',
   cityName:'Краснодар',contactPhone:'+79990000000',photoIds:[],placementRightConfirmed:true};
  const savedForm=scenario.family==='service'?parseServicePublicationForm('fair',{...input,category:'Посуда',email:'fixture@example.invalid'}):
   parseWorkPublicationForm(scenario.kind,{...input,professionName:'Сантехник',...(scenario.kind==='vacancy'?{employerType:'person',organization:'Синтетический',salary:'12000.00'}:{budget:'15000.00'})});
  const snapshot={id,kind:scenario.kind,revision:'9007199254740993',status:'draft',paid:false,form:savedForm,photos:[],createdAt:stamp,updatedAt:stamp,publishedAt:null,expiresAt:null};
  const state={unavailable:false,puts:[],foreign:[],unexpected:[],errors:[]};
  browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
  page.setDefaultTimeout(7000);page.on('pageerror',()=>state.errors.push('pageerror'));
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(['http:','https:'].includes(url.protocol)&&url.origin!==origin){state.foreign.push(url.host);return route.abort();}
   if(!url.pathname.startsWith('/api/'))return route.continue();
   assert.equal(request.headers().authorization,undefined);assert.equal(request.headers()['x-blizhniy-request'],'1');assert.equal(url.search,'');
   if(request.method()==='PUT'){state.puts.push(url.pathname);return route.fulfill({status:503,json:{error:{code:'SYNTHETIC_WRITE_NOT_EXPECTED'}}});}
   assert.equal(request.method(),'POST');const body=request.postDataJSON();
   if(url.pathname==='/api/account/session'){
    assert.deepEqual(body,{});return route.fulfill(state.unavailable?{status:503,json:{error:{code:'AUTH_UNAVAILABLE'}}}:
     {json:{user:{id:owner,email:'fixture@example.invalid',role:'user',isBlocked:false}}});
   }
   if(url.pathname==='/api/account/profile'){
    assert.deepEqual(body,{expectedOwnerId:owner});return route.fulfill({json:{exists:false,revision:null,
     profile:createDefaultCabinetProfile({name:'Технический профиль',email:'fixture@example.invalid'})}});
   }
   if(url.pathname==='/api/account/'+scenario.family+'-publications'){
    if(body.action==='list'){
     assert.deepEqual(body,{action:'list',expectedOwnerId:owner,kind:scenario.kind,after:null});
     return route.fulfill({json:{items:[{id,kind:scenario.kind,title:snapshot.form.title,revision:snapshot.revision,status:'draft',paid:false,updatedAt:stamp}],nextCursor:null}});
    }
    assert.deepEqual(body,{action:'read',expectedOwnerId:owner,kind:scenario.kind,publicationId:id});return route.fulfill({json:snapshot});
   }
   if(url.pathname==='/api/account/'+scenario.family+'-moderation'){
    assert.deepEqual(body,{expectedOwnerId:owner,kind:scenario.kind,publicationId:id,expectedRevision:snapshot.revision});
    return route.fulfill({json:{id:null,revision:null,state:'not_submitted',note:null}});
   }
   state.unexpected.push(url.pathname);return route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});
  });
  await page.goto(origin+scenario.path);await page.getByRole('button',{name:scenario.title,exact:true}).click();
  const form=page.getByRole('form',{name:scenario.label,exact:true});await form.waitFor();
  const title='Несохранённые правки '+scenario.kind;await form.locator('input[name="title"]').fill(title);
  state.unavailable=true;
  const failed=page.waitForResponse(response=>response.url()===origin+'/api/account/session'&&response.status()===503);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await failed;await render(page);
  assert.equal(await form.isVisible(),false,'unverified session hides the selected private editor');
  assert.equal(await page.getByRole('heading',{name:'Нужно войти',exact:true}).count(),0,'a failed transport does not confirm logout');
  assert.deepEqual(state.puts,[],'session failure never autosaves an edit');
  state.unavailable=false;
  const recovered=page.waitForResponse(response=>response.url()===origin+'/api/account/session'&&response.status()===200);
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));await recovered;
  await page.getByRole('button',{name:scenario.title,exact:true}).waitFor();await render(page);
  assert.equal(page.url(),origin+scenario.path);assert.deepEqual(state.puts,[],'same-owner recovery never autosaves an edit');
  assert.equal(await form.isVisible(),true,'same-owner recovery must restore the selected editor without requiring the user to reopen the persisted row');
  assert.equal(await form.locator('input[name="title"]').inputValue(),title,'the exact unsaved title survives the recovered session');
  assert.deepEqual(state.foreign,[]);assert.deepEqual(state.unexpected,[]);assert.deepEqual(state.errors,[]);
 }finally{
  await browser?.close();if(app&&app.exitCode===null){process.kill(-app.pid,'SIGTERM');await once(app,'exit');}await rm(directory,{recursive:true});
 }
});
