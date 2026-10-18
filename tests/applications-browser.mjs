import assert from 'node:assert/strict';import {test} from 'node:test';import {spawn} from 'node:child_process';import {once} from 'node:events';
import {createServer} from 'node:net';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {rootCertificates} from 'node:tls';import {randomBytes} from 'node:crypto';import {createRequire} from 'node:module';import {chromium} from 'playwright';
import {createDefaultCabinetProfile} from '../src/lib/cabinet-profile.ts';
const owner='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000004',id='10000000-0000-4000-8000-000000000002',targetId='10000000-0000-4000-8000-000000000003',stamp='2026-10-18T12:00:00.123456Z';
const snapshot={name:'Тестовый специалист',profession:'Мастер',price:'100.00',skills:'Ремонт и установка',phone:'+79990000000',email:'fixture@example.invalid',messengerUrl:null};
const detail={id,revision:'9007199254740993',view:'recipient',status:'sent',paid:true,createdAt:stamp,updatedAt:stamp,sentAt:stamp,target:{id:targetId,kind:'workRequest',title:'Синтетический заказ'},specialistId:null,snapshot,message:'Частное сообщение заявителя'};
const summary=value=>({id:value.id,revision:value.revision,view:value.view,status:value.status,paid:value.paid,createdAt:value.createdAt,targetId:value.target.id,kind:value.target.kind,targetTitle:value.target.title,specialistName:value.snapshot.name});
test('production application cabinet renders guarded cookie lists, details and decisions in an isolated browser',{timeout:90000},async suite=>{
 const directory=await mkdtemp(join(tmpdir(),'blizhniy-applications-browser-'));let app,browser,output='';
 try{
  const key=join(directory,'key'),ca=join(directory,'ca');await writeFile(key,randomBytes(32),{mode:0o600});await writeFile(ca,rootCertificates[0],{mode:0o600});
  const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));const origin=`http://127.0.0.1:${port}`;
  const env={PATH:process.env.PATH,LANG:'C.UTF-8',NODE_ENV:'production',__NEXT_PROCESSED_ENV:'true',NEXT_TELEMETRY_DISABLED:'1',BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai',
   BLIZHNIY_DB_HOST:'17e86f80f26733d39ef4b84d.twc1.net',BLIZHNIY_DB_PORT:'5432',BLIZHNIY_DB_NAME:'blizhniy_prod',BLIZHNIY_DB_USER:'blizhniy_runtime',BLIZHNIY_DB_PASSWORD:'synthetic-ui-db-password',
   BLIZHNIY_DB_SSL_MODE:'verify-full',BLIZHNIY_DB_CA_FILE:ca,BLIZHNIY_AUTH_MAIL_KEY_FILE:key,BLIZHNIY_AUTH_RATE_SECRET:'synthetic-ui-only-rate-secret-not-used-by-api',BLIZHNIY_MAIL_MODE:'timeweb',
   BLIZHNIY_SMTP_USER:'notifications@ближний-ру.рф',BLIZHNIY_SMTP_PASSWORD:'synthetic-ui-smtp-password',TURNSTILE_SECRET_KEY:'synthetic-ui-captcha-secret'};
  app=spawn(process.execPath,['--experimental-strip-types','--require','./tests/listing-form-browser-pg.cjs','node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{env,detached:true,stdio:['ignore','pipe','pipe']});
  app.stdout.on('data',chunk=>{output=(output+chunk).slice(-12000);});app.stderr.on('data',chunk=>{output=(output+chunk).slice(-12000);});const deadline=Date.now()+20000;
  for(;;){assert.equal(app.exitCode,null);let ready=false;try{ready=(await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)})).ok;}catch(error){assert.ok(error.cause?.code==='ECONNREFUSED'||error.name==='TimeoutError');}if(ready)break;assert.ok(Date.now()<deadline);await new Promise(resolve=>setTimeout(resolve,100));}
  browser=await chromium.launch({headless:true});
  async function fixture(own=false){
   const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),state={owner,record:own?{...detail,view:'applicant',status:'pending_payment',paid:false,sentAt:null}:structuredClone(detail),reads:0,writes:[],lost:false,offline:false,authOffline:false,errors:[],legacy:[]};page.setDefaultTimeout(6000);
   page.on('pageerror',error=>state.errors.push(error.message));page.on('console',event=>{if(['warning','error'].includes(event.type())&&!event.text().startsWith('Failed to load resource:'))state.errors.push(event.text());});
   await context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==origin){state.legacy.push(url.hostname);return route.abort();}if(!url.pathname.startsWith('/api/'))return route.continue();
    if(url.pathname==='/api/account/session')return route.fulfill(state.authOffline?{status:503,json:{error:{code:'UNAVAILABLE'}}}:!state.owner?{status:401,json:{error:{code:'UNAUTHENTICATED'}}}:{json:{user:{id:state.owner,email:'fixture@example.invalid',role:'user',isBlocked:false}}});
    if(url.pathname==='/api/account/profile')return route.fulfill({json:{exists:false,profile:createDefaultCabinetProfile({name:'Технический',email:'fixture@example.invalid'}),revision:null}});
    if(url.pathname==='/api/account/applications'){
     const body=request.postDataJSON();assert.equal(request.headers().authorization,undefined);assert.equal(body.expectedOwnerId,state.owner);
     if(state.offline)return route.fulfill({status:503,json:{error:{code:'APPLICATIONS_UNAVAILABLE'}}});
     if(body.action==='list'){state.reads++;return route.fulfill({json:{items:state.owner===owner&&body.mode===state.record.view?[summary(state.record)]:[],nextCursor:null}});}
     if(body.action==='read'){state.reads++;assert.equal(body.applicationId,id);return route.fulfill({json:state.record});}
     assert.equal(body.action,'decide');assert.equal(body.applicationId,id);assert.equal(body.expectedRevision,state.record.revision);state.writes.push(body);
     state.record={...state.record,status:body.state,revision:(BigInt(state.record.revision)+BigInt(1)).toString()};if(state.lost){state.lost=false;return route.abort('failed');}return route.fulfill({json:state.record});
    }
    state.legacy.push(url.pathname);return route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});
   });
   await page.goto(origin+'/cabinet/otkliki');const panel=page.getByRole('region',{name:'Рабочие отклики',exact:true});await panel.getByRole('button',{name:'Свои отклики',exact:true}).waitFor();
   if(!own)await panel.getByRole('button',{name:'Входящие отклики',exact:true}).click();await panel.getByRole('button',{name:'Подробнее',exact:true}).click();
   await panel.getByRole('heading',{name:'Детали отклика',exact:true}).waitFor();return{context,page,state,panel};
  }
  await suite.test('delivered recipient can explicitly confirm a decision without reloading or issuing legacy requests',async()=>{
   const {context,page,state,panel}=await fixture();try{
    await panel.getByRole('button',{name:'Выбрать исполнителя',exact:true}).click();assert.equal(state.writes.length,0);
    await panel.getByRole('button',{name:'Подтвердить выбор',exact:true}).click();await panel.getByRole('status').filter({hasText:'Решение сохранено.'}).waitFor();
    assert.equal(state.writes.length,1);assert.equal(state.writes[0].expectedRevision,'9007199254740993');assert.equal(page.url(),origin+'/cabinet/otkliki');
    assert.equal(await panel.getByRole('button',{name:'Отклонить отклик',exact:true}).count(),0);assert.deepEqual(state.legacy,[]);assert.deepEqual(state.errors,[]);
   }finally{await context.close();}
  });
  await suite.test('unknown decision blocks replay until detail readback; failed session checks hide but retain only the same owner workspace',async()=>{
   const {context,page,state,panel}=await fixture();try{
    state.lost=true;await panel.getByRole('button',{name:'Отклонить отклик',exact:true}).click();await panel.getByRole('button',{name:'Подтвердить отказ',exact:true}).click();await panel.getByRole('alert').waitFor();
    assert.equal(state.writes.length,1);assert.equal(await panel.getByRole('button',{name:'Выбрать исполнителя',exact:true}).isDisabled(),true);
    state.offline=true;await panel.getByRole('button',{name:'Проверить отклик',exact:true}).click();await panel.getByRole('alert').waitFor();assert.equal(state.writes.length,1);
    state.offline=false;await panel.getByRole('button',{name:'Проверить отклик',exact:true}).click();await panel.getByText('Актуальное состояние загружено.',{exact:true}).waitFor();
    state.authOffline=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await panel.getByText('Проверяем доступ. Данные временно скрыты.',{exact:true}).waitFor();assert.equal(await panel.getByText(detail.message,{exact:true}).isVisible(),false);
    state.authOffline=false;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await panel.getByText(detail.message,{exact:true}).waitFor();
    state.owner=other;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await panel.getByText('Вы ещё не откликались на вакансии и заказы.',{exact:true}).waitFor();assert.equal(await panel.getByText(detail.message,{exact:true}).count(),0);
    state.owner=null;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await panel.getByText('Войдите в аккаунт.',{exact:true}).waitFor();assert.equal(await panel.getByText(snapshot.email,{exact:true}).count(),0);
    assert.equal(state.writes.length,1);assert.deepEqual(state.legacy,[]);assert.deepEqual(state.errors,[]);
   }finally{await context.close();}
  });
  await suite.test('unpaid own detail states its delivery status, has no recipient actions, fits breakpoints and has no serious axe findings',async()=>{
   const {context,page,state,panel}=await fixture(true);try{
    await panel.getByText('Отклик ещё не доставлен владельцу публикации.',{exact:true}).waitFor();assert.equal(await panel.getByRole('button',{name:'Выбрать исполнителя',exact:true}).count(),0);
    await page.addScriptTag({path:createRequire(import.meta.url).resolve('axe-core/axe.min.js')});
    for(const width of [320,768,1024,1440]){await page.setViewportSize({width,height:1100});assert.equal(await page.locator('body').evaluate(node=>node.scrollWidth>innerWidth),false);
     const violations=await panel.evaluate(async node=>(await window.axe.run(node,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.filter(item=>['serious','critical'].includes(item.impact)).map(item=>item.id));assert.deepEqual(violations,[]);
     if(process.env.BLIZHNIY_APPLICATION_VISUAL_REVIEW==='1'&&[320,1440].includes(width)){const review=await mkdtemp(join(tmpdir(),'blizhniy-applications-review-'));await page.screenshot({path:join(review,width+'.png'),fullPage:true});console.info('Synthetic applications visual review: '+join(review,width+'.png'));}}
    await panel.getByRole('button',{name:'Закрыть детали',exact:true}).click();assert.equal(await panel.getByRole('button',{name:'Подробнее',exact:true}).evaluate(node=>node===document.activeElement),true);
    assert.equal(state.writes.length,0);assert.deepEqual(state.legacy,[]);assert.deepEqual(state.errors,[]);
   }finally{await context.close();}
  });
  assert.equal(output.includes('Unexpected browser fixture query'),false);
 }finally{await browser?.close();if(app?.exitCode===null){process.kill(-app.pid,'SIGTERM');await once(app,'exit');}await rm(directory,{recursive:true,force:true});}
});
