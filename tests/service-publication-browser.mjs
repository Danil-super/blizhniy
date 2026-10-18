// Production Next/Chromium with owned synthetic SQL/auth/media transports only.
import assert from 'node:assert/strict';import {test} from 'node:test';import {spawn} from 'node:child_process';import {once} from 'node:events';
import {createServer} from 'node:net';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {rootCertificates} from 'node:tls';import {randomBytes} from 'node:crypto';import {createRequire} from 'node:module';import {chromium} from 'playwright';import sharp from 'sharp';
import {parseServicePublicationForm} from '../src/lib/service-publication-contract.ts';import {createDefaultCabinetProfile} from '../src/lib/cabinet-profile.ts';
const owner='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000004',id='10000000-0000-4000-8000-000000000002',reviewId='10000000-0000-4000-8000-000000000003',stamp='2026-10-18T00:00:00.123456Z';
const paths={specialist:'/cabinet/specialist',fair:'/yarmarka-masterov/zayavka',marquee:'/reklama/begushchaya-stroka'};
const labels={specialist:'Анкета специалиста',fair:'Заявка на ярмарку',marquee:'Рекламный текст'};
test('service production pages use Russian cookie forms, preserve unknown results and never call legacy storage',{timeout:120000},async suite=>{
 const directory=await mkdtemp(join(tmpdir(),'blizhniy-service-browser-'));let app,browser,output='';
 try{
  const key=join(directory,'key'),ca=join(directory,'ca');await writeFile(key,randomBytes(32),{mode:0o600});await writeFile(ca,rootCertificates[0],{mode:0o600});
  const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));const origin=`http://127.0.0.1:${port}`;
  const env={PATH:process.env.PATH,LANG:'C.UTF-8',NODE_ENV:'production',__NEXT_PROCESSED_ENV:'true',NEXT_TELEMETRY_DISABLED:'1',BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai',
   BLIZHNIY_DB_HOST:'17e86f80f26733d39ef4b84d.twc1.net',BLIZHNIY_DB_PORT:'5432',BLIZHNIY_DB_NAME:'blizhniy_prod',BLIZHNIY_DB_USER:'blizhniy_runtime',BLIZHNIY_DB_PASSWORD:'synthetic-ui-db-password',
   BLIZHNIY_DB_SSL_MODE:'verify-full',BLIZHNIY_DB_CA_FILE:ca,BLIZHNIY_AUTH_MAIL_KEY_FILE:key,BLIZHNIY_AUTH_RATE_SECRET:'synthetic-ui-only-rate-secret-not-used-by-api',BLIZHNIY_MAIL_MODE:'timeweb',
   BLIZHNIY_SMTP_USER:'notifications@ближний-ру.рф',BLIZHNIY_SMTP_PASSWORD:'synthetic-ui-smtp-password',TURNSTILE_SECRET_KEY:'synthetic-ui-captcha-secret'};
  app=spawn(process.execPath,['--experimental-strip-types','--require','./tests/listing-form-browser-pg.cjs','node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{env,detached:true,stdio:['ignore','pipe','pipe']});
  app.stdout.on('data',chunk=>{output=(output+chunk).slice(-16000);});app.stderr.on('data',chunk=>{output=(output+chunk).slice(-16000);});const deadline=Date.now()+20000;
  for(;;){assert.equal(app.exitCode,null);let ready=false;try{ready=(await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)})).ok;}catch(error){assert.ok(error.cause?.code==='ECONNREFUSED'||error.name==='TimeoutError');}if(ready)break;assert.ok(Date.now()<deadline);await new Promise(resolve=>setTimeout(resolve,100));}
  browser=await chromium.launch({headless:true});const png=await sharp({create:{width:40,height:20,channels:3,background:'green'}}).png().toBuffer(),webp=await sharp(png).webp().toBuffer();
  for(const kind of ['specialist','fair','marquee'])await suite.test(kind+' full save, lost acknowledgement, moderation and explicit revision edit',{timeout:30000},async()=>{
   const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),state={owner,row:null,review:null,lose:true,writes:0,uploads:0,reads:0,legacy:[],foreign:[],errors:[]};page.setDefaultTimeout(7000);
   page.on('pageerror',error=>state.errors.push(error.message));
   await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());if(['http:','https:'].includes(url.protocol)&&url.origin!==origin){state.foreign.push(url.host);return route.abort();}
    if(!url.pathname.startsWith('/api/'))return route.continue();
    assert.equal(request.headers().authorization,undefined,'service forms never send legacy bearer');const body=request.postData()?request.headers()['content-type']==='application/json'?request.postDataJSON():null:null;
    if(url.pathname==='/api/account/session')return route.fulfill({json:{user:{id:state.owner,email:'fixture@example.invalid',role:'user',isBlocked:false}}});
    if(url.pathname==='/api/account/profile')return route.fulfill({json:{exists:false,revision:null,profile:createDefaultCabinetProfile({name:'Техническое имя',email:'fixture@example.invalid'})}});
    if(url.pathname==='/api/account/media'){state.uploads++;return route.fulfill({json:{id:request.headers()['x-blizhniy-intent'],mimeType:'image/webp',width:40,height:20,size:webp.length}});}
    if(url.pathname==='/api/account/media/read')return route.fulfill({contentType:'image/webp',body:webp});
    if(url.pathname==='/api/account/service-publications'){
     assert.equal(body.expectedOwnerId,state.owner);assert.equal(body.kind,kind);assert.equal(request.headers()['x-blizhniy-request'],'1');
     if(body.action==='list')return route.fulfill({json:{items:state.row?[{id,kind,title:state.row.form.title,revision:state.row.revision,status:'draft',paid:false,updatedAt:stamp}]:[],nextCursor:null}});
     if(body.action==='read'||body.action==='intent'){state.reads++;return route.fulfill({json:state.row});}
     state.writes++;assert.equal(request.method(),'PUT');const form=parseServicePublicationForm(kind,body.form);
     if(body.action==='update')assert.equal(body.expectedRevision,state.row.revision);else assert.equal(body.action,'create');
     state.row={id,kind,form,photos:(form.kind==='marquee'?[]:form.photoIds).map(id=>({id,mimeType:'image/webp',width:40,height:20,size:webp.length})),revision:state.row?String(BigInt(state.row.revision)+1n):'9007199254740993',status:'draft',paid:false,createdAt:stamp,updatedAt:stamp,publishedAt:null,expiresAt:null};
     if(state.lose){state.lose=false;return route.abort('connectionreset');}return route.fulfill({json:state.row});
    }
    if(url.pathname==='/api/account/service-moderation'){
     assert.equal(body.expectedOwnerId,state.owner);assert.equal(body.kind,kind);assert.equal(body.publicationId,id);assert.equal(body.expectedRevision,state.row.revision);
     if(request.method()==='PUT')state.review={id:reviewId,revision:state.row.revision,state:'pending',note:null};
     return route.fulfill({json:state.review&&state.review.revision===state.row.revision?state.review:{id:null,revision:null,state:'not_submitted',note:null}});
    }
    state.legacy.push(url.pathname);return route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});
   });
   try{
    await page.goto(origin+paths[kind]);const form=page.getByRole('form',{name:labels[kind],exact:true});await form.waitFor({timeout:3000});
    await form.locator('input[name="title"]').fill('Синтетический материал');
    if(kind!=='marquee'){
     await form.locator('textarea[name="description"]').fill('Синтетическое описание работ, товаров и условий размещения.');await form.locator('input[name="phone"]').fill('+79990000000');await form.locator('input[name="email"]').fill('fixture@example.invalid');
     if(kind==='specialist'){await form.locator('input[name="profession"]').fill('Сантехник');await form.locator('input[name="price"]').fill('1250,50');await form.locator('textarea[name="skills"]').fill('Монтаж и ремонт');}
     else await form.locator('select[name="category"]').selectOption('Посуда');
     await form.locator('input[name="photos"]').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:png});
    }
    for(const checkbox of await form.locator('input[type="checkbox"]').all())await checkbox.check();
    await form.getByRole('button',{name:'Сохранить черновик',exact:true}).click();await form.getByRole('button',{name:'Проверить сохранённую форму',exact:true}).waitFor();assert.equal(state.writes,1);
    await form.getByRole('button',{name:'Проверить сохранённую форму',exact:true}).click();await page.getByText('Материал сохранён.',{exact:true}).waitFor();assert.equal(state.writes,1);assert.ok(state.reads>=1);assert.equal(state.row.form.title,'Синтетический материал');
    await page.getByRole('button',{name:'Отправить на модерацию',exact:true}).click();await page.getByText('На модерации',{exact:true}).waitFor();
    const edit=page.getByRole('form',{name:labels[kind],exact:true});await edit.locator('input[name="title"]').fill('Исправленный материал');await edit.getByRole('button',{name:'Сохранить черновик',exact:true}).click();
    await page.getByText('Материал сохранён.',{exact:true}).waitFor();assert.equal(state.row.revision,'9007199254740994');assert.equal(state.row.form.title,'Исправленный материал');assert.equal(state.uploads,kind==='marquee'?0:1);
    await page.addScriptTag({path:createRequire(import.meta.url).resolve('axe-core/axe.min.js')});
    for(const width of [320,768,1440]){await page.setViewportSize({width,height:1000});assert.equal(await page.locator('body').evaluate(node=>node.scrollWidth>innerWidth),false);
     const violations=await edit.evaluate(async node=>(await window.axe.run(node,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.filter(item=>['serious','critical'].includes(item.impact)).map(item=>({id:item.id,nodes:item.nodes.map(node=>({target:node.target,summary:node.failureSummary}))})));assert.deepEqual(violations,[]);}
    const previous=state.row;await edit.locator('input[name="title"]').fill('Приватные несохранённые правки A');state.owner=other;state.row=null;state.review=null;
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(()=>!Array.from(document.querySelectorAll('input[name="title"]')).some(input=>input.value==='Приватные несохранённые правки A'));
    await page.getByRole('form',{name:labels[kind],exact:true}).waitFor();assert.equal(state.writes,2,'owner switch does not automatically save another account');
    state.owner=owner;state.row=previous;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await page.getByRole('form',{name:labels[kind],exact:true}).waitFor();assert.notEqual(await page.getByRole('form',{name:labels[kind],exact:true}).locator('input[name="title"]').inputValue(),'Приватные несохранённые правки A');
    assert.deepEqual(state.legacy,[]);assert.deepEqual(state.foreign,[]);assert.deepEqual(state.errors,[]);
   }finally{await context.close();}
  });
  await suite.test('a definite validation refusal unlocks the captured form without losing its text',{timeout:20000},async()=>{
   const context=await browser.newContext(),page=await context.newPage();let writes=0;const unexpected=[];page.setDefaultTimeout(5000);
   await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());if(url.origin!==origin)return route.abort();if(!url.pathname.startsWith('/api/'))return route.continue();
    if(url.pathname==='/api/account/session')return route.fulfill({json:{user:{id:owner,email:'fixture@example.invalid',role:'user',isBlocked:false}}});
    if(url.pathname==='/api/account/profile')return route.fulfill({json:{exists:false,revision:null,profile:createDefaultCabinetProfile({email:'fixture@example.invalid'})}});
    if(url.pathname==='/api/account/service-publications'){
     const body=request.postDataJSON();if(body.action==='list')return route.fulfill({json:{items:[],nextCursor:null}});
     assert.equal(body.action,'create');writes++;if(writes===1)return route.fulfill({status:422,json:{error:{code:'INVALID_INPUT'}}});
     return route.fulfill({json:{id,kind:'marquee',form:parseServicePublicationForm('marquee',body.form),photos:[],revision:'1',status:'draft',paid:false,createdAt:stamp,updatedAt:stamp,publishedAt:null,expiresAt:null}});
    }
    if(url.pathname==='/api/account/service-moderation')return route.fulfill({json:{id:reviewId,revision:'1',state:'rejected',note:'Исправьте синтетическую ссылку'}});
    unexpected.push(url.pathname);return route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});
   });
   try{
    await page.goto(origin+paths.marquee);const form=page.getByRole('form',{name:labels.marquee,exact:true}),title=form.locator('input[name="title"]');
    await title.fill('Первая синтетическая версия');await form.getByRole('button',{name:'Сохранить черновик',exact:true}).click();
    await form.getByRole('alert').filter({hasText:'Проверьте поля формы'}).waitFor();
    assert.equal(await title.isDisabled(),false,'a definite 422 must not trap the form in an immutable unknown-outcome state');
    assert.equal(await title.inputValue(),'Первая синтетическая версия');await title.fill('Исправленная синтетическая версия');
    assert.equal(writes,1);assert.deepEqual(unexpected,[]);
    for(const checkbox of await form.locator('input[type="checkbox"]').all())await checkbox.check();
    await form.getByRole('button',{name:'Отправить на модерацию',exact:true}).click();
    await page.getByRole('region',{name:'Модерация материала',exact:true}).getByText('Нужны исправления',{exact:true}).waitFor();
    const corrected=page.getByRole('form',{name:labels.marquee,exact:true}).locator('input[name="title"]');
    assert.equal(await corrected.isDisabled(),false,'a concurrent rejection must return the saved editable form rather than freeze the initial submission');
    assert.equal(await corrected.inputValue(),'Исправленная синтетическая версия');assert.equal(writes,2);
   }finally{await context.close();}
  });
  assert.equal(output.includes('Unexpected browser fixture query'),false);
 }finally{await browser?.close();if(app?.exitCode===null){process.kill(-app.pid,'SIGTERM');await once(app,'exit');}await rm(directory,{recursive:true,force:true});}
});
