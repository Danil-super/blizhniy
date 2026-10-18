import assert from 'node:assert/strict';import {test} from 'node:test';import {spawn} from 'node:child_process';import {once} from 'node:events';
import {createServer} from 'node:net';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {rootCertificates} from 'node:tls';import {randomBytes} from 'node:crypto';import {createRequire} from 'node:module';import {chromium} from 'playwright';
import {request as httpRequest} from 'node:http';
const owner='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000004',id='10000000-0000-4000-8000-000000000002',stamp='2026-10-18T12:00:00.123456Z';
const item=(key,title='Синтетическое событие')=>({id:key,category:'system',tone:'info',title,message:'Приватное сообщение текущего аккаунта',createdAt:stamp,read:false,actionHref:'/cabinet',bookingRequestId:null});
test('primary notification inbox renders real production components with isolated cookie transport',{timeout:90000},async suite=>{
 const directory=await mkdtemp(join(tmpdir(),'blizhniy-inbox-browser-'));let app,browser,output='';
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
  browser=await chromium.launch({headless:true});
  async function fixture(){
   const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),state={owner,items:[item(id)],reads:0,writes:[],lost:false,offline:false,authOffline:false,errors:[],legacy:[]};page.setDefaultTimeout(6000);
   page.on('pageerror',error=>state.errors.push(error.message));
   page.on('console',event=>{if(['warning','error'].includes(event.type())&&!event.text().startsWith('Failed to load resource:'))state.errors.push(event.text());});
   await context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());
    if(url.origin!==origin){state.legacy.push(url.hostname);return route.abort();}if(!url.pathname.startsWith('/api/'))return route.continue();
    if(url.pathname==='/api/account/session')return route.fulfill(state.authOffline?{status:503,json:{error:{code:'UNAVAILABLE'}}}:{json:{user:state.owner?{id:state.owner,email:'fixture@example.invalid',role:'user',isBlocked:false}:null}});
    if(url.pathname==='/api/account/notifications'){
     const body=request.postDataJSON();assert.equal(request.headers().authorization,undefined);assert.equal(body.expectedOwnerId,state.owner);
     if(body.action==='list'){state.reads++;return route.fulfill(state.offline?{status:503,json:{error:{code:'NOTIFICATIONS_UNAVAILABLE'}}}:{json:{items:state.items,nextCursor:null}});}
     state.writes.push(body);if(body.action==='read')state.items=state.items.map(value=>body.ids.includes(value.id)?{...value,read:true}:value);else state.items=state.items.filter(value=>!body.ids.includes(value.id));
     if(state.lost){state.lost=false;return route.abort('failed');}return route.fulfill({json:{ok:true}});
    }
    state.legacy.push(url.pathname);return route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});
   });
   await page.goto(origin+'/tarify');await page.getByRole('button',{name:'Уведомления',exact:true}).click();
   const panel=page.getByRole('region',{name:'Личные уведомления',exact:true});await panel.getByText('Синтетическое событие',{exact:true}).waitFor();return{context,page,state,panel};
  }
  await suite.test('read/dismiss affect only shown events and refresh real server state without legacy traffic',async()=>{
   const {context,page,state,panel}=await fixture();try{
    await panel.getByRole('button',{name:'Прочитать показанные',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[aria-label="Личные уведомления"]')?.textContent.includes('Прочитано'));
    assert.deepEqual(state.writes[0].ids,[id]);assert.equal(state.writes[0].action,'read');
    await panel.getByRole('button',{name:'Убрать показанные',exact:true}).click();await panel.getByText('Уведомлений пока нет.',{exact:true}).waitFor();
    assert.equal(state.writes.length,2);assert.deepEqual(state.legacy,[]);assert.deepEqual(state.errors,[]);
   }finally{await context.close();}
  });
  await suite.test('lost write response blocks repetition until readback and network rechecks preserve the owner workspace',async()=>{
   const {context,page,state,panel}=await fixture();try{
    state.lost=true;await panel.getByRole('button',{name:'Прочитать показанные',exact:true}).click();await panel.getByRole('alert').waitFor();assert.equal(state.writes.length,1);
    assert.equal(await panel.getByRole('button',{name:'Убрать показанные',exact:true}).isDisabled(),true);
    await panel.getByRole('button',{name:'Проверить уведомления',exact:true}).click();await panel.getByText('Прочитано',{exact:true}).waitFor();assert.equal(state.writes.length,1);
    state.authOffline=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByText('Не удалось проверить вход.',{exact:true}).waitFor();
    assert.equal(await panel.isVisible(),false);state.authOffline=false;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await panel.getByText('Прочитано',{exact:true}).waitFor();
    state.owner=other;state.items=[item('10000000-0000-4000-8000-000000000005','Событие другого аккаунта')];await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await page.getByRole('button',{name:'Уведомления',exact:true}).click();await panel.getByText('Событие другого аккаунта',{exact:true}).waitFor();assert.equal(await panel.getByText('Синтетическое событие',{exact:true}).count(),0);
    assert.equal(state.writes.length,1);assert.deepEqual(state.legacy,[]);assert.deepEqual(state.errors,[]);
   }finally{await context.close();}
  });
  await suite.test('notification panel fits mobile, supports Escape focus return and has no serious axe findings',async()=>{
   const {context,page,state,panel}=await fixture();try{
    await page.addScriptTag({path:createRequire(import.meta.url).resolve('axe-core/axe.min.js')});
    for(const width of [320,768,1024,1440]){await page.setViewportSize({width,height:1000});assert.equal(await page.locator('body').evaluate(node=>node.scrollWidth>innerWidth),false);
     if(width===320&&process.env.BLIZHNIY_INBOX_VISUAL_REVIEW==='1'){const review=await mkdtemp(join(tmpdir(),'blizhniy-inbox-review-'));await page.screenshot({path:join(review,'mobile.png')});console.info('Synthetic inbox visual review: '+join(review,'mobile.png'));}
     const violations=await panel.evaluate(async node=>(await window.axe.run(node,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.filter(item=>['serious','critical'].includes(item.impact)).map(item=>item.id));assert.deepEqual(violations,[]);}
    await page.keyboard.press('Escape');assert.equal(await panel.isVisible(),false);assert.equal(await page.getByRole('button',{name:'Уведомления',exact:true}).evaluate(node=>node===document.activeElement),true);assert.deepEqual(state.errors,[]);
   }finally{await context.close();}
  });
  await suite.test('actual Next inbox route rejects missing cookie before opening any database runtime',async()=>{
   const response=await new Promise((resolve,reject)=>{
    const request=httpRequest(origin+'/api/account/notifications',{method:'POST',headers:{host:'xn----9sbphbgks4a4a.xn--p1ai',origin:env.BLIZHNIY_AUTH_ORIGIN,'x-real-ip':'192.0.2.5','x-blizhniy-request':'1','content-type':'application/json'}},response=>{
     let body='';response.on('data',chunk=>{body+=chunk;if(body.length>4096)request.destroy(Error('Oversized ingress refusal'));});response.on('end',()=>resolve({status:response.statusCode,body,headers:response.headers}));response.on('error',reject);
    });request.setTimeout(5000,()=>request.destroy(Error('Ingress timeout')));request.on('error',reject);request.end(JSON.stringify({action:'list',expectedOwnerId:owner,after:null}));
   });assert.equal(response.status,401);assert.deepEqual(JSON.parse(response.body),{error:{code:'UNAUTHENTICATED'}});assert.equal(response.headers['cache-control'],'no-store');
  });
  assert.equal(output.includes('Unexpected browser fixture query'),false);
 }finally{await browser?.close();if(app?.exitCode===null){process.kill(-app.pid,'SIGTERM');await once(app,'exit');}await rm(directory,{recursive:true,force:true});}
});
