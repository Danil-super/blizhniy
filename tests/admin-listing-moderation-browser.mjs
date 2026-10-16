import assert from 'node:assert/strict';import {test} from 'node:test';import {spawn} from 'node:child_process';import {once} from 'node:events';
import {createServer} from 'node:net';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {rootCertificates} from 'node:tls';import {randomBytes} from 'node:crypto';import {createRequire} from 'node:module';import {chromium} from 'playwright';import sharp from 'sharp';
import {parseListingFormDraft} from '../src/lib/listing-form-contract.ts';
test('moderator reviews private photos, preserves a rejection reason through session recheck and resolves an unknown decision',{timeout:90000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'blizhniy-moderation-browser-'));let app,browser,page;
 try{
  const key=join(directory,'key'),ca=join(directory,'ca');await writeFile(key,randomBytes(32),{mode:0o600});await writeFile(ca,rootCertificates[0],{mode:0o600});
  const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const origin=`http://127.0.0.1:${port}`,actor='12345678-1234-4321-8765-123456789abc',id='22345678-1234-4321-8765-123456789abc',listing='32345678-1234-4321-8765-123456789abc',image='42345678-1234-4321-8765-123456789abc';
  const env={PATH:process.env.PATH,LANG:'C.UTF-8',NODE_ENV:'production',__NEXT_PROCESSED_ENV:'true',NEXT_TELEMETRY_DISABLED:'1',BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai',
   BLIZHNIY_DB_HOST:'17e86f80f26733d39ef4b84d.twc1.net',BLIZHNIY_DB_PORT:'5432',BLIZHNIY_DB_NAME:'blizhniy_prod',BLIZHNIY_DB_USER:'blizhniy_runtime',BLIZHNIY_DB_PASSWORD:'synthetic-ui-db-password',
   BLIZHNIY_DB_SSL_MODE:'verify-full',BLIZHNIY_DB_CA_FILE:ca,BLIZHNIY_AUTH_MAIL_KEY_FILE:key,BLIZHNIY_AUTH_RATE_SECRET:'synthetic-ui-only-rate-secret-not-used-by-api',BLIZHNIY_MAIL_MODE:'timeweb',
   BLIZHNIY_SMTP_USER:'notifications@ближний-ру.рф',BLIZHNIY_SMTP_PASSWORD:'synthetic-ui-smtp-password',TURNSTILE_SECRET_KEY:'synthetic-ui-captcha-secret',NEXT_PUBLIC_TURNSTILE_SITE_KEY:''};
  app=spawn(process.execPath,['--experimental-strip-types','--require','./tests/listing-form-browser-pg.cjs','node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{env,detached:true,stdio:'ignore'});
  const deadline=Date.now()+20000;for(;;){assert.equal(app.exitCode,null);try{if((await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)})).ok)break;}
   catch(error){assert.ok(error.cause?.code==='ECONNREFUSED'||error.name==='TimeoutError');}assert.ok(Date.now()<deadline);await new Promise(resolve=>setTimeout(resolve,100));}
  browser=await chromium.launch({headless:true});const context=await browser.newContext(),errors=[],foreign=[],writes=[];page=await context.newPage();page.setDefaultTimeout(12000);
  const pixels=await sharp({create:{width:80,height:40,channels:3,background:'red'}}).webp().toBuffer();
  const form=parseListingFormDraft({kind:'prodam',title:'Проверка модератором',description:'Синтетическая форма',categorySlug:'otdyh',subcategoryName:'Турбазы',cityName:'Краснодар',contactPhone:'+79990000000',photoIds:[image]});
  let state='pending',note=null,gate=null,lose=true,active=actor,requestId=id;const snapshot={id:listing,revision:'1',form,photos:[{id:image,mimeType:'image/webp',width:80,height:40,size:pixels.length}]};
  page.on('pageerror',()=>errors.push('pageerror'));
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());if(['http:','https:'].includes(url.protocol)&&url.origin!==origin){foreign.push(url.host);return route.abort();}
   if(url.pathname==='/api/account/session'){if(gate)await gate;return route.fulfill({json:{user:{id:active,email:'fixture@example.invalid',role:active===actor?'admin':'user',isBlocked:false}}});}
   if(!url.pathname.startsWith('/api/'))return route.continue();
   if(url.pathname!=='/api/admin/listing-moderation')return route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});
   const body=request.postDataJSON();assert.equal(request.headers().authorization,undefined);assert.equal(body.expectedAdminId,actor);
   if(body.action==='list')return route.fulfill({json:{items:state==='pending'?[{id:requestId,listingId:listing,revision:snapshot.revision,title:snapshot.form.title}]:[],nextCursor:null}});
   if(body.action==='photo'){assert.equal(body.fileId,image);assert.equal(body.requestId,id);return route.fulfill({contentType:'image/webp',body:pixels});}
   if(request.method()==='PUT'){writes.push(body);state=body.state;note=body.note;if(lose){lose=false;return route.abort();}return route.fulfill({json:{id:requestId,revision:snapshot.revision,state,note}});}
   return route.fulfill({json:{request:{id:requestId,revision:snapshot.revision,state,note},snapshot,check:{listingId:listing,revision:snapshot.revision,checksPassed:true,issues:[],tariff:{id:'listing-standard',name:'Объявление',amount:'199.00',currency:'RUB',durationDays:30}}}});
  });
  await page.goto(origin+'/admin/obyavleniya',{waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Объявления на модерации',exact:true}).waitFor();
  await page.getByRole('button',{name:form.title,exact:true}).click();await page.getByRole('img',{name:'Фотография 1 из 1',exact:true}).waitFor();
  await page.getByLabel('Причина отказа',{exact:true}).fill('Исправьте фотографию');
  let release;gate=new Promise(resolve=>{release=resolve;});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.getByText('Проверяем права. Данные модерации временно скрыты.',{exact:true}).waitFor();assert.equal(await page.getByLabel('Причина отказа',{exact:true}).count(),0);
  release();gate=null;await page.getByLabel('Причина отказа',{exact:true}).waitFor();assert.equal(await page.getByLabel('Причина отказа',{exact:true}).inputValue(),'Исправьте фотографию');
  await page.getByRole('button',{name:'Отклонить с причиной',exact:true}).click();await page.getByText('Результат не подтверждён. Перечитайте запрос перед повторным решением.',{exact:true}).waitFor();
  assert.equal(writes.length,1);assert.equal(await page.getByRole('button',{name:'Одобрить для оплаты',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Сверить решение',exact:true}).click();await page.getByText('Отклонено: Исправьте фотографию',{exact:true}).waitFor();assert.equal(writes.length,1);
  await page.addScriptTag({path:createRequire(import.meta.url).resolve('axe-core/axe.min.js')});
  for(const width of [320,768,1024,1440]){await page.setViewportSize({width,height:900});assert.equal(await page.locator('body').evaluate(node=>node.scrollWidth>innerWidth),false);
   const violations=await page.evaluate(async()=>{const result=await window.axe.run(document.querySelector('section[aria-label="Проверка объявления модератором"]'));return result.violations.filter(item=>['serious','critical'].includes(item.impact)).map(item=>item.id);});assert.deepEqual(violations,[]);
  }
  await page.screenshot({path:'/tmp/blizhniy-moderation-admin-browser.png',fullPage:true});
  requestId='62345678-1234-4321-8765-123456789abc';snapshot.revision='2';snapshot.form={...form,title:'Повторная версия',photoIds:[]};snapshot.photos=[];state='pending';note=null;
  await page.getByRole('button',{name:'Обновить очередь',exact:true}).click();await page.getByRole('button',{name:'Повторная версия',exact:true}).click();
  await page.getByRole('button',{name:'Одобрить для оплаты',exact:true}).click();await page.getByText('Одобрено для оплаты. Объявление ещё не опубликовано.',{exact:true}).waitFor();
  assert.equal(writes.length,2);assert.equal(writes[1].state,'approved');assert.equal(writes[1].note,null);assert.equal(await page.getByRole('button',{name:'Оплатить',exact:true}).count(),0);
  active='52345678-1234-4321-8765-123456789abc';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByText('Доступ администратора не подтверждён.',{exact:true}).waitFor();
  assert.equal(await page.getByText(form.description,{exact:true}).count(),0);assert.deepEqual(errors,[]);assert.deepEqual(foreign,[]);
 }finally{
  await browser?.close();if(app?.pid){const closed=once(app,'exit');try{process.kill(-app.pid,'SIGTERM');}catch(error){assert.equal(error.code,'ESRCH');}await closed;}
  assert.ok(directory.startsWith(join(tmpdir(),'blizhniy-moderation-browser-')));await rm(directory,{recursive:true,force:true});
 }
});
