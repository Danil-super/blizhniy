// Real production pages, owned localhost SQL/API/media fixtures only.
// Build separately before running; this test never builds or contacts the real DB.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {rootCertificates} from 'node:tls';
import {randomBytes} from 'node:crypto';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {parseWorkPublicationForm} from '../src/lib/work-publication-contract.ts';
import {createDefaultCabinetProfile} from '../src/lib/cabinet-profile.ts';

const owner='12345678-1234-4321-8765-123456789abc',other='32345678-1234-4321-8765-123456789abc';
const stamp='2026-10-18T12:00:00.123456Z';
const chosen={vacancy:{path:'/rabota/vakansii/sozdat',cabinet:'/cabinet/vakansii',id:'22345678-1234-4321-8765-123456789abc',title:'Синтетическая вакансия'},
 workRequest:{path:'/rabota/zakazy/sozdat',cabinet:'/cabinet/zakazy',id:'42345678-1234-4321-8765-123456789abc',title:'Синтетический заказ'}};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const render=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));

async function fillWorkForm(page,kind,pixels){
 if(kind==='vacancy'){
  await page.getByRole('button',{name:/Частное лицо/}).click();
  await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  await page.locator('input[name="organization"]').fill('Синтетический');
  await page.locator('input[name="schedule"]').fill('5/2');
  await page.locator('input[name="workFormat"]').fill('На месте');
  await page.locator('input[name="salary"]').fill('12000');
  await page.locator('textarea[name="responsibilities"]').fill('Выполнение синтетических задач по согласованному графику.');
  await page.locator('textarea[name="requirements"]').fill('Опыт работы и аккуратность при выполнении задания.');
  await page.locator('textarea[name="conditions"]').fill('Инструменты предоставляются, оплата согласована.');
 }else{
  await page.locator('input[name="budget"]').fill('15000');
 }
 await page.locator('input[name="title"]').fill(chosen[kind].title);
 assert.equal(await page.locator('input[name="profession"]').count(),1,'the migrated work form must expose the profession field');
 await page.locator('input[name="profession"]').fill('Сантехник');
 await page.locator('input[name="phone"]').fill('+79990000000');
 await page.locator('input[name="messengerUrl"]').fill('@fixture_user');
 await page.locator('textarea[name="description"]').fill('Синтетическое описание задачи для изолированной проверки переноса формы.');
 await page.locator('input[name="photos"]').setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:pixels});
 for(const checkbox of await page.locator('form input[type="checkbox"]').all())await checkbox.check();
}

async function checkLayout(page,scope){
 await page.addScriptTag({path:createRequire(import.meta.url).resolve('axe-core/axe.min.js')});
 for(const width of [320,768,1024,1440]){
  await page.setViewportSize({width,height:900});
  assert.equal(await page.locator('body').evaluate(node=>node.scrollWidth>innerWidth),false,`work publication fits ${width}px`);
  const violations=await page.evaluate(async selector=>{
   const target=document.querySelector(selector);if(!target)throw new Error('Expected accessibility scope is missing');
   const result=await window.axe.run(target,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});
   return result.violations.filter(item=>['serious','critical'].includes(item.impact)).map(item=>({id:item.id,targets:item.nodes.map(node=>node.target)}));
  },scope);
  assert.deepEqual(violations,[],'work form/editor has no serious or critical scoped axe findings');
 }
}

test('work publication production pages preserve complete forms and use Russian cookie publication/moderation APIs',{timeout:120000},async suite=>{
 const directory=await mkdtemp(join(tmpdir(),'blizhniy-work-browser-'));let app,browser,output='';
 try{
  const key=join(directory,'key'),ca=join(directory,'ca');
  await writeFile(key,randomBytes(32),{mode:0o600});await writeFile(ca,rootCertificates[0],{mode:0o600});
  const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const origin=`http://127.0.0.1:${port}`;
  const env={PATH:process.env.PATH,LANG:'C.UTF-8',NODE_ENV:'production',__NEXT_PROCESSED_ENV:'true',NEXT_TELEMETRY_DISABLED:'1',BLIZHNIY_AUTH_MODE:'postgres',
   BLIZHNIY_AUTH_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai',BLIZHNIY_DB_HOST:'17e86f80f26733d39ef4b84d.twc1.net',BLIZHNIY_DB_PORT:'5432',BLIZHNIY_DB_NAME:'blizhniy_prod',BLIZHNIY_DB_USER:'blizhniy_runtime',
   BLIZHNIY_DB_PASSWORD:'synthetic-ui-db-password',BLIZHNIY_DB_SSL_MODE:'verify-full',BLIZHNIY_DB_CA_FILE:ca,BLIZHNIY_AUTH_MAIL_KEY_FILE:key,
   BLIZHNIY_AUTH_RATE_SECRET:'synthetic-ui-only-rate-secret-not-used-by-api',BLIZHNIY_MAIL_MODE:'timeweb',BLIZHNIY_SMTP_USER:'notifications@ближний-ру.рф',
   BLIZHNIY_SMTP_PASSWORD:'synthetic-ui-smtp-password',TURNSTILE_SECRET_KEY:'synthetic-ui-captcha-secret',NEXT_PUBLIC_TURNSTILE_SITE_KEY:''};
  app=spawn(process.execPath,['--experimental-strip-types','--require','./tests/listing-form-browser-pg.cjs','node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],
   {env,detached:true,stdio:['ignore','pipe','pipe']});
  app.stdout.on('data',chunk=>{output=(output+chunk).slice(-16000);});app.stderr.on('data',chunk=>{output=(output+chunk).slice(-16000);});
  const deadline=Date.now()+20000;
  for(;;){
   assert.equal(app.exitCode,null,'owned production process is running');
   try{if((await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)})).ok)break;}
   catch(error){assert.ok(error.cause?.code==='ECONNREFUSED'||error.name==='TimeoutError');}
   assert.ok(Date.now()<deadline,'owned production app starts');await new Promise(resolve=>setTimeout(resolve,100));
  }
  browser=await chromium.launch({headless:true});
  const pixels=await sharp({create:{width:80,height:40,channels:3,background:'red'}}).png().toBuffer();
  const webp=await sharp(pixels).webp().toBuffer();
  async function run(name,kind,scenario){
   await suite.test(name,{timeout:45000},async()=>{
    const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
    page.setDefaultTimeout(10000);
    const state={active:owner,sessionGate:null,loseCreate:false,records:new Map(),intents:new Map(),media:new Map(),moderation:new Map(),
     workCalls:[],moderationCalls:[],uploads:[],sequence:[],foreign:[],legacy:[],errors:[],sessionReads:0};
    const collection=()=>{const key=state.active+':'+kind;if(!state.records.has(key))state.records.set(key,new Map());return state.records.get(key);};
    context.on('page',item=>item.on('pageerror',()=>state.errors.push('pageerror')));page.on('pageerror',()=>state.errors.push('pageerror'));
    await context.route('**/*',async route=>{
     const request=route.request(),url=new URL(request.url());
     if(['http:','https:'].includes(url.protocol)&&url.origin!==origin){state.foreign.push(url.host);return route.abort();}
     if(url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/api/account/')){state.legacy.push(url.pathname);return route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});}
     if(!url.pathname.startsWith('/api/account/'))return route.continue();
     assert.equal(request.headers().authorization,undefined,'work publication never sends Bearer/legacy authority');
     assert.equal(request.headers()['x-blizhniy-request'],'1');assert.equal(url.search,'');
     if(url.pathname==='/api/account/session'){
      assert.equal(request.method(),'POST');assert.deepEqual(request.postDataJSON(),{});state.sessionReads++;
      if(state.sessionGate)await state.sessionGate.promise;
      return route.fulfill({json:{user:{id:state.active,email:state.active===owner?'first@example.invalid':'second@example.invalid',role:'user',isBlocked:false}}});
     }
     if(url.pathname==='/api/account/media'){
      assert.equal(request.method(),'POST');assert.equal(request.headers()['x-blizhniy-owner'],state.active);
      const mediaId=request.headers()['x-blizhniy-intent'];assert.match(mediaId,/^[a-f0-9-]{36}$/);
      const photo={id:mediaId,mimeType:'image/webp',width:80,height:40,size:webp.length};
      state.media.set(mediaId,{owner:state.active,photo});state.uploads.push(mediaId);state.sequence.push('upload');return route.fulfill({json:photo});
     }
     const body=request.postDataJSON();
     if(url.pathname==='/api/account/profile'){
      assert.equal(request.method(),'POST');assert.deepEqual(body,{expectedOwnerId:state.active});
      return route.fulfill({json:{exists:false,profile:createDefaultCabinetProfile({name:'Технический',email:'fixture@example.invalid'}),revision:null}});
     }
     if(body.expectedOwnerId!==state.active)return route.fulfill({status:404,json:{error:{code:'PUBLICATION_NOT_FOUND'}}});
     if(url.pathname==='/api/account/media/read'){
      assert.equal(request.method(),'POST');if(state.media.get(body.fileId)?.owner!==state.active)return route.fulfill({status:404,json:{error:{code:'MEDIA_NOT_FOUND'}}});
      return route.fulfill({contentType:'image/webp',body:webp});
     }
     if(url.pathname==='/api/account/work-moderation'){
      assert.deepEqual(Object.keys(body).sort(),['expectedOwnerId','expectedRevision','kind','publicationId']);assert.equal(body.kind,kind);
      const saved=collection().get(body.publicationId);assert.ok(saved);assert.equal(body.expectedRevision,saved.revision);
      state.moderationCalls.push({method:request.method(),body});
      if(request.method()==='PUT')state.moderation.set(saved.id,{id:'52345678-1234-4321-8765-123456789abc',revision:saved.revision,state:'pending',note:null});
      else assert.equal(request.method(),'POST');
      return route.fulfill({json:state.moderation.get(saved.id)??{id:null,revision:null,state:'not_submitted',note:null}});
     }
     if(url.pathname!=='/api/account/work-publications')return route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});
     state.workCalls.push({method:request.method(),body});state.sequence.push('work:'+body.action);assert.equal(body.kind,kind);
     const keys={list:['action','after','expectedOwnerId','kind'],read:['action','expectedOwnerId','kind','publicationId'],intent:['action','creationKey','expectedOwnerId','kind'],
      create:['action','creationKey','expectedOwnerId','form','kind'],update:['action','expectedOwnerId','expectedRevision','form','kind','publicationId']}[body.action];
     assert.ok(keys,'only explicit read/write actions are accepted');assert.deepEqual(Object.keys(body).sort(),keys.sort());
     assert.equal(request.method(),['create','update'].includes(body.action)?'PUT':'POST');
     if(body.action==='list')return route.fulfill({json:{items:[...collection().values()].map(row=>({id:row.id,kind:row.kind,revision:row.revision,status:row.status,paid:row.paid,updatedAt:row.updatedAt,title:row.form.title})),nextCursor:null}});
     if(body.action==='intent')return route.fulfill({json:collection().get(state.intents.get(state.active+':'+kind+':'+body.creationKey))??null});
     if(body.action==='read'){
      const saved=collection().get(body.publicationId);
      return route.fulfill(saved?{json:saved}:{status:404,json:{error:{code:'PUBLICATION_NOT_FOUND'}}});
     }
     const form=parseWorkPublicationForm(kind,body.form);
     const photos=form.photoIds.map(id=>{const media=state.media.get(id);assert.equal(media?.owner,state.active,'all attached photos belong to the current owner');return media.photo;});
     let saved;
     if(body.action==='create'){
      assert.match(body.creationKey,/^[a-f0-9-]{36}$/);assert.equal(collection().size,0,'lost acknowledgement must not cause a second create');
      saved={id:chosen[kind].id,kind,revision:'9007199254740993',status:'draft',paid:false,form,photos,createdAt:stamp,updatedAt:stamp,publishedAt:null,expiresAt:null};
      collection().set(saved.id,saved);state.intents.set(state.active+':'+kind+':'+body.creationKey,saved.id);
      if(state.loseCreate){state.loseCreate=false;return route.abort('connectionreset');}
     }else{
      const before=collection().get(body.publicationId);assert.ok(before);if(body.expectedRevision!==before.revision)return route.fulfill({status:409,json:{error:{code:'PUBLICATION_CHANGED'}}});
      saved={...before,revision:String(BigInt(before.revision)+1n),form,photos};collection().set(saved.id,saved);
     }
     return route.fulfill({json:saved});
    });
    try{await scenario({page,state,collection});assert.deepEqual(state.foreign,[]);assert.deepEqual(state.legacy,[]);assert.deepEqual(state.errors,[]);}
    finally{state.sessionGate?.resolve();await context.close();}
   });
  }
  for(const kind of ['vacancy','workRequest']){
   await run(kind+' fresh draft save reaches the cookie publication API without legacy or payment requests',kind,async({page,state})=>{
    await page.goto(origin+chosen[kind].path);
    if(kind==='vacancy'){
     await page.getByRole('button',{name:/Частное лицо/}).click();await page.getByRole('button',{name:'Продолжить',exact:true}).click();
     await page.locator('input[name="organization"]').fill('Синтетический');
    }
    await page.locator('input[name="title"]').fill('Незавершённый рабочий черновик');
    const created=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/account/work-publications'&&request.method()==='PUT'&&request.postDataJSON()?.action==='create',{timeout:3000}).catch(()=>null);
    await page.getByRole('button',{name:'Сохранить черновик',exact:true}).click();
    assert.ok(await created,'saving a work draft must reach PUT /api/account/work-publications action=create; the legacy-only form currently sends no such request');
    await page.waitForURL(origin+chosen[kind].cabinet);
    assert.equal(state.workCalls.filter(row=>row.body.action==='create').length,1);assert.equal(state.uploads.length,0);
    assert.equal(state.moderationCalls.filter(row=>row.method==='PUT').length,0,'saving a draft does not submit or pay for it');
   });
   await run(kind+' complete form survives focus, recovers lost create acknowledgement by intent and edits through cabinet CAS',kind,async({page,state,collection})=>{
    const response=await page.goto(origin+chosen[kind].path,{waitUntil:'domcontentloaded'});assert.equal(response.status(),200,output);
    await fillWorkForm(page,kind,pixels);
    const gate=deferred();state.sessionGate=gate;
    const read=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/account/session');
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await read;await render(page);
    assert.equal(await page.locator('input[name="title"]').isVisible(),false,'unknown identity temporarily hides the private form');
    gate.resolve();state.sessionGate=null;await page.locator('input[name="title"]').waitFor();
    assert.equal(await page.locator('input[name="title"]').inputValue(),chosen[kind].title);
    assert.equal(await page.locator('input[name="profession"]').inputValue(),'Сантехник');
    assert.equal(await page.locator('input[name="photos"]').evaluate(input=>input.files.length),1);
    state.loseCreate=true;await page.getByRole('button',{name:'Сохранить черновик',exact:true}).click();
    await page.getByRole('button',{name:'Проверить сохранённую форму',exact:true}).waitFor();
    assert.equal(state.workCalls.filter(row=>row.method==='PUT').length,1);assert.equal(state.uploads.length,1);
    assert.ok(state.sequence.indexOf('upload')<state.sequence.indexOf('work:create'),'photos are uploaded before creating the publication');
    const create=state.workCalls.find(row=>row.body.action==='create').body;
    assert.equal(create.form.professionName,'Сантехник');assert.equal(create.form.cityName,'Краснодар');
    assert.equal(create.form.photoIds.length,1);assert.equal(create.form.messengerUrl,'https://t.me/fixture_user');
    assert.equal(create.form[kind==='vacancy'?'salary':'budget'],kind==='vacancy'?'12000.00':'15000.00');
    if(kind==='vacancy')assert.equal(create.form.employerType,'person');
    await checkLayout(page,'form');
    await page.getByRole('button',{name:'Проверить сохранённую форму',exact:true}).click();await page.waitForURL(origin+chosen[kind].cabinet);
    await page.getByRole('button',{name:chosen[kind].title,exact:true}).waitFor();
    assert.equal(state.workCalls.filter(row=>row.method==='PUT').length,1);assert.equal(state.workCalls.filter(row=>row.body.action==='intent').length,1);
    assert.equal(state.uploads.length,1);assert.ok(state.workCalls.some(row=>row.body.action==='list'));
    await page.getByRole('button',{name:chosen[kind].title,exact:true}).click();
    await page.locator('input[name="title"]').waitFor();assert.equal(await page.locator('input[name="title"]').inputValue(),chosen[kind].title);
    const nextTitle=chosen[kind].title+' исправлена';await page.locator('input[name="title"]').fill(nextTitle);
    const updated=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/account/work-publications'&&response.request().postDataJSON()?.action==='update');
    await page.getByRole('button',{name:'Сохранить черновик',exact:true}).click();assert.equal((await updated).status(),200);await render(page);
    assert.equal(state.workCalls.find(row=>row.body.action==='update').body.expectedRevision,'9007199254740993');
    assert.equal(collection().get(chosen[kind].id).revision,'9007199254740994');assert.equal(collection().get(chosen[kind].id).form.title,nextTitle);
    await page.reload();await page.getByRole('button',{name:nextTitle,exact:true}).click();await page.locator('input[name="title"]').waitFor();
    assert.equal(await page.locator('input[name="title"]').inputValue(),nextTitle);await checkLayout(page,'form');
    await page.getByRole('button',{name:'Отправить на модерацию',exact:true}).click();await page.getByText('На модерации',{exact:true}).waitFor();
    assert.equal(state.moderationCalls.filter(row=>row.method==='PUT').length,1);
    assert.deepEqual(state.moderationCalls.find(row=>row.method==='PUT').body,{expectedOwnerId:owner,kind,publicationId:chosen[kind].id,expectedRevision:'9007199254740994'});
    assert.equal(state.workCalls.filter(row=>row.method==='PUT').length,2,'moderation is not another publication save');
    assert.equal(await page.getByRole('button',{name:'Создать и оплатить',exact:true}).count(),0,'work publication follows moderation before payment');
    await page.goto(origin+(kind==='vacancy'?'/rabota/vakansii/':'/rabota/zakazy/')+chosen[kind].id+'/edit');
    await page.locator('input[name="title"]').waitFor();assert.equal(await page.locator('input[name="title"]').inputValue(),nextTitle,'the canonical edit URL also reads the cookie-owned Russian record');
    assert.equal(state.workCalls.filter(row=>row.method==='PUT').length,2);
   });
   await run(kind+' owner switch removes a private unsaved form and its selected file without writing it under another account',kind,async({page,state})=>{
    await page.goto(origin+chosen[kind].path);await fillWorkForm(page,kind,pixels);
    await page.locator('input[name="title"]').fill('Буфер первого владельца');
    state.active=other;
    const checked=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/account/session');
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await checked;await render(page);
    if(kind==='vacancy'){
     await page.getByRole('button',{name:/Частное лицо/}).click();await page.getByRole('button',{name:'Продолжить',exact:true}).click();
    }
    await page.locator('input[name="title"]').waitFor();
    assert.equal(await page.locator('input[name="title"]').inputValue(),'');assert.equal(await page.locator('input[name="photos"]').evaluate(input=>input.files.length),0);
    assert.equal(state.workCalls.filter(row=>row.method==='PUT').length,0);assert.equal(state.uploads.length,0);
    assert.equal((await page.locator('main').textContent()).includes('Буфер первого владельца'),false);
   });
  }
 }finally{
  await browser?.close();if(app&&app.exitCode===null){process.kill(-app.pid,'SIGTERM');await once(app,'exit');}await rm(directory,{recursive:true});
 }
});
