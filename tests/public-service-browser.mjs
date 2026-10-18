// Real built pages/hydration; private-field sentinels and all transports are owned fixtures.
import assert from 'node:assert/strict';import {test} from 'node:test';import {spawn} from 'node:child_process';import {once} from 'node:events';
import {createServer} from 'node:net';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {rootCertificates} from 'node:tls';import {randomBytes} from 'node:crypto';import {chromium} from 'playwright';import sharp from 'sharp';
import {request as httpRequest} from 'node:http';
import {parseServicePublicationForm} from '../src/lib/service-publication-contract.ts';
test('public Russian service pages render eligible safe DTOs and local photos with no old data access',{timeout:90000},async suite=>{
 const directory=await mkdtemp(join(tmpdir(),'blizhniy-public-service-'));let app,browser,output='';
 try{
  const key=join(directory,'key'),ca=join(directory,'ca'),fixture=join(directory,'rows.json'),photo='10000000-0000-4000-8000-000000000004';
  await writeFile(key,randomBytes(32),{mode:0o600});await writeFile(ca,rootCertificates[0],{mode:0o600});
  const secrets=['+79990000000','private@example.invalid','@private_fixture','Приватная улица','55.123456','Приватный комментарий'];
  const rows=['specialist','fair','marquee'].map((kind,index)=>({id:`10000000-0000-4000-8000-00000000000${index+1}`,kind,mediaIds:kind==='marquee'?[]:[photo],form:parseServicePublicationForm(kind,{title:'Синтетический публичный '+kind,placementRightConfirmed:true,
   ...(kind==='marquee'?{href:'https://example.invalid/'}:{description:'Подробное описание синтетического материала.',cityName:'Краснодар',contactPhone:secrets[0],email:secrets[1],messengerUrl:secrets[2],address:secrets[3],latitude:55.123456,longitude:37.123456,showExactAddress:false,photoIds:[photo],
   ...(kind==='specialist'?{professionName:'Сантехник',price:'1250.50',skills:'Монтаж'}:{category:'Посуда',comment:secrets[5]})})}),status:'published',paid:true,createdAt:'2026-01-01T00:00:00.123456Z',publishedAt:'2026-01-02T00:00:00.123456Z',expiresAt:'2099-01-01T00:00:00.123456Z'}));
  await writeFile(fixture,JSON.stringify(rows),{mode:0o600});const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));const origin=`http://127.0.0.1:${port}`;
  const env={PATH:process.env.PATH,LANG:'C.UTF-8',NODE_ENV:'production',__NEXT_PROCESSED_ENV:'true',NEXT_TELEMETRY_DISABLED:'1',BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai',
   BLIZHNIY_DB_HOST:'17e86f80f26733d39ef4b84d.twc1.net',BLIZHNIY_DB_PORT:'5432',BLIZHNIY_DB_NAME:'blizhniy_prod',BLIZHNIY_DB_USER:'blizhniy_runtime',BLIZHNIY_DB_PASSWORD:'synthetic-ui-db-password',
   BLIZHNIY_DB_SSL_MODE:'verify-full',BLIZHNIY_DB_CA_FILE:ca,BLIZHNIY_AUTH_MAIL_KEY_FILE:key,BLIZHNIY_AUTH_RATE_SECRET:'synthetic-ui-only-rate-secret-not-used-by-api',BLIZHNIY_MAIL_MODE:'timeweb',BLIZHNIY_SMTP_USER:'notifications@ближний-ру.рф',BLIZHNIY_SMTP_PASSWORD:'synthetic-ui-smtp-password',TURNSTILE_SECRET_KEY:'synthetic-ui-captcha-secret',BLIZHNIY_PUBLIC_SERVICE_FIXTURE:fixture};
  app=spawn(process.execPath,['--experimental-strip-types','--require','./tests/public-service-browser-pg.cjs','node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{env,detached:true,stdio:['ignore','pipe','pipe']});
  app.stdout.on('data',chunk=>{output=(output+chunk).slice(-16000);});app.stderr.on('data',chunk=>{output=(output+chunk).slice(-16000);});const deadline=Date.now()+20000;
  for(;;){assert.equal(app.exitCode,null);let ready=false;try{ready=(await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)})).ok;}catch(error){assert.ok(error.cause?.code==='ECONNREFUSED'||error.name==='TimeoutError');}if(ready)break;assert.ok(Date.now()<deadline);await new Promise(resolve=>setTimeout(resolve,100));}
  browser=await chromium.launch({headless:true});const context=await browser.newContext(),page=await context.newPage(),foreign=[],unexpected=[],errors=[];page.setDefaultTimeout(7000);
  const webp=await sharp({create:{width:40,height:20,channels:3,background:'green'}}).webp().toBuffer();page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());if(['http:','https:'].includes(url.protocol)&&url.origin!==origin){foreign.push(url.host);return route.abort();}
   if(url.pathname==='/api/account/session')return route.fulfill({status:401,json:{error:{code:'UNAUTHENTICATED'}}});
   if(/^\/api\/service-publications\/[a-f0-9-]+\/photos\/[a-f0-9-]+$/.test(url.pathname))return route.fulfill({contentType:'image/webp',body:webp});
   if(url.pathname.startsWith('/api/')){unexpected.push(url.pathname);return route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});}return route.continue();
  });
  await suite.test('specialist catalog, profession and detail preserve safe fields through HTML/RSC and hydration',async()=>{
   for(const path of ['/rabota/specialisty','/rabota/specialisty/santehnik',`/specialist/${rows[0].id}`]){
    const response=await page.goto(origin+path);assert.equal(response.status(),200);const html=await response.text();for(const value of secrets)assert.equal(html.includes(value),false);
    await page.getByRole('heading',{name:rows[0].form.title,exact:true}).waitFor();
    if(path.startsWith('/specialist/')){const image=page.locator(`img[src="/api/service-publications/${rows[0].id}/photos/${photo}"]`).first();await image.waitFor();await image.evaluate(node=>node.decode());assert.equal(await image.evaluate(node=>node.naturalWidth>0),true);}
    for(const width of [320,768,1440]){await page.setViewportSize({width,height:900});assert.equal(await page.locator('body').evaluate(node=>node.scrollWidth>innerWidth),false);}
   }
  });
  await suite.test('fair cards/API and home marquee read new eligible records without serializing private fields',async()=>{
   const response=await page.goto(origin+'/yarmarka-masterov');assert.equal(response.status(),200);const html=await response.text();for(const value of secrets)assert.equal(html.includes(value),false);
   await page.getByRole('heading',{name:rows[1].form.title,exact:true}).waitFor();const image=page.locator(`img[src="/api/service-publications/${rows[1].id}/photos/${photo}"]`).first();await image.waitFor();await image.evaluate(node=>node.decode());assert.ok(await image.evaluate(node=>node.naturalWidth>0));
   const api=await fetch(origin+'/api/fair-applications'),payload=await api.json();assert.equal(api.status,200);assert.equal(payload.applications[0].participantName,rows[1].form.title);for(const value of secrets)assert.equal(JSON.stringify(payload).includes(value),false);
   assert.equal((await page.goto(origin+'/')).status(),200);await page.getByRole('region',{name:'Рекламная строка',exact:true}).getByText(rows[2].form.title,{exact:true}).waitFor();
  });
  await suite.test('expired service cards, detail and marquee disappear without an old-data fallback',async()=>{
   await writeFile(fixture,JSON.stringify(rows.map(row=>({...row,expiresAt:'2000-01-01T00:00:00.000001Z'}))),{mode:0o600});
   for(const path of ['/rabota/specialisty','/yarmarka-masterov','/']){assert.equal((await page.goto(origin+path)).status(),200);for(const row of rows)assert.equal((await page.locator('main').textContent()).includes(row.form.title),false);}
   assert.equal((await page.goto(origin+`/specialist/${rows[0].id}`)).status(),404);assert.deepEqual(await (await fetch(origin+'/api/fair-applications')).json(),{applications:[]});
  });
  await suite.test('the actual public service photo route denies unavailable associations without reaching the private filesystem',async()=>{
   const path=`/api/service-publications/${rows[0].id}/photos/${photo}`,headers={Host:'xn----9sbphbgks4a4a.xn--p1ai','X-Real-IP':'192.0.2.5'};
   // Node fetch discards Host: use bounded HTTP to reproduce the real trusted ingress.
   const get=path=>new Promise((resolve,reject)=>{
    const outgoing=httpRequest(origin+path,{headers},incoming=>{let body='';incoming.setEncoding('utf8');incoming.on('data',chunk=>{body+=chunk;if(body.length>8192)incoming.destroy(Error('Owned response exceeded cap'));});incoming.on('error',reject);
     incoming.on('end',()=>resolve(new Response(body,{status:incoming.statusCode,headers:incoming.headers})));});
    outgoing.setTimeout(5000,()=>outgoing.destroy(Error('Owned ingress timed out')));outgoing.on('error',reject);outgoing.end();
   });
   const denied=await get(path),deniedBody=await denied.json();assert.equal(denied.status,404,JSON.stringify(deniedBody));assert.deepEqual(deniedBody,{error:{code:'MEDIA_NOT_FOUND'}});
   assert.equal(denied.headers.get('cache-control'),'no-store');assert.equal((await get(path+'?unexpected=1')).status,400);
  });
  assert.deepEqual(foreign,[]);assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);assert.equal(output.includes('Unexpected browser fixture query'),false);await context.close();
 }finally{await browser?.close();if(app?.exitCode===null){process.kill(-app.pid,'SIGTERM');await once(app,'exit');}await rm(directory,{recursive:true});}
});
