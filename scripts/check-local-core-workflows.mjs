// Owned synthetic stand only. Keeps clearly named fixtures and their payment history for inspection.
import assert from 'node:assert/strict';
import {randomUUID,randomInt} from 'node:crypto';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from 'playwright';
import sharp from 'sharp';
import pg from 'pg';
import {stateFile,stateDirectory,docker,localPrimaryDatabaseConfig} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';

const state=readLocalPrimaryState(stateFile,process.cwd());
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
assert.equal(state.origin,'https://127.0.0.1:3045');
const origin=state.origin,run=randomUUID(),load=createRequire(import.meta.url)('./local-primary-modules.cjs').loadLocalPrimaryModule;
const owner=new pg.Client(localPrimaryDatabaseConfig(state,'owner'));await owner.connect();
const browser=await chromium.launch({headless:true}),contexts=[],errors=[],external=[],results=[];
const headers={Origin:origin,'Content-Type':'application/json','X-Blizhniy-Request':'1','Sec-Fetch-Site':'same-origin'};
async function account(name,confirmed=true){
 const email='core-'+randomUUID()+'@local.invalid',password='SyntheticCore-'+randomUUID()+'!',phone='+7999'+randomInt(1000000,9999999);
 await owner.query('begin');let id;try{id=(await owner.query('insert into app.users(email,password_hash,email_verified_at) values($1,$2,clock_timestamp()) returning id',[email,await load('identity').hashPassword(password)])).rows[0].id;
 await owner.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2::jsonb)',[id,JSON.stringify({name,phone,city:'Краснодар'})]);
 if(confirmed)await owner.query('insert into app.telegram_phone_bindings(user_id,phone,telegram_subject) values($1,$2,$3)',[id,phone,'synthetic-core-'+id]);
 await owner.query('commit');}catch(error){await owner.query('rollback');throw error;}
 const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',viewport:{width:1440,height:1000}});contexts.push(context);
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(['http:','https:'].includes(url.protocol)&&url.origin!==origin){external.push(url.origin);return route.abort();}return route.continue();});
 const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.name));
 const api=async(path,data,method='POST',status=200)=>{const response=await context.request.fetch(origin+path,{method,headers,data:{expectedOwnerId:id,...data}});assert.equal(response.status(),status,path);return response.json();};
 await page.goto(origin+'/auth');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Пароль',{exact:true}).fill(password);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.waitForURL(origin+'/');
 return{id,context,page,api};
}
// Drop only the browser reply after the real handler has committed its work.
async function loseReply(actor,path,method,action,work){
 // Response-stage CDP keeps Chromium's own Origin/Fetch Metadata on form POSTs.
 const session=await actor.context.newCDPSession(actor.page);
 let resolve,reject,seen=false;
 const completed=new Promise((yes,no)=>{resolve=yes;reject=no;});void completed.catch(()=>undefined);
 const timer=setTimeout(()=>reject(Error('Missing committed reply: '+path)),15000);
 const handler=async event=>{
  try{
   const url=new URL(event.request.url);
   if(seen||url.origin!==origin||url.pathname!==path||event.request.method!==method||action&&JSON.parse(event.request.postData)?.action!==action){await session.send('Fetch.continueResponse',{requestId:event.requestId});return;}
   seen=true;assert.equal(event.responseStatusCode,200,path);
   const result=await session.send('Fetch.getResponseBody',{requestId:event.requestId});
   await session.send('Fetch.failRequest',{requestId:event.requestId,errorReason:'Failed'});
   resolve(result.base64Encoded?Buffer.from(result.body,'base64').toString('utf8'):result.body);
  }catch(error){reject(error);}
 };
 session.on('Fetch.requestPaused',handler);
 try{await session.send('Fetch.enable',{patterns:[{urlPattern:origin+path+'*',requestStage:'Response'}]});await work();return await completed;}
 finally{clearTimeout(timer);session.off('Fetch.requestPaused',handler);try{await session.send('Fetch.disable');}finally{await session.detach();}}
}
async function paymentRows(id){return(await owner.query(`select
 (select count(*)::int from app.payment_dispatch_anchors where intent_id=$1) anchors,
 (select count(*)::int from app.payment_provider_links where intent_id=$1) links,
 (select count(*)::int from local_primary.provider_payments where intent_id=$1) providers`,[id])).rows[0];}
async function pay(actor,id,kind){
 const suffix=kind==='listing'?'':'?type='+kind;
 const endpoint='/api/account/'+(kind==='listing'?'listing':kind==='vacancy'?'vacancy':'work-request')+'-checkout';
 await actor.page.goto(origin+'/oplata/'+id+suffix);
 const launch=JSON.parse(await loseReply(actor,endpoint,'POST','dispatch',()=>actor.page.getByRole('button',{name:'Открыть локальный симулятор',exact:true}).click()));
 assert.equal(typeof launch.confirmationUrl,'string');
 await actor.page.getByRole('button',{name:'Восстановить переход к оплате',exact:true}).waitFor();
 assert.deepEqual(await paymentRows(id),{anchors:1,links:1,providers:1});
 await actor.page.getByRole('button',{name:'Восстановить переход к оплате',exact:true}).click();
 await actor.page.waitForURL(url=>url.pathname==='/__local/payment'&&url.searchParams.get('intent')===id);
 assert.deepEqual(await paymentRows(id),{anchors:1,links:1,providers:1});
 const captured=await loseReply(actor,'/__local/payment','POST',null,()=>actor.page.getByRole('button',{name:'Подтвердить успешную оплату',exact:true}).click({noWaitAfter:true}));
 assert.ok(captured.includes('Оплата подтверждена сервером, размещение выполнено.'));
 const committed=await period(id);assert.equal(committed.length,1);
 await actor.page.goto(origin+'/oplata/'+id+suffix);
 await actor.page.getByRole('heading',{name:'Размещение выполнено',exact:true}).waitFor();
 assert.deepEqual(await period(id),committed);
 // An explicit replay after the lost navigation must retain the original term.
 await actor.page.goto(origin+'/__local/payment?intent='+id+(kind==='listing'?'':'&type='+kind));
 await actor.page.getByRole('button',{name:'Подтвердить успешную оплату',exact:true}).click();
 await actor.page.getByText('Оплата подтверждена сервером, размещение выполнено.',{exact:false}).waitFor();
 await actor.page.getByRole('link',{name:'Статус заказа',exact:true}).click();
 await actor.page.getByRole('heading',{name:'Размещение выполнено',exact:true}).waitFor();
 assert.deepEqual(await period(id),committed);assert.deepEqual(await paymentRows(id),{anchors:1,links:1,providers:1});
}
async function period(id){return(await owner.query('select published_at::text,expires_at::text from app.payment_fulfillments where intent_id=$1',[id])).rows;}
try{
 const author=await account('Тестовый заказчик'),specialist=await account('Тестовый специалист');
 const unconfirmed=await account('Тестовый новый пользователь',false),validWork={kind:'workRequest',title:'Проверка обязательного телефона',description:'Синтетическая проверка допуска оплаты заказа.',cityName:'Краснодар',professionName:'Сантехник',contactPhone:'+79990000000',placementRightConfirmed:true,budget:'3500'};
 const restricted=await unconfirmed.api('/api/account/work-publications',{action:'create',kind:'workRequest',creationKey:randomUUID(),form:validWork},'PUT');
 const quote=await unconfirmed.api('/api/account/work-request-checkout',{action:'testPreview',listingId:restricted.id,expectedRevision:restricted.revision});
 const refused=await unconfirmed.api('/api/account/work-request-checkout',{creationKey:randomUUID(),listingId:restricted.id,expectedRevision:restricted.revision,expectedTariffId:quote.tariff.id,expectedAmount:quote.tariff.amount,expectedDurationDays:quote.tariff.durationDays},'PUT',403);assert.equal(refused.error.code,'PHONE_REQUIRED');
 assert.equal((await owner.query('select count(*)::int n from app.payment_orders where owner_id=$1',[unconfirmed.id])).rows[0].n,0);
 const draftsBefore=(await owner.query('select count(*)::int n from app.work_publications where author_id=$1',[author.id])).rows[0].n;
 for(const patch of [{budget:'3500<script>'},{contactPhone:'+14445556677'},{description:'<script>alert(1)</script>'}])await author.api('/api/account/work-publications',{action:'create',kind:'workRequest',creationKey:randomUUID(),form:{...validWork,...patch}},'PUT',422);
 assert.equal((await owner.query('select count(*)::int n from app.work_publications where author_id=$1',[author.id])).rows[0].n,draftsBefore);

 const image=await sharp({create:{width:800,height:600,channels:3,background:'#caddf0'}}).webp().toBuffer();
 const upload=await author.context.request.post(origin+'/api/account/media',{headers:{...headers,'Content-Type':'image/webp','X-Blizhniy-Owner':author.id,'X-Blizhniy-Intent':randomUUID()},data:image});assert.equal(upload.status(),200);const photo=await upload.json();
 for(const kind of ['listing','vacancy','workRequest']){
  const title='Проверка основных процессов — '+kind+' '+run.slice(0,8),work=kind!=='listing';let item;
  if(!work){
   item=await author.api('/api/account/listing-drafts/collection',{creationKey:randomUUID()},'PUT');
   item=await author.api('/api/account/listing-form',{listingId:item.id,expectedRevision:item.revision,form:{kind:'prodam',title,description:'Синтетическая проверка оплаты, фото и сохранности размещения.',price:'3500.00',categorySlug:'otdyh',cityName:'Краснодар',contactPhone:'+79990000000',photoIds:[photo.id]}},'PUT');
  }else item=await author.api('/api/account/work-publications',{action:'create',kind,creationKey:randomUUID(),form:{kind,title,description:'Нужен мастер для проверки соединений и ремонта сантехники.',cityName:'Краснодар',professionName:'Сантехник',contactPhone:'+79990000000',placementRightConfirmed:true,photoIds:[photo.id],...(kind==='vacancy'?{employerType:'person',organization:'Тестовый заказчик',salary:'45000',schedule:'5/2',workFormat:'На месте'}:{budget:'3500'})}},'PUT');
  const targetId=item.id,edit=work?'/rabota/'+(kind==='vacancy'?'vakansii':'zakazy')+'/'+targetId+'/edit':'/razmestit/obyavlenie?draft='+targetId;
  await author.page.goto(origin+edit);
  if(kind==='vacancy')await author.page.getByRole('button',{name:'Продолжить к вакансии',exact:true}).click();
  await author.page.locator('input[name=title]:visible').waitFor();assert.equal(await author.page.locator('input[name=title]:visible').inputValue(),title);
  if(kind==='workRequest')assert.equal(await author.page.getByLabel('Район',{exact:true}).count(),0);
  await author.page.locator('input[name=title]:visible').waitFor();
  for(const checkbox of await author.page.locator('form input[type=checkbox]:visible').all())await checkbox.check();
  await author.page.getByRole('button',{name:kind==='workRequest'?'Оплатить':'Перейти к оплате',exact:true}).click();
  await author.page.waitForURL(url=>/^\/oplata\/[a-f0-9-]{36}$/.test(url.pathname));
  const cancelledId=new URL(author.page.url()).pathname.split('/').at(-1);
  await author.page.getByRole('button',{name:'Отменить подготовку оплаты',exact:true}).click();await author.page.getByRole('heading',{name:'Платёж отменён',exact:true}).waitFor();
  assert.equal((await period(cancelledId)).length,0);assert.equal((await owner.query('select count(*)::int n from app.payment_dispatch_anchors where intent_id=$1',[cancelledId])).rows[0].n,0);
  await author.page.goto(origin+edit);if(kind==='vacancy')await author.page.getByRole('button',{name:'Продолжить к вакансии',exact:true}).click();
  await author.page.locator('input[name=title]:visible').waitFor();
  for(const checkbox of await author.page.locator('form input[type=checkbox]:visible').all())await checkbox.check();
  const endpoint='/api/account/'+(kind==='listing'?'listing':kind==='vacancy'?'vacancy':'work-request')+'-checkout';
  const prepared=JSON.parse(await loseReply(author,endpoint,'PUT',null,()=>author.page.getByRole('button',{name:kind==='workRequest'?'Оплатить':'Перейти к оплате',exact:true}).click()));
  await author.page.getByRole('button',{name:'Проверить сохранённый заказ',exact:true}).waitFor();
  assert.equal((await owner.query('select count(*)::int n from app.payment_orders where target_id=$1',[targetId])).rows[0].n,2);
  await author.page.getByRole('button',{name:'Проверить сохранённый заказ',exact:true}).click();
  await author.page.waitForURL(url=>/^\/oplata\/[a-f0-9-]{36}$/.test(url.pathname));
  const paymentId=new URL(author.page.url()).pathname.split('/').at(-1);assert.notEqual(paymentId,cancelledId);
  assert.equal(paymentId,prepared.id);
  assert.equal((await period(paymentId)).length,0);await pay(author,paymentId,kind);
  const before=await period(paymentId);assert.equal(before.length,1);
  await author.page.reload();await author.page.getByRole('heading',{name:'Размещение выполнено',exact:true}).waitFor();assert.deepEqual(await period(paymentId),before);
  const publicPath=kind==='listing'?'/obyavlenie/':kind==='vacancy'?'/vakansiya/':'/rabota/zakazy/';
  assert.equal((await specialist.context.request.get(origin+publicPath+targetId)).status(),200);
  await author.page.goto(origin+edit);if(kind==='vacancy')await author.page.getByRole('button',{name:'Продолжить к вакансии',exact:true}).click();
  await author.page.locator('input[name=title]:visible').fill(title+' — обновлено');
  await author.page.locator('input[name=title]:visible').waitFor();
  for(const checkbox of await author.page.locator('form input[type=checkbox]:visible').all())await checkbox.check();
  await author.page.getByRole('button',{name:'Сохранить изменения',exact:true}).click();await author.page.waitForURL(origin+'/cabinet/'+(kind==='listing'?'obyavleniya':kind==='vacancy'?'vakansii':'zakazy'));
  assert.deepEqual(await period(paymentId),before);assert.equal((await owner.query('select count(*)::int n from app.payment_orders where target_id=$1',[targetId])).rows[0].n,2);
  const response=await specialist.page.goto(origin+publicPath+targetId);assert.equal(response.status(),200);await specialist.page.getByRole('heading',{name:title+' — обновлено',exact:true}).waitFor();
  assert.equal(await specialist.page.getByText('Автор заказа',{exact:true}).count(),0);
  for(const width of [320,768,1440]){await specialist.page.setViewportSize({width,height:1000});assert.equal(await specialist.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  if(work){
   const read=()=>author.api('/api/account/work-publications',{action:'read',kind,publicationId:targetId});
   for(const action of ['withdraw','restore']){
    const current=await read();await author.api('/api/account/work-actions',{operationId:randomUUID(),publicationId:targetId,kind,expectedRevision:current.revision,action,reason:action==='restore'?null:'Синтетическая проверка снятия'});
    assert.equal((await specialist.context.request.get(origin+publicPath+targetId)).status(),action==='withdraw'?404:200);assert.deepEqual(await period(paymentId),before);
   }
  }
  results.push({kind,targetId,paymentId,cancelledId,paid:true,editedWithoutRepayment:true,lostPrepareReplyRecovered:true,lostDispatchReplyRecovered:true,lostCaptureReplyRecovered:true});
 }
 const profile=await specialist.api('/api/account/service-publications',{action:'create',kind:'specialist',creationKey:randomUUID(),form:{description:'Выполняю монтаж и ремонт сантехники, соблюдаю согласованные сроки.',professionName:'Сантехник',cityName:'Краснодар',price:'1500',contactPhone:'+79991112233',email:'synthetic@example.invalid',placementRightConfirmed:true}},'PUT');
 assert.equal(profile.form.title,'Тестовый специалист');assert.equal(profile.paid,false);
 assert.equal((await owner.query("select count(*)::int n from app.payment_orders where target_type='specialist' and owner_id=$1",[specialist.id])).rows[0].n,0);
 const target=results.find(r=>r.kind==='workRequest');await specialist.page.goto(origin+'/rabota/zakazy/'+target.targetId);
 const composer=specialist.page.getByRole('region',{name:'Отклик на публикацию'});await composer.getByLabel('Сообщение',{exact:true}).fill('Могу выполнить работу завтра. Инструменты есть.');
 const applicationResponse=specialist.page.waitForResponse(r=>r.url()===origin+'/api/account/applications'&&r.request().method()==='PUT');
 const preparedApplication=JSON.parse(await loseReply(specialist,'/api/account/application-checkout','PUT',null,()=>composer.getByRole('button',{name:'Оплатить и отправить',exact:true}).click()));
 assert.equal((await applicationResponse).status(),200);const application=await(await applicationResponse).json();
 await specialist.page.getByRole('button',{name:'Проверить сохранённый заказ',exact:true}).click();
 await specialist.page.waitForURL(url=>/^\/oplata\/[a-f0-9-]{36}$/.test(url.pathname)&&url.searchParams.get('type')==='application');
 const applicationPayment=new URL(specialist.page.url()).pathname.split('/').at(-1);
 assert.equal(applicationPayment,preparedApplication.id);
 assert.equal((await owner.query('select count(*)::int n from app.payment_orders where target_id=$1',[application.id])).rows[0].n,1);
 await author.api('/api/account/applications',{action:'read',applicationId:application.id},'POST',404);
 const launchApplication=JSON.parse(await loseReply(specialist,'/api/account/application-checkout','POST','dispatch',()=>specialist.page.getByRole('button',{name:'Открыть локальную TEST-оплату',exact:true}).click()));assert.equal(typeof launchApplication.confirmationUrl,'string');
 await specialist.page.getByRole('button',{name:'Восстановить локальную TEST-оплату',exact:true}).click();await specialist.page.waitForURL('**/__local/payment?**');
 assert.deepEqual(await paymentRows(applicationPayment),{anchors:1,links:1,providers:1});
 const delivered=await loseReply(specialist,'/__local/payment','POST',null,()=>specialist.page.getByRole('button',{name:'Подтвердить успешную оплату',exact:true}).click({noWaitAfter:true}));assert.ok(delivered.includes('Оплата подтверждена сервером, отклик доставлен.'));
 await specialist.page.goto(origin+'/oplata/'+applicationPayment+'?type=application');await specialist.page.getByRole('heading',{name:'Отклик доставлен',exact:true}).waitFor();
 // Replay the same provider result after recovering the committed delivery.
 await specialist.page.goto(origin+'/__local/payment?intent='+applicationPayment+'&type=application');
 await specialist.page.getByRole('button',{name:'Подтвердить успешную оплату',exact:true}).click();await specialist.page.getByText('Оплата подтверждена сервером, отклик доставлен.',{exact:true}).waitFor();
 const received=await author.api('/api/account/applications',{action:'read',applicationId:application.id});assert.equal(received.paid,true);assert.equal(received.message,application.message);
 assert.equal((await owner.query('select count(*)::int n from local_primary.application_deliveries where intent_id=$1',[applicationPayment])).rows[0].n,1);
 assert.deepEqual(await paymentRows(applicationPayment),{anchors:1,links:1,providers:1});
 assert.equal((await owner.query('select count(*)::int n from app.notifications where user_id=$1 and event_key=$2',[author.id,'application_paid:'+application.id])).rows[0].n,1);
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 const result={status:'passed',run,results,specialist:{id:profile.id,free:true,applicationId:application.id,paymentId:applicationPayment,lostPrepareReplyRecovered:true,lostDispatchReplyRecovered:true,lostCaptureReplyRecovered:true,singleNotification:true},realProviderCalls:false,productionTouched:false};
 await writeFile(join(stateDirectory,'core-workflows-'+run+'.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({status:'passed',types:results.map(r=>r.kind),publications:results.length,paidEdits:results.length,cancellations:results.length,lostReplyRecoveries:(results.length+1)*3,phoneGate:true,invalidFieldsRejected:true,workWithdrawRestore:true,freeProfile:true,paidResponseDelivered:true,singleResponseNotification:true,realProviderCalls:false,productionTouched:false}));
}catch(error){await Promise.allSettled(contexts.flatMap((context,index)=>context.pages().map(page=>page.screenshot({path:join(stateDirectory,'core-workflows-'+run+'-failure-'+index+'.png'),fullPage:true}))));throw error;}
finally{await Promise.allSettled(contexts.map(c=>c.close()));await browser.close();await owner.end();}
