import assert from 'node:assert/strict';import {test} from 'node:test';import {spawn} from 'node:child_process';import {once} from 'node:events';import {createServer} from 'node:net';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {rootCertificates} from 'node:tls';import {randomBytes} from 'node:crypto';import {createRequire} from 'node:module';import {chromium} from 'playwright';
import {createDefaultCabinetProfile} from '../src/lib/cabinet-profile.ts';
const owner='10000000-0000-4000-8000-000000000001',id='10000000-0000-4000-8000-000000000002',listingId='10000000-0000-4000-8000-000000000003',stamp='2026-10-19T12:00:00.123456Z';
const booking={mode:'stay',priceWeekday:100,priceWeekend:100,minNights:1,includedGuests:2,maxGuests:4,extraGuestPrice:0,rules:'Синтетические условия проживания'};
const original={id,revision:'9007199254740993',view:'host',listing:{id:listingId,title:'Синтетическое жильё'},mode:'stay',startDate:'2026-10-20',endDate:'2026-10-22',guests:2,total:'200.00',status:'pending',booking,createdAt:stamp,updatedAt:stamp,decidedAt:null};
const summary=({booking,updatedAt,decidedAt,lifecycle,...value})=>{assert.ok(booking);void lifecycle;assert.ok(updatedAt);assert.ok(decidedAt===null||typeof decidedAt==='string');return value;};
test('booking lifecycle cancellation: browser reason, unknown outcome, expiry and responsive accessibility',{timeout:90000},async suite=>{
 const directory=await mkdtemp(join(tmpdir(),'blizhniy-bookings-browser-'));let app,browser,output='';
 try{
  const key=join(directory,'key'),ca=join(directory,'ca');await writeFile(key,randomBytes(32),{mode:0o600});await writeFile(ca,rootCertificates[0],{mode:0o600});
  const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));const origin=`http://127.0.0.1:${port}`;
  const env={PATH:process.env.PATH,LANG:'C.UTF-8',NODE_ENV:'production',__NEXT_PROCESSED_ENV:'true',NEXT_TELEMETRY_DISABLED:'1',BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai',
   BLIZHNIY_DB_HOST:'17e86f80f26733d39ef4b84d.twc1.net',BLIZHNIY_DB_PORT:'5432',BLIZHNIY_DB_NAME:'blizhniy_prod',BLIZHNIY_DB_USER:'blizhniy_runtime',BLIZHNIY_DB_PASSWORD:'synthetic-ui-db-password',BLIZHNIY_DB_SSL_MODE:'verify-full',BLIZHNIY_DB_CA_FILE:ca,
   BLIZHNIY_AUTH_MAIL_KEY_FILE:key,BLIZHNIY_AUTH_RATE_SECRET:'synthetic-ui-only-rate-secret-not-used-by-api',BLIZHNIY_MAIL_MODE:'timeweb',BLIZHNIY_SMTP_USER:'notifications@ближний-ру.рф',BLIZHNIY_SMTP_PASSWORD:'synthetic-ui-smtp-password',TURNSTILE_SECRET_KEY:'synthetic-ui-captcha-secret'};
  app=spawn(process.execPath,['--experimental-strip-types','--require','./tests/listing-form-browser-pg.cjs','node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{env,detached:true,stdio:['ignore','pipe','pipe']});
  app.stdout.on('data',chunk=>{output=(output+chunk).slice(-12000);});app.stderr.on('data',chunk=>{output=(output+chunk).slice(-12000);});const deadline=Date.now()+20000;
  for(;;){assert.equal(app.exitCode,null);let ready=false;try{ready=(await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)})).ok;}catch(error){assert.ok(error.cause?.code==='ECONNREFUSED'||error.name==='TimeoutError');}if(ready)break;assert.ok(Date.now()<deadline);await new Promise(resolve=>setTimeout(resolve,100));}
  browser=await chromium.launch({headless:true});
  async function fixture(guest=false,accepted=false){
   const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),state={owner,record:{...original,view:guest?'guest':'host',...(accepted?{status:'accepted',decidedAt:stamp}:{}),lifecycle:{startsAt:'2030-11-05T11:00:00.000000Z',expiresAt:'2026-10-19T18:00:00.123456Z',canCancel:true,cancelledBy:null,cancellationReason:null}},writes:[],offline:false,lost:false,authOffline:false,errors:[],legacy:[]};page.setDefaultTimeout(5000);
   page.on('pageerror',error=>state.errors.push(error.message));page.on('console',event=>{if(['warning','error'].includes(event.type())&&!event.text().startsWith('Failed to load resource:'))state.errors.push(event.text());});
   await context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==origin){state.legacy.push(url.hostname);return route.abort();}if(!url.pathname.startsWith('/api/'))return route.continue();
    if(url.pathname==='/api/account/session')return route.fulfill(state.authOffline?{status:503,json:{error:{code:'UNAVAILABLE'}}}:!state.owner?{status:401,json:{error:{code:'UNAUTHENTICATED'}}}:{json:{user:{id:state.owner,email:'fixture@example.invalid',role:'user',isBlocked:false}}});
    if(url.pathname==='/api/account/profile')return route.fulfill({json:{exists:false,profile:createDefaultCabinetProfile({name:'Технический',email:'fixture@example.invalid'}),revision:null}});
    if(url.pathname==='/api/account/bookings'){
     const body=request.postDataJSON();assert.equal(request.headers().authorization,undefined);assert.equal(body.expectedOwnerId,state.owner);
     if(state.offline)return route.fulfill({status:503,json:{error:{code:'BOOKINGS_UNAVAILABLE'}}});
     if(body.action==='list')return route.fulfill({json:{items:state.owner===owner&&body.mode===state.record.view?[summary(state.record)]:[],nextCursor:null}});
     if(body.action==='read'){assert.equal(body.bookingId,id);return route.fulfill({json:state.record});}
     if(body.action==='cancel'){
      assert.equal(body.expectedRevision,state.record.revision);assert.equal(body.bookingId,id);assert.ok(body.reason.trim());state.writes.push(body);
      state.record={...state.record,status:'cancelled',revision:(BigInt(state.record.revision)+BigInt(1)).toString(),decidedAt:stamp,lifecycle:{...state.record.lifecycle,canCancel:false,cancelledBy:state.record.view,cancellationReason:body.reason}};
      if(state.lost){state.lost=false;return route.abort('failed');}return route.fulfill({json:state.record});
     }
     assert.equal(body.action,'decide');assert.equal(body.bookingId,id);assert.equal(body.expectedRevision,state.record.revision);state.writes.push(body);state.record={...state.record,status:body.state,revision:(BigInt(state.record.revision)+BigInt(1)).toString(),decidedAt:stamp};
     if(state.lost){state.lost=false;return route.abort('failed');}return route.fulfill({json:state.record});
    }
    state.legacy.push(url.pathname);return route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});
   });
   await page.goto(origin+'/cabinet/bronirovaniya');const panel=page.getByRole('region',{name:'Бронирования',exact:true});await panel.getByRole('button',{name:'Мои поездки',exact:true}).waitFor();
   if(!guest)await panel.getByRole('button',{name:'Заявки гостей',exact:true}).click();await panel.getByRole('button',{name:'Подробнее',exact:true}).click();await panel.getByRole('heading',{name:'Детали бронирования',exact:true}).waitFor();return{context,page,panel,state};
  }
  await suite.test('guest and host explicitly cancel a confirmed booking with bounded reason and one exact write',async()=>{
   for(const guest of [true,false]){
    const {context,panel,state}=await fixture(guest,true);try{
     const announcement=panel.locator('[role="status"][aria-atomic="true"]');
     assert.equal(await announcement.count(),1,'The announcement container exists before cancelling');
     const liveRegion=await announcement.elementHandle();
     assert.equal(await liveRegion.textContent(),'');
     await panel.getByRole('button',{name:'Отменить бронирование',exact:true}).click();const confirm=panel.getByRole('button',{name:'Подтвердить отмену',exact:true});assert.equal(await confirm.isEnabled(),false);
     await panel.getByText('Отменить бронирование? Причина будет видна второй стороне в деталях бронирования.',{exact:true}).waitFor();
     const reason=panel.getByLabel('Причина отмены',{exact:true});assert.equal(await reason.getAttribute('maxlength'),'500');await reason.fill('Изменились планы.');
     await confirm.click();
     const cancelledMessage='Бронирование отменено.';
     await panel.getByText(cancelledMessage,{exact:true}).waitFor();
     assert.equal(await liveRegion.evaluate((node,message)=>node.isConnected&&node.textContent===message,cancelledMessage),true);
     const details=panel.getByRole('heading',{name:'Детали бронирования',exact:true});
     const detailsHeading=await details.elementHandle();
     await announcement.page().waitForFunction(node=>document.activeElement===node,detailsHeading,{timeout:1500});
     const announcementId=await announcement.getAttribute('id');
     assert.ok(announcementId);
     assert.equal(await details.getAttribute('aria-describedby'),announcementId);
     assert.equal(state.writes.length,1);assert.equal(state.writes[0].reason,'Изменились планы.');assert.equal(state.writes[0].expectedRevision,original.revision);
     await panel.getByText('Изменились планы.',{exact:true}).waitFor();assert.equal(await panel.getByRole('button',{name:'Отменить бронирование',exact:true}).count(),0);assert.deepEqual(state.errors,[]);assert.deepEqual(state.legacy,[]);
    }finally{await context.close();}
   }
  });
  await suite.test('host prompts describe the decision without promising delivery',async()=>{
   const {context,panel,state}=await fixture();
   try{
    const confirmation=panel.getByRole('group',{name:'Подтверждение решения'});
    await panel.getByRole('button',{name:'Принять заявку',exact:true}).click();
    await confirmation.getByText('Подтвердить указанные даты и сумму заявки?',{exact:true}).waitFor();
    await confirmation.getByRole('button',{name:'Отмена',exact:true}).click();
    await panel.getByRole('button',{name:'Отклонить заявку',exact:true}).click();
    await confirmation.getByText('Отклонить заявку?',{exact:true}).waitFor();
    assert.deepEqual(state.writes,[]);
   }finally{await context.close();}
  });
  await suite.test('a lost cancellation response disables another write until readback confirms the reason and terminal state',async()=>{
   const {context,panel,state}=await fixture(true);try{
    state.lost=true;await panel.getByRole('button',{name:'Отменить бронирование',exact:true}).click();await panel.getByLabel('Причина отмены',{exact:true}).fill('Не смогу приехать.');await panel.getByRole('button',{name:'Подтвердить отмену',exact:true}).click();await panel.getByRole('alert').waitFor();
    assert.equal(state.writes.length,1);assert.equal(await panel.getByRole('button',{name:'Отменить бронирование',exact:true}).isDisabled(),true);
    await panel.getByRole('button',{name:'Проверить заявку',exact:true}).click();await panel.getByText('Актуальное состояние загружено.',{exact:true}).waitFor();await panel.getByText('Не смогу приехать.',{exact:true}).waitFor();assert.equal(state.writes.length,1);assert.deepEqual(state.errors,[]);
   }finally{await context.close();}
  });
  await suite.test('expired state has no owner actions; cancellation form is accessible and fits phone and desktop',async()=>{
   const {context,page,panel,state}=await fixture();try{
    await panel.getByRole('button',{name:'Отменить бронирование',exact:true}).click();await panel.getByLabel('Причина отмены',{exact:true}).fill('Проверка мобильного интерфейса.');
    await page.addScriptTag({path:createRequire(import.meta.url).resolve('axe-core/axe.min.js')});
    for(const width of [320,768,1024,1440]){
     await page.setViewportSize({width,height:1100});assert.equal(await page.locator('body').evaluate(node=>node.scrollWidth>innerWidth),false);
     assert.deepEqual(await panel.evaluate(async node=>(await window.axe.run(node,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.filter(item=>['serious','critical'].includes(item.impact)).map(item=>item.id)),[]);
     if(process.env.BLIZHNIY_BOOKING_VISUAL_REVIEW==='1'&&[320,1440].includes(width)){const review=await mkdtemp(join(tmpdir(),'blizhniy-booking-lifecycle-review-'));const path=join(review,width+'.png');await page.screenshot({path,fullPage:true});console.info('Synthetic booking lifecycle visual review: '+path);}
    }
    state.record={...state.record,status:'expired',revision:'9007199254740994',decidedAt:stamp,lifecycle:{...state.record.lifecycle,canCancel:false}};
    await panel.getByRole('button',{name:'Проверить заявку',exact:true}).click();await panel.getByText('Актуальное состояние загружено.',{exact:true}).waitFor();assert.equal(await panel.getByRole('button',{name:'Принять заявку',exact:true}).count(),0);assert.equal(await panel.getByRole('button',{name:'Отменить бронирование',exact:true}).count(),0);assert.deepEqual(state.errors,[]);assert.deepEqual(state.legacy,[]);
   }finally{await context.close();}
  });
  assert.equal(output.includes('Unexpected browser fixture query'),false);
 }catch(error){console.error('Owned browser fixture app output: '+output);throw error;}
 finally{await browser?.close();if(app?.exitCode===null){process.kill(-app.pid,'SIGTERM');await once(app,'exit');}await rm(directory,{recursive:true,force:true});}
});
