import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {rootCertificates} from 'node:tls';
import {randomBytes,createECDH} from 'node:crypto';
import {chromium} from 'playwright';
import {createDefaultCabinetProfile} from '../src/lib/cabinet-profile.ts';

const a='10000000-0000-4000-8000-000000000001',b='10000000-0000-4000-8000-000000000002';
const publicKey=createECDH('prime256v1').generateKeys().toString('base64url');
const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/synthetic-local-browser',expirationTime:null,
 keys:{p256dh:createECDH('prime256v1').generateKeys().toString('base64url'),auth:randomBytes(16).toString('base64url')}};

test('cabinet push uses a user gesture, keeps account scope and handles revoked permission and unlink',{timeout:90000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'blizhniy-push-cabinet-'));let app,context;
 try{
  const key=join(dir,'key'),ca=join(dir,'ca');await writeFile(key,randomBytes(32),{mode:0o600});await writeFile(ca,rootCertificates[0],{mode:0o600});
  const socket=createServer().listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  const origin='http://127.0.0.1:'+port;
  const env={PATH:process.env.PATH,LANG:'C.UTF-8',NODE_ENV:'production',__NEXT_PROCESSED_ENV:'true',NEXT_TELEMETRY_DISABLED:'1',
   BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai',BLIZHNIY_PUSH:'inbox-v1',BLIZHNIY_PUSH_PUBLIC_KEY:publicKey,
   BLIZHNIY_DB_HOST:'17e86f80f26733d39ef4b84d.twc1.net',BLIZHNIY_DB_PORT:'5432',BLIZHNIY_DB_NAME:'blizhniy_prod',BLIZHNIY_DB_USER:'blizhniy_runtime',
   BLIZHNIY_DB_PASSWORD:'synthetic-ui-db-password',BLIZHNIY_DB_SSL_MODE:'verify-full',BLIZHNIY_DB_CA_FILE:ca,BLIZHNIY_AUTH_MAIL_KEY_FILE:key,
   BLIZHNIY_AUTH_RATE_SECRET:'synthetic-ui-only-rate-secret-not-used-by-api',BLIZHNIY_MAIL_MODE:'timeweb',BLIZHNIY_SMTP_USER:'notifications@ближний-ру.рф',
   BLIZHNIY_SMTP_PASSWORD:'synthetic-ui-smtp-password',TURNSTILE_SECRET_KEY:'synthetic-ui-captcha-secret'};
  app=spawn(process.execPath,['--experimental-strip-types','--require','./tests/listing-form-browser-pg.cjs','node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{env,detached:true,stdio:'ignore'});
  const until=Date.now()+20000;
  for(;;){
   assert.equal(app.exitCode,null);
   try {if((await fetch(origin+'/api/health',{signal:AbortSignal.timeout(600)})).ok)break;}
   catch(error){assert.ok(error.cause?.code==='ECONNREFUSED'||error.name==='TimeoutError');}
   assert.ok(Date.now()<until);
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  context=await chromium.launchPersistentContext(join(dir,'chrome'),{headless:true,channel:'chromium',viewport:{width:420,height:900}});
  await context.addInitScript(({subscription,publicKey})=>{
   const key=Uint8Array.from(atob(publicKey.replaceAll('-','+').replaceAll('_','/')+'='),c=>c.charCodeAt(0)).buffer;
   let gestureChecks=[];
   const native=()=>sessionStorage.getItem('synthetic-push-endpoint')?{
    expirationTime:null,options:{applicationServerKey:key},toJSON:()=>subscription,
    unsubscribe:async()=>{sessionStorage.removeItem('synthetic-push-endpoint');return true;},
   }:null;
   window.pushFixture={
    permission:value=>sessionStorage.setItem('synthetic-notification-permission',value),
    calls:()=>gestureChecks,
   };
   Object.defineProperty(Notification,'permission',{configurable:true,get:()=>sessionStorage.getItem('synthetic-notification-permission')??'default'});
   PushManager.prototype.getSubscription=async()=>native();
   PushManager.prototype.subscribe=function(options){
    gestureChecks.push({activated:navigator.userActivation.isActive,key:options.applicationServerKey,userVisibleOnly:options.userVisibleOnly});
    sessionStorage.setItem('synthetic-notification-permission','granted');
    sessionStorage.setItem('synthetic-push-endpoint','true');
    return Promise.resolve(native());
   };
   if (sessionStorage.getItem('synthetic-push-unsupported')) Object.defineProperty(window,'PushManager',{value:undefined});
  },{subscription,publicKey});
  const page=await context.newPage();
  page.setDefaultTimeout(7500);
  const profiles=new Map([a,b].map(id=>[id,{...createDefaultCabinetProfile({name:id===a?'Анна Тестовая':'Борис Тестовый',email:'fixture@example.invalid'}),pushNotifications:id===b}]));
  let actor=a, revision=null, hold;
  const linked=new Set(),writes=[],foreign=[],errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin!==origin){foreign.push(url.origin);return route.abort();}
   if(url.pathname==='/api/account/session')return route.fulfill({json:{user:{id:actor,email:'fixture@example.invalid',role:'user',isBlocked:false}}});
   if(url.pathname==='/api/account/profile'){
    const input=request.postDataJSON(),profile=profiles.get(input.expectedOwnerId);
    if(input.expectedOwnerId!==actor)return route.fulfill({status:401,json:{error:{code:'UNAUTHENTICATED'}}});
    if(request.method()==='PUT'){
     revision='a'.repeat(64);profiles.set(actor,input.profile);
     return route.fulfill({json:{profile:input.profile,revision}});
    }
    return route.fulfill({json:{exists:actor===a&&revision!==null,revision:actor===a?revision:null,profile}});
   }
   if(url.pathname==='/api/account/push'){
    const data=request.postDataJSON();
    assert.equal(request.headers().authorization,undefined);
    assert.equal(request.headers()['x-blizhniy-request'],'1');
    if(data.action==='status'){
     if(data.expectedOwnerId!==actor)return route.fulfill({status:401,json:{error:{code:'UNAUTHENTICATED'}}});
     return route.fulfill({json:{status:!profiles.get(actor).pushNotifications?'preference_off':linked.has(actor)?'active':'ready',publicKey}});
    }
    writes.push(data);
    if(hold&&data.action==='subscribe'){const barrier=hold;hold=undefined;barrier.enter();await barrier.wait;}
    if(data.expectedOwnerId!==actor)return route.fulfill({status:401,json:{error:{code:'UNAUTHENTICATED'}}}).catch(()=>undefined);
    if(data.action==='subscribe')linked.add(actor);else if(data.action==='unsubscribe')linked.delete(actor);
    return route.fulfill({status:204});
   }
   if(['/api/account/listings','/api/account/listing-drafts/collection','/api/account/work-cabinet'].includes(url.pathname)){
    return route.fulfill({json:{items:[],nextCursor:null,...(url.pathname==='/api/account/listings'?{workflow:'premoderation'}:{})}});
   }
   return route.continue();
  });
  async function settings(){
   await page.goto(origin+'/cabinet?settings=1');
   const panel=page.getByRole('region',{name:'Настройки аккаунта',exact:true});
   await panel.locator('summary').filter({hasText:'Уведомления'}).click();
   return {panel,push:panel.getByRole('group',{name:'Push в этом браузере',exact:true})};
  }
  let {panel,push}=await settings();
  await push.getByText('Чтобы подключить браузер, включите Push и сохраните настройки.',{exact:true}).waitFor();
  assert.deepEqual(writes,[]);
  assert.deepEqual(await page.evaluate(()=>window.pushFixture.calls()),[]);
  await panel.getByRole('checkbox',{name:/Push/}).check();
  await panel.getByRole('button',{name:'Сохранить настройки',exact:true}).click();
  await push.getByText('Подключите этот браузер и разрешите уведомления по запросу.',{exact:true}).waitFor();
  const connect=push.getByRole('button',{name:'Подключить браузер',exact:true});
  await connect.click();
  await push.getByText('Этот браузер подключён.',{exact:true}).waitFor();
  assert.deepEqual(writes,[{action:'subscribe',expectedOwnerId:a,subscription}]);
  assert.deepEqual(await page.evaluate(()=>window.pushFixture.calls()),[{activated:true,key:publicKey,userVisibleOnly:true}]);
  ({panel,push}=await settings());
  await push.getByText('Этот браузер подключён.',{exact:true}).waitFor();
  assert.equal(writes.length,1);
  await page.evaluate(()=>{window.pushFixture.permission('default');window.dispatchEvent(new Event('focus'));});
  await push.getByText('Подключите этот браузер и разрешите уведомления по запросу.',{exact:true}).waitFor();
  assert.equal(writes.length,1);
  await page.evaluate(()=>{window.pushFixture.permission('denied');window.dispatchEvent(new Event('focus'));});
  await push.getByText('Уведомления заблокированы браузером. Разрешите их в настройках сайта.',{exact:true}).waitFor();
  await push.getByRole('button',{name:'Отключить браузер',exact:true}).click();
  await push.getByText('Этот браузер отключён.',{exact:true}).waitFor();
  assert.deepEqual(writes.at(-1),{action:'unsubscribe',expectedOwnerId:a});
  assert.equal(linked.has(a),false);
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('synthetic-push-endpoint')),null);
  await page.evaluate(()=>{window.pushFixture.permission('granted');window.dispatchEvent(new Event('focus'));});
  const entered=Promise.withResolvers(),wait=Promise.withResolvers();
  hold={enter:entered.resolve,wait:wait.promise};
  await push.getByRole('button',{name:'Подключить браузер',exact:true}).click();
  await entered.promise;
  actor=b;
  await page.evaluate(()=>window.dispatchEvent(new Event('blizhniy-account-changed')));
  await page.waitForFunction(()=>document.querySelector('input[name="name"]')?.value==='Борис Тестовый');
  const summary=panel.locator('summary').filter({hasText:'Уведомления'});
  if(!await summary.evaluate(node=>node.parentElement.open))await summary.click();
  await push.getByText('В браузере осталась прежняя подписка. Отключите её перед повторным подключением.',{exact:true}).waitFor();
  assert.equal(await push.getByRole('button',{name:'Подключить браузер',exact:true}).count(),0);
  wait.resolve();
  assert.equal(await push.getByText('Этот браузер подключён.',{exact:true}).count(),0);
  assert.equal(linked.has(b),false);
  assert.equal(writes.at(-1).expectedOwnerId,a);
  await page.evaluate(()=>sessionStorage.setItem('synthetic-push-unsupported','1'));
  ({panel,push}=await settings());
  await push.getByText('Push-уведомления недоступны в этом браузере.',{exact:true}).waitFor();
  assert.equal(await push.getByRole('button',{name:'Подключить браузер',exact:true}).count(),0);
  for(const width of [320,768,1440]){
   await page.setViewportSize({width,height:900});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
  assert.deepEqual(errors,[]);
  assert.deepEqual(foreign,[]);
 }finally{
  await context?.close();
  if(app?.exitCode===null){process.kill(-app.pid,'SIGTERM');await once(app,'exit');}
  await rm(dir,{recursive:true,force:true});
 }
});
