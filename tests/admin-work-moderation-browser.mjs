// Real built moderator pages; every SQL/account/media transport is an owned fixture.
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
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {parseWorkPublicationForm} from '../src/lib/work-publication-contract.ts';

const firstAdmin='12345678-1234-4321-8765-123456789abc',secondAdmin='52345678-1234-4321-8765-123456789abc';
const ordinaryUser='62345678-1234-4321-8765-123456789abc',photoId='42345678-1234-4321-8765-123456789abc';
const requestId='22345678-1234-4321-8765-123456789abc',publicationId='32345678-1234-4321-8765-123456789abc';
const updatedAt='2026-10-18T12:00:00.123456Z',revision='9007199254740993';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const render=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));

test('Russian cookie moderation reviews work publications, resolves lost decisions read-only and isolates administrator scope',{timeout:90000},async suite=>{
 const directory=await mkdtemp(join(tmpdir(),'blizhniy-admin-work-browser-'));let app,browser;
 try{
  const key=join(directory,'key'),ca=join(directory,'ca');
  await writeFile(key,randomBytes(32),{mode:0o600});await writeFile(ca,rootCertificates[0],{mode:0o600});
  const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const origin=`http://127.0.0.1:${port}`;
  const env={PATH:process.env.PATH,LANG:'C.UTF-8',NODE_ENV:'production',__NEXT_PROCESSED_ENV:'true',NEXT_TELEMETRY_DISABLED:'1',BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai',
   BLIZHNIY_DB_HOST:'17e86f80f26733d39ef4b84d.twc1.net',BLIZHNIY_DB_PORT:'5432',BLIZHNIY_DB_NAME:'blizhniy_prod',BLIZHNIY_DB_USER:'blizhniy_runtime',BLIZHNIY_DB_PASSWORD:'synthetic-ui-db-password',
   BLIZHNIY_DB_SSL_MODE:'verify-full',BLIZHNIY_DB_CA_FILE:ca,BLIZHNIY_AUTH_MAIL_KEY_FILE:key,BLIZHNIY_AUTH_RATE_SECRET:'synthetic-ui-only-rate-secret-not-used-by-api',BLIZHNIY_MAIL_MODE:'timeweb',
   BLIZHNIY_SMTP_USER:'notifications@ближний-ру.рф',BLIZHNIY_SMTP_PASSWORD:'synthetic-ui-smtp-password',TURNSTILE_SECRET_KEY:'synthetic-ui-captcha-secret',NEXT_PUBLIC_TURNSTILE_SITE_KEY:''};
  app=spawn(process.execPath,['--experimental-strip-types','--require','./tests/listing-form-browser-pg.cjs','node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],
   {env,detached:true,stdio:'ignore'});
  const deadline=Date.now()+20000;
  for(;;){
   assert.equal(app.exitCode,null,'owned moderator production process is running');
   try{if((await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)})).ok)break;}
   catch(error){assert.ok(error.cause?.code==='ECONNREFUSED'||error.name==='TimeoutError');}
   assert.ok(Date.now()<deadline,'owned moderator production process starts');await new Promise(resolve=>setTimeout(resolve,100));
  }
  browser=await chromium.launch({headless:true});
  const pixels=await sharp({create:{width:80,height:40,channels:3,background:'red'}}).webp().toBuffer();
  for(const [path,kind] of [['/admin/vakansii','vacancy'],['/admin/zakazy','workRequest']]){
   await suite.test(path+' reviews private work data without old APIs, automatic retries or cross-account note leaks',{timeout:40000},async()=>{
    const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();page.setDefaultTimeout(10000);
    const state={active:firstAdmin,gate:null,lose:true,writes:[],reads:[],photos:[],foreign:[],legacy:[],errors:[]};
    const form=parseWorkPublicationForm(kind,{kind,title:kind==='vacancy'?'Синтетическая вакансия на проверке':'Синтетический заказ на проверке',
     description:'Синтетическая приватная форма для проверки модератором.',professionName:'Сантехник',cityName:'Краснодар',contactPhone:'+79990000000',
     messengerUrl:'https://t.me/fixture_user',photoIds:[photoId],placementRightConfirmed:true,
     ...(kind==='vacancy'?{employerType:'person',organization:'Синтетический',salary:'12000.00'}:{budget:'15000.00'})});
    let currentId=requestId,decision='pending',note=null;
    const snapshot={id:publicationId,kind,revision,status:'draft',paid:false,form,photos:[{id:photoId,mimeType:'image/webp',width:80,height:40,size:pixels.length}],
     createdAt:updatedAt,updatedAt,publishedAt:null,expiresAt:null};
    page.on('pageerror',()=>state.errors.push('pageerror'));
    await context.route('**/*',async route=>{
     const request=route.request(),url=new URL(request.url());
     if(['http:','https:'].includes(url.protocol)&&url.origin!==origin){state.foreign.push(url.host);return route.abort();}
     if(url.pathname==='/api/account/session'){
      assert.equal(request.method(),'POST');assert.equal(request.headers().authorization,undefined);assert.deepEqual(request.postDataJSON(),{});
      if(state.gate)await state.gate.promise;
      return route.fulfill({json:{user:{id:state.active,email:state.active===firstAdmin?'first-admin@example.invalid':state.active===secondAdmin?'second-admin@example.invalid':'user@example.invalid',
       role:state.active===ordinaryUser?'user':'admin',isBlocked:false}}});
     }
     if(!url.pathname.startsWith('/api/'))return route.continue();
     if(url.pathname!=='/api/admin/work-moderation'){state.legacy.push(url.pathname);return route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});}
     const body=request.postDataJSON();assert.equal(request.headers().authorization,undefined);assert.equal(request.headers()['x-blizhniy-request'],'1');assert.equal(url.search,'');
     if(state.active===ordinaryUser)return route.fulfill({status:403,json:{error:{code:'FORBIDDEN'}}});
     assert.equal(body.expectedAdminId,state.active,'the expected administrator tracks the verified cookie session, not a cached previous account');
     if(request.method()==='PUT'){
      assert.deepEqual(Object.keys(body).sort(),['expectedAdminId','note','requestId','state']);assert.equal(body.requestId,currentId);
      assert.ok(['approved','rejected'].includes(body.state));assert.equal(body.state==='approved'?body.note===null:typeof body.note==='string'&&body.note.length>0,true);
      state.writes.push(body);decision=body.state;note=body.note;
      if(state.lose){state.lose=false;return route.abort('connectionreset');}
      return route.fulfill({json:{id:currentId,revision:snapshot.revision,state:decision,note}});
     }
     assert.equal(request.method(),'POST');state.reads.push(body);
     if(body.action==='list'){
      assert.deepEqual(Object.keys(body).sort(),['action','after','expectedAdminId']);assert.equal(body.after,null);
      return route.fulfill({json:{items:decision==='pending'?[{id:currentId,publicationId,kind,revision:snapshot.revision,title:snapshot.form.title,updatedAt}]:[],nextCursor:null}});
     }
     if(body.action==='photo'){
      assert.deepEqual(Object.keys(body).sort(),['action','expectedAdminId','fileId','requestId']);assert.equal(body.requestId,currentId);assert.equal(body.fileId,photoId);
      state.photos.push(body);return route.fulfill({contentType:'image/webp',body:pixels});
     }
     assert.equal(body.action,'inspect');assert.deepEqual(Object.keys(body).sort(),['action','expectedAdminId','requestId']);assert.equal(body.requestId,currentId);
     return route.fulfill({json:{request:{id:currentId,revision:snapshot.revision,state:decision,note},snapshot,issues:[]}});
    });
    try{
     await page.goto(origin+path,{waitUntil:'domcontentloaded'});
     await page.getByRole('heading',{name:'Вакансии и заказы на модерации',exact:true}).waitFor();
     await page.getByRole('button',{name:form.title,exact:true}).click();
     await page.getByRole('img',{name:'Фотография 1 из 1',exact:true}).waitFor();
     assert.equal(state.photos.length,1,'private images are retrieved through the moderated request, never public URLs');
     await page.getByLabel('Причина отказа',{exact:true}).fill('Уточните синтетическое описание');
     const gate=deferred();state.gate=gate;
     const started=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/account/session');
     await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await started;await render(page);
     assert.equal(await page.getByLabel('Причина отказа',{exact:true}).count(),0,'unverified administrator cannot expose a private editor in the DOM');
     assert.equal(await page.getByRole('img',{name:'Фотография 1 из 1',exact:true}).count(),0);
     assert.equal((await page.locator('main').textContent()).includes(form.description),false);
     gate.resolve();state.gate=null;await page.getByLabel('Причина отказа',{exact:true}).waitFor();
     assert.equal(await page.getByLabel('Причина отказа',{exact:true}).inputValue(),'Уточните синтетическое описание','same-admin recheck preserves the local rejection reason in memory');
     await page.getByRole('button',{name:'Отклонить с причиной',exact:true}).click();
     await page.getByRole('button',{name:'Сверить решение',exact:true}).waitFor();
     assert.equal(state.writes.length,1);assert.equal(await page.getByRole('button',{name:'Одобрить для оплаты',exact:true}).isDisabled(),true);
     assert.equal(await page.getByRole('button',{name:'Отклонить с причиной',exact:true}).isDisabled(),true);
     const inspections=state.reads.filter(body=>body.action==='inspect').length;
     await page.getByRole('button',{name:'Сверить решение',exact:true}).click();
     await page.getByText(/Отклонено/).first().waitFor();
     assert.equal(state.reads.filter(body=>body.action==='inspect').length,inspections+1);assert.equal(state.writes.length,1,'readback of an unknown decision never repeats PUT');
     assert.deepEqual(state.writes[0],{expectedAdminId:firstAdmin,requestId,state:'rejected',note:'Уточните синтетическое описание'});
     await page.addScriptTag({path:createRequire(import.meta.url).resolve('axe-core/axe.min.js')});
     for(const width of [320,768,1024,1440]){
      await page.setViewportSize({width,height:900});assert.equal(await page.locator('body').evaluate(node=>node.scrollWidth>innerWidth),false);
      const violations=await page.evaluate(async()=>{
       const target=document.querySelector('main');if(!target)throw new Error('Moderator accessibility scope is missing');
       const result=await window.axe.run(target,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});
       return result.violations.filter(item=>['serious','critical'].includes(item.impact)).map(item=>({id:item.id,targets:item.nodes.map(node=>node.target)}));
      });
      assert.deepEqual(violations,[],'scoped moderator screen has no serious or critical accessibility failures');
      if(width===320)await page.screenshot({path:'/tmp/blizhniy-admin-work-'+kind+'-320.png',fullPage:true});
     }
     currentId='72345678-1234-4321-8765-123456789abc';snapshot.revision='9007199254740994';snapshot.form={...form,title:'Повторная синтетическая версия',photoIds:[]};snapshot.photos=[];decision='pending';note=null;
     await page.getByRole('button',{name:'Обновить очередь',exact:true}).click();
     await page.getByRole('button',{name:snapshot.form.title,exact:true}).click();
     await page.getByRole('button',{name:'Одобрить для оплаты',exact:true}).click();await page.getByText(/Одобрено/).first().waitFor();
     assert.equal(state.writes.length,2);assert.deepEqual(state.writes[1],{expectedAdminId:firstAdmin,requestId:currentId,state:'approved',note:null});
     assert.equal(await page.getByRole('button',{name:'Оплатить',exact:true}).count(),0,'moderator approval is not a payment or publication');
     state.active=secondAdmin;
     const switched=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/account/session');
     await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await switched;await render(page);
     await page.getByLabel('Причина отказа',{exact:true}).waitFor({state:'detached'});
     assert.equal((await page.locator('main').textContent()).includes('Уточните синтетическое описание'),false,'a different administrator must not inherit another administrator\'s local note');
     assert.equal(state.writes.length,2);
     state.active=ordinaryUser;
     const revoked=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/account/session');
     await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await revoked;await render(page);
     assert.equal(await page.getByLabel('Причина отказа',{exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Одобрить для оплаты',exact:true}).count(),0);
     assert.equal((await page.locator('main').textContent()).includes(form.description),false);assert.equal(state.writes.length,2);
     assert.deepEqual(state.legacy,[]);assert.deepEqual(state.foreign,[]);assert.deepEqual(state.errors,[]);
    }catch(error){
     await page.screenshot({path:'/tmp/blizhniy-admin-work-'+kind+'-failure.png',fullPage:true});
     throw error;
    }finally{state.gate?.resolve();await context.close();}
   });
  }
 }finally{
  await browser?.close();if(app&&app.exitCode===null){process.kill(-app.pid,'SIGTERM');await once(app,'exit');}await rm(directory,{recursive:true});
 }
});
