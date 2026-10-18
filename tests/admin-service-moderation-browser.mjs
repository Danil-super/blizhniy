// Built production pages, with owned cookie/SQL/media boundaries and synthetic data only.
import assert from 'node:assert/strict';import {test} from 'node:test';import {spawn} from 'node:child_process';import {once} from 'node:events';
import {createServer} from 'node:net';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {rootCertificates} from 'node:tls';import {randomBytes} from 'node:crypto';import {createRequire} from 'node:module';import {chromium} from 'playwright';import sharp from 'sharp';
import {parseServicePublicationForm} from '../src/lib/service-publication-contract.ts';
const actor='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',id='10000000-0000-4000-8000-000000000003',publicationId='10000000-0000-4000-8000-000000000004',file='10000000-0000-4000-8000-000000000005';
const stamp='2026-10-18T00:00:00.123456Z',revision='9007199254740993',paths={specialist:'/admin/specialisty',fair:'/admin/fair-applications',marquee:'/admin/ad-marquee'};
test('service moderator pages use current cookie rights and recover lost decisions without repeat writes',{timeout:90000},async suite=>{
 const directory=await mkdtemp(join(tmpdir(),'blizhniy-service-moderator-'));let app,browser;
 try{
  const key=join(directory,'key'),ca=join(directory,'ca');await writeFile(key,randomBytes(32),{mode:0o600});await writeFile(ca,rootCertificates[0],{mode:0o600});
  const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));const origin=`http://127.0.0.1:${port}`;
  const env={PATH:process.env.PATH,LANG:'C.UTF-8',NODE_ENV:'production',__NEXT_PROCESSED_ENV:'true',NEXT_TELEMETRY_DISABLED:'1',BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai',
   BLIZHNIY_DB_HOST:'17e86f80f26733d39ef4b84d.twc1.net',BLIZHNIY_DB_PORT:'5432',BLIZHNIY_DB_NAME:'blizhniy_prod',BLIZHNIY_DB_USER:'blizhniy_runtime',BLIZHNIY_DB_PASSWORD:'synthetic-ui-db-password',
   BLIZHNIY_DB_SSL_MODE:'verify-full',BLIZHNIY_DB_CA_FILE:ca,BLIZHNIY_AUTH_MAIL_KEY_FILE:key,BLIZHNIY_AUTH_RATE_SECRET:'synthetic-ui-only-rate-secret-not-used-by-api',BLIZHNIY_MAIL_MODE:'timeweb',
   BLIZHNIY_SMTP_USER:'notifications@ближний-ру.рф',BLIZHNIY_SMTP_PASSWORD:'synthetic-ui-smtp-password',TURNSTILE_SECRET_KEY:'synthetic-ui-captcha-secret'};
  app=spawn(process.execPath,['--experimental-strip-types','--require','./tests/listing-form-browser-pg.cjs','node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{env,detached:true,stdio:'ignore'});
  const deadline=Date.now()+20000;for(;;){assert.equal(app.exitCode,null);let ready=false;try{ready=(await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)})).ok;}catch(error){assert.ok(error.cause?.code==='ECONNREFUSED'||error.name==='TimeoutError');}if(ready)break;assert.ok(Date.now()<deadline);await new Promise(resolve=>setTimeout(resolve,100));}
  browser=await chromium.launch({headless:true});const webp=await sharp({create:{width:40,height:20,channels:3,background:'green'}}).webp().toBuffer();
  for(const kind of ['specialist','fair','marquee'])await suite.test(kind+' inspect, private photo, decision readback and administrator isolation',{timeout:25000},async()=>{
   const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.setDefaultTimeout(6000);
   const state={actor,role:'admin',decision:'pending',note:null,writes:0,photos:0,foreign:[],unexpected:[],errors:[]};
   const form=parseServicePublicationForm(kind,{title:'Синтетический материал на проверке',placementRightConfirmed:true,...(kind==='marquee'?{href:'https://example.invalid'}:{description:'Приватное описание синтетического материала.',cityName:'Краснодар',contactPhone:'+79990000000',email:'fixture@example.invalid',photoIds:[file],...(kind==='specialist'?{professionName:'Сантехник',price:'1250.00',skills:'Монтаж'}:{category:'Посуда',comment:'Приватный комментарий организатору'})})});
   const snapshot={id:publicationId,kind,form,photos:kind==='marquee'?[]:[{id:file,mimeType:'image/webp',width:40,height:20,size:webp.length}],revision,status:'draft',paid:false,createdAt:stamp,updatedAt:stamp,publishedAt:null,expiresAt:null};
   page.on('pageerror',error=>state.errors.push(error.message));
   await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());if(['http:','https:'].includes(url.protocol)&&url.origin!==origin){state.foreign.push(url.host);return route.abort();}
    if(!url.pathname.startsWith('/api/'))return route.continue();assert.equal(request.headers().authorization,undefined);
    if(url.pathname==='/api/account/session')return route.fulfill({json:{user:{id:state.actor,email:'admin@example.invalid',role:state.role,isBlocked:false}}});
    if(url.pathname!=='/api/admin/service-moderation'){state.unexpected.push(url.pathname);return route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});}
    const body=request.postDataJSON();assert.equal(body.kind,kind);assert.equal(body.expectedAdminId,state.actor);assert.equal(request.headers()['x-blizhniy-request'],'1');
    if(request.method()==='PUT'){state.writes++;state.decision=body.state;state.note=body.note;assert.equal(body.requestId,id);return route.abort('connectionreset');}
    if(body.action==='list')return route.fulfill({json:{items:state.decision==='pending'?[{id,publicationId,kind,revision,title:form.title,updatedAt:stamp}]:[],nextCursor:null}});
    if(body.action==='photo'){assert.equal(kind!=='marquee',true);assert.equal(body.requestId,id);assert.equal(body.fileId,file);state.photos++;return route.fulfill({contentType:'image/webp',body:webp});}
    assert.equal(body.action,'inspect');assert.equal(body.requestId,id);return route.fulfill({json:{request:{id,revision,state:state.decision,note:state.note},snapshot,issues:[]}});
   });
   try{
    await page.goto(origin+paths[kind]);await page.getByRole('heading',{name:'Модерация материалов',exact:true}).waitFor();
    await page.getByRole('button',{name:form.title,exact:true}).click();
    if(kind!=='marquee'){await page.getByRole('img',{name:'Фотография 1 из 1',exact:true}).waitFor();assert.equal(state.photos,1);await page.getByText('+79990000000',{exact:true}).waitFor();}
    if(kind==='fair')await page.getByText('Приватный комментарий организатору',{exact:true}).waitFor();
    await page.getByLabel('Причина отказа',{exact:true}).fill('Уточните синтетические условия');await page.getByRole('button',{name:'Отклонить с причиной',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'Не удалось подтвердить результат'}).waitFor();assert.equal(state.writes,1);
    assert.equal(await page.getByRole('button',{name:'Одобрить для оплаты',exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'Сверить решение',exact:true}).click();await page.getByText('Отклонено: Уточните синтетические условия',{exact:true}).waitFor();assert.equal(state.writes,1);
    await page.addScriptTag({path:createRequire(import.meta.url).resolve('axe-core/axe.min.js')});
    for(const width of [320,768,1440]){await page.setViewportSize({width,height:1000});assert.equal(await page.locator('body').evaluate(node=>node.scrollWidth>innerWidth),false);
     const violations=await page.locator('main').evaluate(async node=>(await window.axe.run(node,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.filter(item=>['serious','critical'].includes(item.impact)).map(item=>item.id));assert.deepEqual(violations,[]);}
    state.actor=other;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByText('Отклонено: Уточните синтетические условия',{exact:true}).waitFor({state:'detached'});
    assert.equal((await page.locator('main').textContent()).includes('Приватное описание'),false);assert.equal(state.writes,1);
    state.role='user';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByText('Доступ администратора не подтверждён.',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Сверить решение',exact:true}).count(),0);assert.equal(state.writes,1);
    assert.deepEqual(state.foreign,[]);assert.deepEqual(state.unexpected,[]);assert.deepEqual(state.errors,[]);
   }finally{await context.close();}
  });
 }finally{await browser?.close();if(app?.exitCode===null){process.kill(-app.pid,'SIGTERM');await once(app,'exit');}await rm(directory,{recursive:true});}
});
