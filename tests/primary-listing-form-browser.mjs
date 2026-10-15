// Real built placement form; only provider/SQL transports are owned synthetic fixtures.
import assert from 'node:assert/strict';import {test} from 'node:test';import {spawn} from 'node:child_process';
import {once} from 'node:events';import {createServer} from 'node:net';import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {rootCertificates} from 'node:tls';import {randomBytes} from 'node:crypto';
import {chromium} from 'playwright';import sharp from 'sharp';
import {parseListingFormDraft} from '../src/lib/listing-form-contract.ts';
test('ordinary placement form saves all existing fields/photos with cookie API and preserves input through account rechecks', {timeout:90000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'blizhniy-form-browser-'));let app,browser;
 try{
  const key=join(directory,'key'),ca=join(directory,'ca');await writeFile(key,randomBytes(32),{mode:0o600});await writeFile(ca,rootCertificates[0],{mode:0o600});
  const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const origin=`http://127.0.0.1:${port}`,owner='12345678-1234-4321-8765-123456789abc',id='22345678-1234-4321-8765-123456789abc';
  const env={PATH:process.env.PATH,LANG:'C.UTF-8',NODE_ENV:'production',__NEXT_PROCESSED_ENV:'true',NEXT_TELEMETRY_DISABLED:'1',BLIZHNIY_AUTH_MODE:'postgres',
   BLIZHNIY_AUTH_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai',BLIZHNIY_DB_HOST:'17e86f80f26733d39ef4b84d.twc1.net',BLIZHNIY_DB_PORT:'5432',BLIZHNIY_DB_NAME:'blizhniy_prod',BLIZHNIY_DB_USER:'blizhniy_runtime',
   BLIZHNIY_DB_PASSWORD:'synthetic-ui-db-password',BLIZHNIY_DB_SSL_MODE:'verify-full',BLIZHNIY_DB_CA_FILE:ca,BLIZHNIY_AUTH_MAIL_KEY_FILE:key,BLIZHNIY_AUTH_RATE_SECRET:'synthetic-ui-only-rate-secret-not-used-by-api',
   BLIZHNIY_MAIL_MODE:'timeweb',BLIZHNIY_SMTP_USER:'notifications@ближний-ру.рф',BLIZHNIY_SMTP_PASSWORD:'synthetic-ui-smtp-password',TURNSTILE_SECRET_KEY:'synthetic-ui-captcha-secret',NEXT_PUBLIC_TURNSTILE_SITE_KEY:''};
  let output='';app=spawn(process.execPath,['--experimental-strip-types','--require','./tests/listing-form-browser-pg.cjs','node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{env,detached:true,stdio:['ignore','pipe','pipe']});
  app.stdout.on('data',chunk=>{output=(output+chunk).slice(-16000);});app.stderr.on('data',chunk=>{output=(output+chunk).slice(-16000);});
  const deadline=Date.now()+20000;for(;;){assert.equal(app.exitCode,null);try{if((await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)})).ok)break;}
   catch(error){assert.ok(error.cause?.code==='ECONNREFUSED'||error.name==='TimeoutError');}assert.ok(Date.now()<deadline,'owned app starts');await new Promise(resolve=>setTimeout(resolve,100));}
  browser=await chromium.launch({headless:true});const context=await browser.newContext(),page=await context.newPage(),errors=[],foreign=[],writes=[],intents=[];
  page.setDefaultTimeout(12000);page.on('pageerror',()=>errors.push('pageerror'));let saved=null,lose=false,sessionGate=null,active=owner;
  const pixels=await sharp({create:{width:80,height:40,channels:3,background:'red'}}).png().toBuffer();
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());if(['http:','https:'].includes(url.protocol)&&url.origin!==origin){foreign.push(url.host);return route.abort();}
   if(!url.pathname.startsWith('/api/account/'))return route.continue();
   assert.equal(request.headers().authorization,undefined);
   if(url.pathname.endsWith('/session')){if(sessionGate)await sessionGate;return route.fulfill({json:{user:{id:active,email:'fixture@example.invalid',role:'user',isBlocked:false}}});}
   if(url.pathname==='/api/account/media'){const mediaId=request.headers()['x-blizhniy-intent'];intents.push(mediaId);return route.fulfill({json:{id:mediaId,mimeType:'image/webp',width:80,height:40,size:12}});}
   const body=request.postDataJSON();assert.equal(body.expectedOwnerId,owner);
   if(url.pathname.endsWith('/collection'))return route.fulfill({json:{id,revision:'1',draft:{kind:'prodam',title:'',description:'',price:null,categoryId:null,cityId:null}}});
   if(url.pathname==='/api/account/listing-form'){
    if(request.method()==='POST')return route.fulfill({json:saved});
    writes.push(body);saved={id,revision:'2',form:parseListingFormDraft(body.form),photos:body.form.photoIds.map(id=>({id,mimeType:'image/webp',width:80,height:40,size:12}))};
    if(lose){lose=false;return route.abort();}return route.fulfill({json:saved});
   }
   return route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});
  });
  const response=await page.goto(origin+'/razmestit/obyavlenie',{waitUntil:'domcontentloaded'});assert.equal(response.status(),200,output);
  await page.getByRole('heading',{name:'Создать объявление',exact:true}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'Создать объявление',exact:true}).count(),1);
  await page.locator('input[name="title"]').fill('Полная форма');await page.locator('textarea[name="description"]').fill('Не потерять описание');await page.locator('input[name="price"]').fill('1234');
  await page.getByRole('button',{name:'Выбрать',exact:true}).click();await page.getByRole('option',{name:'Краснодар, Краснодарский край',exact:true}).click();
  await page.locator('input[name="phone"]').fill('+79990000000');await page.locator('input[name="messengerUrl"]').fill('@example_user');
  await page.locator('input[name="photos"]').setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:pixels});
  let release;sessionGate=new Promise(resolve=>{release=resolve;});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.getByText('Проверяем вход. Заполненная форма скрыта до подтверждения аккаунта.',{exact:true}).waitFor();
  assert.equal(await page.locator('input[name="title"]').isVisible(),false);release();sessionGate=null;
  await page.locator('input[name="title"]').waitFor();assert.equal(await page.locator('input[name="title"]').inputValue(),'Полная форма');
  assert.equal(await page.locator('input[name="photos"]').evaluate(input=>input.files.length),1);
  await page.locator('input[name="placementRightsAccepted"]').check();lose=true;
  await page.getByRole('button',{name:'Сохранить черновик',exact:true}).click();
  await page.getByRole('button',{name:'Проверить сохранённую форму',exact:true}).waitFor();assert.equal(writes.length,1);assert.equal(intents.length,1);
  assert.equal(writes[0].form.title,'Полная форма');assert.equal(writes[0].form.cityName,'Краснодар');assert.equal(writes[0].form.price,'1234.00');assert.equal(writes[0].form.contactPhone,'+7-(999)-000-00-00');
  assert.ok(writes[0].form.subcategoryName);assert.equal(writes[0].form.messengerUrl,'https://t.me/example_user');assert.equal(writes[0].form.photoIds.length,1);
  // Keep the test on the form so all source fields and error-state layout remain inspectable.
  for(const width of [320,768,1024,1440]){await page.setViewportSize({width,height:900});assert.equal(await page.locator('body').evaluate(node=>node.scrollWidth>innerWidth),false);}
  await page.screenshot({path:'/tmp/blizhniy-full-form-browser.png',fullPage:true});
  await page.getByRole('button',{name:'Проверить сохранённую форму',exact:true}).click();await page.waitForURL(origin+'/cabinet/obyavleniya');
  assert.equal(writes.length,1);assert.equal(intents.length,1);assert.deepEqual(errors,[]);assert.deepEqual(foreign,[]);
  await page.goto(origin+'/razmestit/obyavlenie');await page.locator('input[name="title"]').fill('Буфер предыдущего владельца');
  active='32345678-1234-4321-8765-123456789abc';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(()=>document.querySelector('input[name="title"]')?.value==='');
  assert.equal(await page.locator('input[name="photos"]').evaluate(input=>input.files.length),0);
  assert.equal(await page.getByText('Буфер предыдущего владельца',{exact:true}).count(),0);
 }finally{await browser?.close();if(app&&app.exitCode===null){process.kill(-app.pid,'SIGTERM');await once(app,'exit');}await rm(directory,{recursive:true});}
});
