// Production HTML/RSC/hydration with owned synthetic SQL/image/interaction transports, not a production lifecycle proof.
import assert from 'node:assert/strict';import {test} from 'node:test';import {spawn} from 'node:child_process';import {once} from 'node:events';import {createServer} from 'node:net';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {rootCertificates} from 'node:tls';import {randomBytes} from 'node:crypto';import {chromium} from 'playwright';import sharp from 'sharp';
import {request as httpRequest} from 'node:http';
import {parseListingFormDraft} from '../src/lib/listing-form-contract.ts';
test('ordinary Russian public pages render the primary DTO without hidden/private fields or legacy requests',{timeout:90000},async suite=>{
 const directory=await mkdtemp(join(tmpdir(),'blizhniy-public-listing-'));let app,browser,output='';
 try{
  const key=join(directory,'key'),ca=join(directory,'ca'),fixture=join(directory,'rows.json'),photo='10000000-0000-4000-8000-000000000008',owner='10000000-0000-4000-8000-000000000009';
  await writeFile(key,randomBytes(32),{mode:0o600});await writeFile(ca,rootCertificates[0],{mode:0o600});
  const rows=['prodam','kuplyu','otdam-darom','arenda'].map((kind,index)=>({id:`10000000-0000-4000-8000-00000000000${index+1}`,ownerId:owner,revision:'9007199254740993',approvedRevision:'9007199254740993',authorName:'Синтетический продавец',mediaIds:[photo],isSubcategory:false,
   form:parseListingFormDraft({kind,title:`Синтетическое объявление ${index+1}`,description:'Подробное описание публичной синтетической карточки.',categorySlug:'posuda',cityName:'Краснодар',price:'1234.50',contactPhone:'+79990000000',
    address:'PRIVATE_HIDDEN_STREET',latitude:55.123456,longitude:37.123456,showExactAddress:false,photoIds:[photo],...(kind==='arenda'?{booking:{mode:'stay',priceWeekday:100,priceWeekend:150,minNights:1,includedGuests:2,maxGuests:4}}:{})}),
   status:'published',paid:true,viewCount:2,createdAt:'2026-01-01T00:00:00.123456Z',publishedAt:'2026-01-02T00:00:00.123456Z',expiresAt:'2099-01-01T00:00:00.123456Z'}));
  await writeFile(fixture,JSON.stringify(rows),{mode:0o600});const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));const origin=`http://127.0.0.1:${port}`;
  const env={PATH:process.env.PATH,LANG:'C.UTF-8',NODE_ENV:'production',__NEXT_PROCESSED_ENV:'true',NEXT_TELEMETRY_DISABLED:'1',BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai',
   BLIZHNIY_DB_HOST:'17e86f80f26733d39ef4b84d.twc1.net',BLIZHNIY_DB_PORT:'5432',BLIZHNIY_DB_NAME:'blizhniy_prod',BLIZHNIY_DB_USER:'blizhniy_runtime',BLIZHNIY_DB_PASSWORD:'synthetic-ui-db-password',BLIZHNIY_DB_SSL_MODE:'verify-full',BLIZHNIY_DB_CA_FILE:ca,
   BLIZHNIY_AUTH_MAIL_KEY_FILE:key,BLIZHNIY_AUTH_RATE_SECRET:'synthetic-ui-only-rate-secret-not-used-by-api',BLIZHNIY_MAIL_MODE:'timeweb',BLIZHNIY_SMTP_USER:'notifications@ближний-ру.рф',BLIZHNIY_SMTP_PASSWORD:'synthetic-ui-smtp-password',TURNSTILE_SECRET_KEY:'synthetic-ui-captcha-secret',BLIZHNIY_PUBLIC_LISTING_FIXTURE:fixture};
  app=spawn(process.execPath,['--experimental-strip-types','--require','./tests/public-listing-browser-pg.cjs','node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{env,detached:true,stdio:['ignore','pipe','pipe']});
  app.stdout.on('data',chunk=>{output=(output+chunk).slice(-16000);});app.stderr.on('data',chunk=>{output=(output+chunk).slice(-16000);});const deadline=Date.now()+20000;
  for(;;){assert.equal(app.exitCode,null);let ready=false;try{ready=(await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)})).ok;}catch(error){assert.ok(error.cause?.code==='ECONNREFUSED'||error.name==='TimeoutError');}if(ready)break;assert.ok(Date.now()<deadline);await new Promise(resolve=>setTimeout(resolve,100));}
  browser=await chromium.launch({headless:true});const context=await browser.newContext(),page=await context.newPage(),foreign=[],legacy=[],errors=[];page.setDefaultTimeout(10000);
  const pixels=await sharp({create:{width:40,height:20,channels:3,background:'blue'}}).webp().toBuffer();
  await context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(['http:','https:'].includes(url.protocol)&&url.origin!==origin){foreign.push(url.host);return route.abort();}
   if(url.pathname==='/api/account/session')return route.fulfill({status:401,json:{error:{code:'UNAUTHENTICATED'}}});
   if(/^\/api\/listings\/[a-f0-9-]+\/photos\/[a-f0-9-]+$/.test(url.pathname))return route.fulfill({contentType:'image/webp',body:pixels});
   // View counting remains a separate migration; anonymous cards must not call booking operations.
   if(/^\/api\/listings\/[a-f0-9-]+\/views$/.test(url.pathname))return route.fulfill({json:{views:2}});
   if(url.pathname.startsWith('/api/')&&url.pathname!=='/api/health'){legacy.push(url.pathname);return route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});}return route.continue();
  });
  page.on('pageerror',error=>errors.push(error.message));page.on('console',event=>{if(['warning','error'].includes(event.type())&&!event.text().startsWith('Failed to load resource:'))errors.push(event.text());});
  for(const row of rows)await suite.test(row.form.kind+' public detail preserves title, seller, price and local image without a hidden map point',async()=>{
   const response=await page.goto(`${origin}/obyavlenie/${row.id}`);assert.equal(response.status(),200);const html=await response.text();for(const sentinel of ['PRIVATE_HIDDEN_STREET','55.123456','37.123456'])assert.equal(html.includes(sentinel),false);
   await page.getByRole('heading',{name:row.form.title,exact:true}).waitFor();await page.getByText('Синтетический продавец',{exact:true}).first().waitFor();
   const image=page.locator(`img[src="/api/listings/${row.id}/photos/${photo}"]`).first();await image.waitFor();await image.evaluate(node=>node.decode());assert.ok(await image.evaluate(node=>node.naturalWidth>0));
   for(const width of [320,768,1440]){await page.setViewportSize({width,height:1000});assert.equal(await page.locator('body').evaluate(node=>node.scrollWidth>innerWidth),false);}
   if(process.env.BLIZHNIY_PUBLIC_LISTING_VISUAL_REVIEW==='1'&&row.form.kind==='prodam'){const review=await mkdtemp(join(tmpdir(),'blizhniy-public-listing-review-'));await page.screenshot({path:join(review,'detail.png'),fullPage:true});console.info('Synthetic public listing visual review: '+join(review,'detail.png'));}
  });
  await suite.test('listing feed, category, search and seller consume primary rows; expired items disappear from direct detail and catalog without fallback',async()=>{
   // The unchanged home is a category landing page; the public feed lives at /obyavleniya.
   for(const path of ['/obyavleniya','/katalog/posuda','/poisk?q='+encodeURIComponent(rows[0].form.title),'/prodavets/'+owner]){const response=await page.goto(origin+path);assert.equal(response.status(),200);assert.ok((await response.text()).includes(rows[0].form.title),path+' has primary listing in server HTML');await page.getByText(rows[0].form.title,{exact:true}).first().waitFor();}
   await writeFile(fixture,JSON.stringify(rows.map(row=>({...row,expiresAt:'2000-01-01T00:00:00.000001Z'}))),{mode:0o600});
   assert.equal((await page.goto(origin+'/katalog/posuda')).status(),200);assert.equal(await page.getByText(rows[0].form.title,{exact:true}).count(),0);
   assert.equal((await page.goto(origin+'/obyavlenie/'+rows[0].id)).status(),404);
  });
  await suite.test('compiled ordinary photo route rejects unavailable associations and query strings at the real trusted ingress',async()=>{
   const path=`/api/listings/${rows[0].id}/photos/${photo}`,headers={Host:'xn----9sbphbgks4a4a.xn--p1ai','X-Real-IP':'192.0.2.5'};
   const get=path=>new Promise((resolve,reject)=>{const outgoing=httpRequest(origin+path,{headers},incoming=>{let body='';incoming.setEncoding('utf8');incoming.on('data',chunk=>{body+=chunk;if(body.length>8192)incoming.destroy(Error('Owned response exceeded cap'));});incoming.on('error',reject);incoming.on('end',()=>resolve(new Response(body,{status:incoming.statusCode,headers:incoming.headers})));});outgoing.setTimeout(5000,()=>outgoing.destroy(Error('Owned ingress timed out')));outgoing.on('error',reject);outgoing.end();});
   const denied=await get(path);assert.equal(denied.status,404);assert.deepEqual(await denied.json(),{error:{code:'MEDIA_NOT_FOUND'}});assert.equal(denied.headers.get('cache-control'),'no-store');assert.equal((await get(path+'?unexpected=1')).status,400);
  });
  assert.deepEqual(foreign,[]);assert.deepEqual(legacy,[]);assert.deepEqual(errors,[]);assert.equal(output.includes('Unexpected browser fixture query'),false);await context.close();
 }finally{await browser?.close();if(app?.exitCode===null){process.kill(-app.pid,'SIGTERM');await once(app,'exit');}await rm(directory,{recursive:true,force:true});}
});
