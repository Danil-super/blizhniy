// Actual production rendering/hydration; owned synthetic SQL and image transports.
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

test('Russian public work catalog and detail render safe fields in HTML/RSC and hydrate without legacy data access',{timeout:90000},async suite=>{
 const directory=await mkdtemp(join(tmpdir(),'blizhniy-public-work-'));let app,browser,output='';
 try{
  const key=join(directory,'key'),ca=join(directory,'ca'),fixture=join(directory,'rows.json');
  await writeFile(key,randomBytes(32),{mode:0o600});await writeFile(ca,rootCertificates[0],{mode:0o600});
  const photo='10000000-0000-4000-8000-000000000003',sentinels=['+79990000000','private-contact@example.invalid','private-person','private-street','55.123456','@private_fixture'];
  const rows=['vacancy','workRequest'].map((kind,index)=>({id:`10000000-0000-4000-8000-00000000000${index+1}`,kind,mediaIds:[photo],
   form:parseWorkPublicationForm(kind,{title:kind==='vacancy'?'Синтетическая публичная вакансия':'Синтетический публичный заказ',description:'Проверка публичного каталога и карточки.',
    cityName:'Краснодар',professionName:'Сантехник',contactPhone:sentinels[0],messengerUrl:sentinels[5],address:sentinels[3],latitude:55.123456,longitude:37.123456,
    showExactAddress:false,placementRightConfirmed:true,photoIds:[photo],...(kind==='vacancy'?{employerType:'person',organization:'Синтетический работодатель',contactPerson:sentinels[2],email:sentinels[1],salary:'1250.50'}:{budget:'1250.50'})}),
   status:'published',paid:true,createdAt:'2026-01-01T00:00:00.123456Z',publishedAt:'2026-01-02T00:00:00.123456Z',expiresAt:'2099-01-01T00:00:00.123456Z'}));
  await writeFile(fixture,JSON.stringify(rows),{mode:0o600});
  const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  const origin=`http://127.0.0.1:${port}`,env={PATH:process.env.PATH,LANG:'C.UTF-8',NODE_ENV:'production',__NEXT_PROCESSED_ENV:'true',NEXT_TELEMETRY_DISABLED:'1',BLIZHNIY_AUTH_MODE:'postgres',
   BLIZHNIY_AUTH_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai',BLIZHNIY_DB_HOST:'17e86f80f26733d39ef4b84d.twc1.net',BLIZHNIY_DB_PORT:'5432',BLIZHNIY_DB_NAME:'blizhniy_prod',BLIZHNIY_DB_USER:'blizhniy_runtime',
   BLIZHNIY_DB_PASSWORD:'synthetic-ui-db-password',BLIZHNIY_DB_SSL_MODE:'verify-full',BLIZHNIY_DB_CA_FILE:ca,BLIZHNIY_AUTH_MAIL_KEY_FILE:key,
   BLIZHNIY_AUTH_RATE_SECRET:'synthetic-ui-only-rate-secret-not-used-by-api',BLIZHNIY_MAIL_MODE:'timeweb',BLIZHNIY_SMTP_USER:'notifications@ближний-ру.рф',
   BLIZHNIY_SMTP_PASSWORD:'synthetic-ui-smtp-password',TURNSTILE_SECRET_KEY:'synthetic-ui-captcha-secret',BLIZHNIY_PUBLIC_WORK_FIXTURE:fixture};
  app=spawn(process.execPath,['--experimental-strip-types','--require','./tests/public-work-browser-pg.cjs','node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{env,detached:true,stdio:['ignore','pipe','pipe']});
  app.stdout.on('data',chunk=>{output=(output+chunk).slice(-16000);});app.stderr.on('data',chunk=>{output=(output+chunk).slice(-16000);});
  const deadline=Date.now()+20000;
  for(;;){
   assert.equal(app.exitCode,null,'owned app is running');let ready=false;
   try{ready=(await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)})).ok;}catch(error){assert.ok(error.cause?.code==='ECONNREFUSED'||error.name==='TimeoutError');}
   if(ready)break;assert.ok(Date.now()<deadline,'owned app starts');await new Promise(resolve=>setTimeout(resolve,100));
  }
  browser=await chromium.launch({headless:true});const context=await browser.newContext(),page=await context.newPage(),foreign=[],legacy=[],errors=[];
  const pixels=await sharp({create:{width:40,height:20,channels:3,background:'blue'}}).webp().toBuffer();
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(['http:','https:'].includes(url.protocol)&&url.origin!==origin){foreign.push(url.host);return route.abort();}
   if(url.pathname==='/api/account/session')return route.fulfill({status:401,json:{error:{code:'UNAUTHENTICATED'}}});
   if(/^\/api\/work-publications\/[a-f0-9-]+\/photos\/[a-f0-9-]+$/.test(url.pathname))return route.fulfill({contentType:'image/webp',body:pixels});
   if(url.pathname.startsWith('/api/')&&url.pathname!=='/api/health'){legacy.push(url.pathname);return route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});}
   return route.continue();
  });
  page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
  for(const row of rows)await suite.test(row.kind+' catalog and public detail use safe current Russian projection',async()=>{
   const catalog=row.kind==='vacancy'?'/rabota/vakansii':'/rabota/zakazy',detail=row.kind==='vacancy'?`/vakansiya/${row.id}`:`/rabota/zakazy/${row.id}`;
   for(const path of [catalog,detail]){
    const response=await page.goto(origin+path);assert.equal(response.status(),200);const html=await response.text();
    for(const sentinel of sentinels)assert.equal(html.includes(sentinel),false,'private field is absent from server HTML/RSC');
    if(path===catalog)await page.locator(`a[href="${detail}"]`).filter({hasText:row.form.title}).first().waitFor();
    else await page.getByRole('heading',{name:row.form.title,exact:true}).waitFor();
    // The existing order index is a text list; vacancy tiles and both details show photos.
    if(path===detail||row.kind==='vacancy'){
     const images=page.locator(`img[src="/api/work-publications/${row.id}/photos/${photo}"]`);await images.first().waitFor();
     await images.first().evaluate(image=>image.decode());assert.ok(await images.first().evaluate(image=>image.naturalWidth>0));
    }
    for(const width of [320,768,1440]){await page.setViewportSize({width,height:900});assert.equal(await page.locator('body').evaluate(node=>node.scrollWidth>innerWidth),false,'public page fits viewport');}
   }
  });
  async function composer(kind='vacancy',options={}){
   const row=rows.find(row=>row.kind===kind),owner='10000000-0000-4000-8000-000000000005',specialist='10000000-0000-4000-8000-000000000006';
   const snapshot={name:'Синтетический специалист',profession:'Сантехник',price:'100.00',skills:'Ремонт',phone:'+79990000001',email:'fixture@example.invalid',messengerUrl:null};
   const state={owner,authOffline:false,lost:false,nullIntent:false,foreignIntent:false,saved:null,writes:[],unexpected:[],errors:[],previewError:false,rejectCreate:false,...options};
   const context=await browser.newContext({viewport:{width:320,height:1000}}),page=await context.newPage();page.setDefaultTimeout(5000);page.on('pageerror',error=>state.errors.push(error.message));
   await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());if(url.origin!==origin){state.unexpected.push(url.host);return route.abort();}
    if(url.pathname==='/api/account/session')return route.fulfill(state.authOffline?{status:503,json:{error:{code:'AUTH_UNAVAILABLE'}}}:!state.owner?{status:401,json:{error:{code:'UNAUTHENTICATED'}}}:{json:{user:{id:state.owner,email:'fixture@example.invalid',role:'user',isBlocked:false}}});
    if(url.pathname===`/api/work-publications/${row.id}/photos/${photo}`)return route.fulfill({contentType:'image/webp',body:pixels});
    if(url.pathname==='/api/account/applications'){
     const body=request.postDataJSON();assert.equal(body.expectedOwnerId,state.owner);assert.equal(request.headers().authorization,undefined);
     if(body.action==='preview')return route.fulfill(state.previewError?{status:409,json:{error:{code:'SPECIALIST_REQUIRED'}}}:{json:{target:{id:row.id,kind,title:row.form.title,revision:'9007199254740993'},specialist:{id:specialist,revision:'2',snapshot},existing:state.saved}});
     if(body.action==='intent')return route.fulfill({json:state.nullIntent?null:state.foreignIntent?{...state.saved,message:'Не исходное сообщение'}:state.saved});
     assert.equal(body.action,'create');assert.equal(request.method(),'PUT');state.writes.push(body.input);
     if(state.rejectCreate)return route.fulfill({status:409,json:{error:{code:'APPLICATION_CHANGED'}}});
     state.saved??={id:'10000000-0000-4000-8000-000000000007',revision:'1',view:'applicant',target:{id:row.id,kind,title:row.form.title},specialistId:specialist,snapshot,message:body.input.message,status:'pending_payment',paid:false,sentAt:null,createdAt:'2026-10-19T00:00:00.123456Z',updatedAt:'2026-10-19T00:00:00.123456Z'};
     if(state.lost){state.lost=false;return route.abort('failed');}return route.fulfill({json:state.saved});
    }
    if(url.pathname.startsWith('/api/')){state.unexpected.push(url.pathname);return route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});}return route.continue();
   });
   await page.goto(origin+(kind==='vacancy'?`/vakansiya/${row.id}`:`/rabota/zakazy/${row.id}`));
   const panel=page.getByRole('region',{name:'Отклик на публикацию',exact:true});await (state.previewError?panel.getByRole('link',{name:'Заполнить анкету',exact:true}):panel.getByLabel('Сообщение',{exact:true})).waitFor();return{context,page,panel,state};
  }
  for(const kind of ['vacancy','workRequest'])await suite.test(kind+' primary public action saves reviewed server snapshot and truthfully distinguishes payment from delivery',async()=>{
   const {context,page,panel,state}=await composer(kind);try{
    await panel.getByLabel('Сообщение',{exact:true}).fill('Могу помочь с ремонтом');
    if(kind==='vacancy'){await panel.getByLabel('Сообщение',{exact:true}).press('Tab');await page.keyboard.press('Enter');}
    else await panel.getByRole('button',{name:'Сохранить отклик',exact:true}).click();
    await panel.getByText('Отклик сохранён. Ожидает оплаты.',{exact:true}).waitFor();assert.equal(state.writes.length,1);assert.equal(state.writes[0].expectedTargetRevision,'9007199254740993');assert.equal(state.writes[0].expectedSpecialistRevision,'2');assert.equal(Object.hasOwn(state.writes[0],'snapshot'),false);assert.equal(Object.hasOwn(state.writes[0],'paid'),false);
    assert.equal(await panel.getByRole('link',{name:'Мои отклики',exact:true}).getAttribute('href'),'/cabinet/otkliki');assert.deepEqual(state.unexpected,[]);assert.deepEqual(state.errors,[]);
    await page.reload();await panel.getByText('Отклик сохранён. Ожидает оплаты.',{exact:true}).waitFor();assert.equal(await panel.getByLabel('Сообщение',{exact:true}).count(),0);assert.equal(state.writes.length,1);assert.deepEqual(state.unexpected,[]);assert.deepEqual(state.errors,[]);
   }finally{await context.close();}
  });
  await suite.test('lost application write locks message; foreign readback is rejected and null recovery replays only the same intent',async()=>{
   const {context,panel,state}=await composer();try{
    await panel.getByLabel('Сообщение',{exact:true}).fill('Мой исходный текст');state.lost=true;await panel.getByRole('button',{name:'Сохранить отклик',exact:true}).click();await panel.getByRole('button',{name:'Проверить сохранение',exact:true}).waitFor();
    assert.equal(await panel.getByLabel('Сообщение',{exact:true}).isDisabled(),true);
    state.foreignIntent=true;await panel.getByRole('button',{name:'Проверить сохранение',exact:true}).click();await panel.getByRole('alert').waitFor();assert.equal(await panel.getByText('Отклик сохранён. Ожидает оплаты.',{exact:true}).count(),0);
    state.foreignIntent=false;state.nullIntent=true;await panel.getByRole('button',{name:'Проверить сохранение',exact:true}).click();await panel.getByRole('button',{name:'Повторить то же сохранение',exact:true}).click();await panel.getByText('Отклик сохранён. Ожидает оплаты.',{exact:true}).waitFor();assert.equal(state.writes.length,2);assert.deepEqual(state.writes[0],state.writes[1]);assert.deepEqual(state.unexpected,[]);assert.deepEqual(state.errors,[]);
   }finally{await context.close();}
  });
  await suite.test('same-account auth outage keeps message hidden and intact; changing account or logging out destroys it',async()=>{
   const {context,page,panel,state}=await composer();try{
    await panel.getByLabel('Сообщение',{exact:true}).fill('Сохранить при сбое');state.authOffline=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await panel.getByText('Проверяем доступ. Сообщение временно скрыто.',{exact:true}).waitFor();assert.equal(await panel.getByLabel('Сообщение',{exact:true}).isVisible(),false);
    state.authOffline=false;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await panel.getByLabel('Сообщение',{exact:true}).waitFor();assert.equal(await panel.getByLabel('Сообщение',{exact:true}).inputValue(),'Сохранить при сбое');
    await page.addScriptTag({path:createRequire(import.meta.url).resolve('axe-core/axe.min.js')});
    for(const width of [320,768,1024,1440]){await page.setViewportSize({width,height:1000});assert.equal(await page.locator('body').evaluate(node=>node.scrollWidth>innerWidth),false);
     assert.deepEqual(await panel.evaluate(async node=>(await window.axe.run(node,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.filter(item=>['serious','critical'].includes(item.impact)).map(item=>item.id)),[]);
     if(process.env.BLIZHNIY_APPLICATION_VISUAL_REVIEW==='1'&&[320,1440].includes(width)){const review=await mkdtemp(join(tmpdir(),'blizhniy-application-review-'));await panel.screenshot({path:join(review,width+'.png')});console.info('Synthetic application form visual review: '+join(review,width+'.png'));}
    }
    state.owner='10000000-0000-4000-8000-000000000008';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await panel.getByLabel('Сообщение',{exact:true}).waitFor();assert.equal(await panel.getByLabel('Сообщение',{exact:true}).inputValue(),'');
    state.owner=null;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await panel.getByRole('link',{name:'Войти и откликнуться',exact:true}).waitFor();assert.equal(await panel.getByLabel('Сообщение',{exact:true}).count(),0);assert.deepEqual(state.unexpected,[]);assert.deepEqual(state.errors,[]);
   }finally{await context.close();}
  });
  await suite.test('message validation focuses its field; a definite stale revision preserves text and requires refresh without automatic write retry',async()=>{
   const {context,panel,state}=await composer();try{
    await panel.getByLabel('Сообщение',{exact:true}).fill('x'.repeat(3001));await panel.getByRole('button',{name:'Сохранить отклик',exact:true}).click();await panel.getByText('Сообщение должно содержать не более 3000 символов, без управляющих знаков.',{exact:true}).waitFor();assert.equal(state.writes.length,0);assert.equal(await panel.getByLabel('Сообщение',{exact:true}).evaluate(node=>node===document.activeElement),true);
    await panel.getByLabel('Сообщение',{exact:true}).fill('Не терять этот текст');state.rejectCreate=true;await panel.getByRole('button',{name:'Сохранить отклик',exact:true}).click();await panel.getByRole('button',{name:'Обновить данные отклика',exact:true}).waitFor();assert.equal(await panel.getByRole('button',{name:'Сохранить отклик',exact:true}).isDisabled(),true);assert.equal(await panel.getByLabel('Сообщение',{exact:true}).inputValue(),'Не терять этот текст');assert.equal(state.writes.length,1);
    state.rejectCreate=false;await panel.getByRole('button',{name:'Обновить данные отклика',exact:true}).click();await panel.getByRole('button',{name:'Сохранить отклик',exact:true}).click();await panel.getByText('Отклик сохранён. Ожидает оплаты.',{exact:true}).waitFor();assert.equal(state.writes.length,2);assert.notEqual(state.writes[0].creationKey,state.writes[1].creationKey);assert.deepEqual(state.unexpected,[]);assert.deepEqual(state.errors,[]);
   }finally{await context.close();}
  });
  await suite.test('missing specialist is an explicit recoverable prerequisite rather than a silent empty form',async()=>{
   const {context,panel,state}=await composer('vacancy',{previewError:true});try{
    assert.equal(await panel.getByRole('link',{name:'Заполнить анкету',exact:true}).getAttribute('href'),'/cabinet/specialist');assert.equal(await panel.getByLabel('Сообщение',{exact:true}).count(),0);state.previewError=false;
    await panel.getByRole('button',{name:'Обновить данные отклика',exact:true}).click();await panel.getByLabel('Сообщение',{exact:true}).waitFor();assert.equal(state.writes.length,0);assert.deepEqual(state.unexpected,[]);assert.deepEqual(state.errors,[]);
   }finally{await context.close();}
  });
  await suite.test('expired publication disappears from both catalog and direct detail without fallback',async()=>{
   await writeFile(fixture,JSON.stringify(rows.map(row=>({...row,expiresAt:'2000-01-01T00:00:00.000001Z'}))),{mode:0o600});
   for(const row of rows){
    const catalog=row.kind==='vacancy'?'/rabota/vakansii':'/rabota/zakazy',detail=row.kind==='vacancy'?`/vakansiya/${row.id}`:`/rabota/zakazy/${row.id}`;
    assert.equal((await page.goto(origin+catalog)).status(),200);assert.equal(await page.getByRole('heading',{name:row.form.title,exact:true}).count(),0);
    assert.equal((await page.goto(origin+detail)).status(),404);
   }
  });
  assert.deepEqual(foreign,[]);assert.deepEqual(legacy,[]);assert.deepEqual(errors,[]);assert.equal(output.includes('Unexpected browser fixture query'),false);
  await context.close();
 }finally{
  await browser?.close();if(app?.exitCode===null){process.kill(-app.pid,'SIGTERM');await once(app,'exit');}
  await rm(directory,{recursive:true,force:true});
 }
});
