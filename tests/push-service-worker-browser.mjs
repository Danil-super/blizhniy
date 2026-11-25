import assert from 'node:assert/strict';
import {test} from 'node:test';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';

const id='10000000-0000-4000-8000-000000000001';

test('Chromium service worker checks the active cookie and shows only an approved generic notification',{timeout:30000},async()=>{
 const serviceWorker=await readFile(new URL('../public/push-notifications.js',import.meta.url));
 let approved=true;
 const checks=[];
 const server=createServer(async(req,res)=>{
  if(req.url==='/push-notifications.js'){
   res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'}).end(serviceWorker);
  }else if(req.url==='/api/account/push'){
   let body='';for await(const chunk of req)body+=chunk;
   checks.push({body:JSON.parse(body),cookie:req.headers.cookie,header:req.headers['x-blizhniy-request'],
    origin:req.headers.origin,site:req.headers['sec-fetch-site']});
   res.writeHead(approved&&req.headers.cookie==='fixture-account=a'?204:404).end();
  }else{
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end('<!doctype html><title>Synthetic browser push</title>');
  }
 }).listen(0,'127.0.0.1');
 await once(server,'listening');
 const origin='http://127.0.0.1:'+server.address().port;
 const profile=await mkdtemp(join(tmpdir(),'blizhniy-push-browser-'));
 let context;
 try{
  context=await chromium.launchPersistentContext(profile,{headless:true,channel:'chromium'});
  await context.grantPermissions(['notifications'],{origin});
  const page=await context.newPage();
  await context.addCookies([{name:'fixture-account',value:'a',url:origin}]);
  await page.goto(origin+'/cabinet/');
  assert.equal(await page.evaluate(()=>Notification.permission),'granted');
  const created=context.waitForEvent('serviceworker');
  await page.evaluate(async()=>{
   await navigator.serviceWorker.register('/push-notifications.js',{scope:'/cabinet/',updateViaCache:'none'});
   await navigator.serviceWorker.ready;
  });
  const worker=await created;
  const push=payload=>worker.evaluate(value=>{
   const result=new PushEvent('push',{data:JSON.stringify(value)});
   let work;
   result.waitUntil=promise=>{work=promise;};
   self.dispatchEvent(result);
   return work;
  },payload);
  const count=()=>page.evaluate(async()=> (await (await navigator.serviceWorker.ready).getNotifications()).length);
  await push({id,title:'Unexpected details'});
  assert.deepEqual(checks,[]);
  assert.equal(await count(),0);
  await push({id});
  assert.deepEqual(checks,[{body:{action:'authorize',id},cookie:'fixture-account=a',header:'1',origin,site:'same-origin'}]);
  assert.deepEqual(await page.evaluate(async()=>{
   const notifications=await(await navigator.serviceWorker.ready).getNotifications();
   return notifications.map(value=>({title:value.title,body:value.body,data:value.data}));
  }),[{title:'БЛИЖНИЙ',body:'В личном кабинете есть новое уведомление.',data:{id}}]);
  await context.addCookies([{name:'fixture-account',value:'b',url:origin}]);
  const windows=context.pages().length;
  await worker.evaluate(async()=>{
   const [notification]=await self.registration.getNotifications();
   const event=new NotificationEvent('notificationclick',{notification});
   let completion;
   event.waitUntil=promise=>{completion=promise;};
   self.dispatchEvent(event);
   await completion;
  });
  assert.equal(checks.at(-1).cookie,'fixture-account=b');
  assert.equal(context.pages().length,windows);
  await page.waitForFunction(async()=> (await(await navigator.serviceWorker.ready).getNotifications()).length===0);
  await push({id});
  assert.equal(checks.at(-1).cookie,'fixture-account=b');
  assert.equal(await count(),0);
  approved=false;
  await context.addCookies([{name:'fixture-account',value:'a',url:origin}]);
  await push({id});
  assert.equal(await count(),0);
  const handled=checks.length;
  await context.clearPermissions();
  assert.notEqual(await page.evaluate(()=>Notification.permission),'granted');
  await push({id});
  assert.equal(checks.length,handled);
  assert.equal(await count(),0);
 }finally{
  await context?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  await rm(profile,{recursive:true,force:true});
 }
});
