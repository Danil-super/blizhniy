// Production Next/Chromium with owned synthetic SQL/auth/media transports only.
import assert from 'node:assert/strict';import {test} from 'node:test';import {spawn} from 'node:child_process';import {once} from 'node:events';
import {createServer} from 'node:net';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {rootCertificates} from 'node:tls';import {randomBytes} from 'node:crypto';import {createRequire} from 'node:module';import {chromium} from 'playwright';import sharp from 'sharp';
import {parseServicePublicationForm} from '../src/lib/service-publication-contract.ts';import {createDefaultCabinetProfile} from '../src/lib/cabinet-profile.ts';
const owner='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000004',id='10000000-0000-4000-8000-000000000002',reviewId='10000000-0000-4000-8000-000000000003',stamp='2026-10-18T00:00:00.123456Z';
const paths={specialist:'/cabinet/specialist',fair:'/yarmarka-masterov/zayavka',marquee:'/reklama/begushchaya-stroka'};
const cabinets={specialist:'/cabinet/specialist',fair:'/cabinet/fair-applications',marquee:'/reklama/begushchaya-stroka?view=list'};
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
    if(url.pathname==='/api/reference/professions'){
     assert.equal(request.method(),'GET');
     assert.equal(request.headers().authorization,undefined);
     return route.fulfill({json:{items:[{id:reviewId,slug:'plumber',name:'Сантехник',parent:'Строительство',active:true}]}});
    }
    assert.equal(request.headers().authorization,undefined,'service forms never send legacy bearer');const body=request.postData()?request.headers()['content-type']==='application/json'?request.postDataJSON():null:null;
    if(url.pathname==='/api/account/session')return route.fulfill({headers:kind==='specialist'?{'X-Blizhniy-Specialist-Test':'1'}:{},json:{user:{id:state.owner,email:'fixture@example.invalid',role:'user',isBlocked:false}}});
    if(url.pathname==='/api/account/profile')return route.fulfill({json:{exists:false,revision:null,profile:createDefaultCabinetProfile({name:state.owner===owner?'Техническое имя':'Второй профиль',email:'fixture@example.invalid'})}});
    if(url.pathname==='/api/account/media'){state.uploads++;return route.fulfill({json:{id:request.headers()['x-blizhniy-intent'],mimeType:'image/webp',width:40,height:20,size:webp.length}});}
    if(url.pathname==='/api/account/media/read')return route.fulfill({contentType:'image/webp',body:webp});
    if(url.pathname==='/api/account/service-publications'){
     assert.equal(body.expectedOwnerId,state.owner);assert.equal(body.kind,kind);assert.equal(request.headers()['x-blizhniy-request'],'1');
     if(body.action==='list')return route.fulfill({json:{items:state.row?[{id,kind,title:state.row.form.title,revision:state.row.revision,status:'draft',paid:false,updatedAt:stamp}]:[],nextCursor:null}});
     if(body.action==='read'||body.action==='intent'){
      state.reads++;
      if(body.action==='read'&&!state.row)return route.fulfill({status:404,json:{error:{code:'PUBLICATION_NOT_FOUND'}}});
      return route.fulfill({json:state.row});
     }
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
    const initialTitle=kind==='specialist'?'Техническое имя':'Синтетический материал';
    const updatedTitle=kind==='specialist'?initialTitle:'Исправленный материал';
    const updatedAbout='Исправленное синтетическое описание специалиста';
    if(kind==='specialist'){
     const identity=form.getByRole('region',{name:'Данные из профиля'});
     await identity.getByText(initialTitle,{exact:true}).waitFor();
     assert.equal(await identity.getByRole('link',{name:'Изменить в настройках кабинета'}).getAttribute('href'),'/cabinet?settings=1');
     assert.equal(await form.locator('input[name="title"]').getAttribute('type'),'hidden');
     await form.getByRole('combobox',{name:'Профессия / специализация'}).fill('сант');
     await form.getByRole('option',{name:/^Сантехник(?: Строительство)?$/}).click();
     await form.locator('input[name="price"]').fill('1250,50');
    }else await form.locator('input[name="title"]').fill(initialTitle);
    if(kind!=='marquee'){
     await form.locator('textarea[name="description"]').fill('Синтетическое описание работ, товаров и условий размещения.');
     await form.locator('input[name="phone"]').fill('+79990000000');
     await form.locator('input[name="email"]').fill('fixture@example.invalid');
    }
    if(kind==='fair'){
     await form.locator('select[name="category"]').selectOption('Посуда');
     await form.locator('input[name="photos"]').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:png});
    }
    for(const checkbox of await form.locator('input[type="checkbox"]').all())await checkbox.check();
    await form.getByRole('button',{name:'Сохранить черновик',exact:true}).click();
    await form.getByRole('button',{name:'Проверить сохранённую форму',exact:true}).waitFor();
    assert.equal(state.writes,1);
    await form.getByRole('button',{name:'Проверить сохранённую форму',exact:true}).click();
    await page.waitForURL(origin+cabinets[kind]);
    const record=title=>kind==='specialist'
     ?page.getByRole('region',{name:'Моя анкета',exact:true})
     :page.getByRole('article').filter({has:page.getByRole('heading',{name:title,exact:true})});
    await record(initialTitle).getByRole('heading',{name:initialTitle,exact:true}).waitFor();
    assert.equal(state.writes,1);
    assert.ok(state.reads>=1);
    assert.equal(state.row.form.title,initialTitle);
    if(kind!=='specialist')await record(initialTitle).getByRole('button',{name:'Подробнее: '+initialTitle}).click();
    const moderation=page.getByRole('region',{name:'Модерация материала',exact:true});
    await moderation.getByRole('button',{name:'Отправить на модерацию',exact:true}).click();
    await moderation.getByText('На модерации',{exact:true}).waitFor();
    assert.equal(state.review.revision,state.row.revision);
    assert.equal(state.row.paid,false);
    assert.equal(state.row.publishedAt,null);
    const editorUrl=origin+(kind==='specialist'?'/rabota/specialisty/anketa':paths[kind])+'?draft='+id;
    await record(initialTitle).getByRole('link',{name:'Редактировать',exact:true}).click();
    await page.waitForURL(editorUrl);
    const edit=page.getByRole('form',{name:labels[kind],exact:true});
    const revised=kind==='specialist'?edit.locator('textarea[name="description"]'):edit.locator('input[name="title"]');
    await revised.fill(kind==='specialist'?updatedAbout:updatedTitle);
    await edit.getByRole('button',{name:'Сохранить черновик',exact:true}).click();
    await page.waitForURL(origin+cabinets[kind]);
    await record(updatedTitle).getByRole('heading',{name:updatedTitle,exact:true}).waitFor();
    assert.equal(state.row.revision,'9007199254740994');
    assert.equal(state.row.form.title,updatedTitle);
    if(kind==='specialist')assert.equal(state.row.form.description,updatedAbout);
    assert.equal(state.uploads,kind==='fair'?1:0);
    await record(updatedTitle).getByRole('link',{name:'Редактировать',exact:true}).click();
    await page.waitForURL(editorUrl);
    await edit.waitFor();
    assert.equal(await revised.inputValue(),kind==="specialist"?updatedAbout:updatedTitle);
    await page.addScriptTag({path:createRequire(import.meta.url).resolve('axe-core/axe.min.js')});
    for(const width of [320,768,1440]){
     await page.setViewportSize({width,height:1000});
     assert.equal(await page.locator('body').evaluate(node=>node.scrollWidth>innerWidth),false);
     const violations=await edit.evaluate(async node=>(await window.axe.run(node,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}})).violations.filter(item=>['serious','critical'].includes(item.impact)).map(item=>({id:item.id,nodes:item.nodes.map(node=>({target:node.target,summary:node.failureSummary}))})));
     assert.deepEqual(violations,[]);
    }
    const previous=state.row;
    const privateEdit='Приватные несохранённые правки A';
    await revised.fill(privateEdit);
    state.owner=other;
    state.row=null;
    state.review=null;
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(value=>!Array.from(document.querySelectorAll('input[name="title"],textarea[name="description"]')).some(input=>input.value===value),privateEdit);
    await page.getByRole('alert').filter({hasText:'Материал недоступен.'}).waitFor();
    await page.getByRole('button',{name:'Повторить загрузку',exact:true}).waitFor();
    assert.equal(await edit.count(),0);
    assert.equal(state.writes,2,'owner switch does not automatically save another account');
    state.owner=owner;
    state.row=previous;
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await edit.waitFor();
    assert.notEqual(await revised.inputValue(),privateEdit);
    assert.deepEqual(state.legacy,[]);assert.deepEqual(state.foreign,[]);assert.deepEqual(state.errors,[]);
   }finally{await context.close();}
  });
  await suite.test('a definite validation refusal unlocks the captured form without losing its text',{timeout:20000},async()=>{
   const context=await browser.newContext(),page=await context.newPage();let writes=0,saved=null;const unexpected=[];page.setDefaultTimeout(5000);
   await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());if(url.origin!==origin)return route.abort();if(!url.pathname.startsWith('/api/'))return route.continue();
    if(url.pathname==='/api/account/session')return route.fulfill({json:{user:{id:owner,email:'fixture@example.invalid',role:'user',isBlocked:false}}});
    if(url.pathname==='/api/account/profile')return route.fulfill({json:{exists:false,revision:null,profile:createDefaultCabinetProfile({email:'fixture@example.invalid'})}});
    if(url.pathname==='/api/account/service-publications'){
     const body=request.postDataJSON();if(body.action==='list')return route.fulfill({json:{items:saved?[{id,kind:'marquee',title:saved.form.title,revision:saved.revision,status:'draft',paid:false,updatedAt:stamp}]:[],nextCursor:null}});
     if(body.action==='read')return route.fulfill({json:saved});
     assert.equal(body.action,'create');writes++;if(writes===1)return route.fulfill({status:422,json:{error:{code:'INVALID_INPUT'}}});
     saved={id,kind:'marquee',form:parseServicePublicationForm('marquee',body.form),photos:[],revision:'1',status:'draft',paid:false,createdAt:stamp,updatedAt:stamp,publishedAt:null,expiresAt:null};
     return route.fulfill({json:saved});
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
    await page.waitForURL(origin+cabinets.marquee);
    const record=page.getByRole('article').filter({has:page.getByRole('heading',{name:'Исправленная синтетическая версия',exact:true})});
    await record.getByRole('button',{name:'Подробнее: Исправленная синтетическая версия'}).click();
    await page.getByRole('region',{name:'Модерация материала',exact:true}).getByText('Нужны исправления',{exact:true}).waitFor();
    await record.getByRole('link',{name:'Редактировать',exact:true}).click();
    await page.waitForURL(origin+paths.marquee+'?draft='+id);
    const corrected=page.getByRole('form',{name:labels.marquee,exact:true}).locator('input[name="title"]');
    assert.equal(await corrected.isDisabled(),false,'a concurrent rejection must return the saved editable form rather than freeze the initial submission');
    assert.equal(await corrected.inputValue(),'Исправленная синтетическая версия');assert.equal(writes,2);
   }finally{await context.close();}
  });
  assert.equal(output.includes('Unexpected browser fixture query'),false);
 }finally{await browser?.close();if(app?.exitCode===null){process.kill(-app.pid,'SIGTERM');await once(app,'exit');}await rm(directory,{recursive:true,force:true});}
});
