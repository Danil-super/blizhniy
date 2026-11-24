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
import {chromium} from 'playwright';
import {parseServicePublicationForm} from '../src/lib/service-publication-contract.ts';
import {createDefaultCabinetProfile} from '../src/lib/cabinet-profile.ts';

const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
const stamp='2026-11-25T09:00:00.000000Z',formPath='/reklama/begushchaya-stroka',listPath=formPath+'?view=list';
const title='Синтетический черновик рекламной строки';

test('marquee draft can be saved and removed in the cabinet once checkout clears',{timeout:45000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'blizhniy-marquee-removal-'));
 let app,browser;
 try{
  const key=join(directory,'key'),ca=join(directory,'ca');
  await writeFile(key,randomBytes(32),{mode:0o600});await writeFile(ca,rootCertificates[0],{mode:0o600});
  const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');
  const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const origin=`http://127.0.0.1:${port}`;
  const env={PATH:process.env.PATH,LANG:'C.UTF-8',NODE_ENV:'production',__NEXT_PROCESSED_ENV:'true',NEXT_TELEMETRY_DISABLED:'1',
   BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai',BLIZHNIY_DRAFT_REMOVALS:'enabled',
   BLIZHNIY_DB_HOST:'17e86f80f26733d39ef4b84d.twc1.net',BLIZHNIY_DB_PORT:'5432',BLIZHNIY_DB_NAME:'blizhniy_prod',BLIZHNIY_DB_USER:'blizhniy_runtime',
   BLIZHNIY_DB_PASSWORD:'synthetic-ui-db-password',BLIZHNIY_DB_SSL_MODE:'verify-full',BLIZHNIY_DB_CA_FILE:ca,BLIZHNIY_AUTH_MAIL_KEY_FILE:key,
   BLIZHNIY_AUTH_RATE_SECRET:'synthetic-ui-only-rate-secret-not-used-by-api',BLIZHNIY_MAIL_MODE:'timeweb',BLIZHNIY_SMTP_USER:'notifications@ближний-ру.рф',
   BLIZHNIY_SMTP_PASSWORD:'synthetic-ui-smtp-password',TURNSTILE_SECRET_KEY:'synthetic-ui-captcha-secret'};
  app=spawn(process.execPath,['--experimental-strip-types','--require','./tests/listing-form-browser-pg.cjs','node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],
   {env,detached:true,stdio:['ignore','ignore','ignore']});
  const deadline=Date.now()+20000;
  for(;;){
   assert.equal(app.exitCode,null);
   try{if((await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)})).ok)break;}
   catch(error){assert.ok(error.cause?.code==='ECONNREFUSED'||error.name==='TimeoutError');}
   assert.ok(Date.now()<deadline,'isolated application starts');
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage(),unexpected=[],errors=[],removals=[];
  let row=null,activeCheckout=true,writes=0;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin!==origin){unexpected.push(url.host);return route.abort();}
   if(!url.pathname.startsWith('/api/'))return route.continue();
   if(url.pathname==='/api/account/session')return route.fulfill({json:{user:{id:owner,email:'fixture@example.invalid',role:'user',isBlocked:false}}});
   if(url.pathname==='/api/account/profile')return route.fulfill({json:{exists:false,revision:null,profile:createDefaultCabinetProfile({email:'fixture@example.invalid'})}});
   if(url.pathname==='/api/account/service-publications'){
    const body=request.postDataJSON();assert.equal(body.expectedOwnerId,owner);
    if(body.action==='list'){
     const item={id,kind:body.kind,title,revision:'1',status:'draft',paid:false,updatedAt:stamp};
     return route.fulfill({json:{items:body.kind==='fair'||row?[item]:[],nextCursor:null}});
    }
    assert.equal(body.kind,'marquee');
    if(body.action==='read')return row?route.fulfill({json:row}):route.fulfill({status:404,json:{error:{code:'PUBLICATION_NOT_FOUND'}}});
    assert.equal(body.action,'create');writes++;
    row={id,kind:'marquee',form:parseServicePublicationForm('marquee',body.form),photos:[],revision:'1',status:'draft',paid:false,
     createdAt:stamp,updatedAt:stamp,publishedAt:null,expiresAt:null};
    return route.fulfill({json:row});
   }
   if(url.pathname==='/api/account/listing-removal'){
    assert.equal(request.method(),'POST');assert.equal(request.headers()['x-blizhniy-request'],'1');
    const body=request.postDataJSON();
    assert.deepEqual(body,{action:'remove',target:'marquee',expectedOwnerId:owner,listingId:id,expectedRevision:'1'});
    removals.push(body);
    if(activeCheckout)return route.fulfill({status:409,json:{error:{code:'CHECKOUT_ACTIVE'}}});
    row=null;return route.fulfill({json:{id,revision:'1',removed:true}});
   }
   if(url.pathname==='/api/account/service-moderation')return route.fulfill({json:{id:null,revision:null,state:'not_submitted',note:null}});
   unexpected.push(url.pathname);return route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});
  });
  page.setDefaultTimeout(7000);
  await page.goto(origin+formPath);
  const form=page.getByRole('form',{name:'Рекламный текст',exact:true});
  await form.locator('input[name="title"]').fill(title);
  await form.getByRole('button',{name:'Сохранить черновик',exact:true}).click();
  await page.waitForURL(origin+listPath);
  assert.equal(row.form.title,title);
  await page.getByRole('link',{name:'Редактировать',exact:true}).click();
  assert.equal(await form.locator('input[name="title"]').inputValue(),title);
  await page.goto(origin+listPath);
  page.on('dialog',dialog=>dialog.accept());
  const remove=page.getByRole('button',{name:'Удалить черновик',exact:true});
  await remove.click();
  await page.getByRole('alert').filter({hasText:'Сначала проверьте начатую оплату'}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Проверить оплату',exact:true}).getAttribute('href'),
   `/cabinet/oplata-uslugi?type=marquee&id=${id}&revision=1`);
  assert.equal(removals.length,1);
  activeCheckout=false;
  await remove.click();
  await page.getByText('Материалов пока нет.',{exact:true}).waitFor();
  assert.equal(removals.length,2);assert.equal(writes,1);
  await page.goto(origin+formPath+'?draft='+id);
  await page.getByText('Материал недоступен.',{exact:true}).waitFor();
  assert.equal(await form.count(),0);
  await page.goto(origin+'/cabinet/fair-applications');
  await page.getByRole('heading',{name:title,exact:true}).waitFor();
  assert.equal(await remove.count(),0);
  assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
 }finally{
  await browser?.close();
  if(app?.exitCode===null){process.kill(-app.pid,'SIGTERM');await once(app,'exit');}
  await rm(directory,{recursive:true,force:true});
 }
});
