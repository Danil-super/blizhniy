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
async function pay(actor,id,kind){
 const suffix=kind==='listing'?'':'?type='+kind;
 await actor.page.goto(origin+'/oplata/'+id+suffix);
 await actor.page.getByRole('button',{name:'Открыть локальный симулятор',exact:true}).click();
 await actor.page.waitForURL(url=>url.pathname==='/__local/payment'&&url.searchParams.get('intent')===id);
 await actor.page.getByRole('button',{name:'Подтвердить успешную оплату',exact:true}).click();
 await actor.page.getByText('Оплата подтверждена сервером, размещение выполнено.',{exact:false}).waitFor();
 await actor.page.getByRole('link',{name:'Статус заказа',exact:true}).click();
 await actor.page.getByRole('heading',{name:'Размещение выполнено',exact:true}).waitFor();
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
  await author.page.getByRole('button',{name:kind==='workRequest'?'Оплатить':'Перейти к оплате',exact:true}).click();await author.page.waitForURL(url=>/^\/oplata\/[a-f0-9-]{36}$/.test(url.pathname));
  const paymentId=new URL(author.page.url()).pathname.split('/').at(-1);assert.notEqual(paymentId,cancelledId);
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
  results.push({kind,targetId,paymentId,cancelledId,paid:true,editedWithoutRepayment:true});
 }
 const profile=await specialist.api('/api/account/service-publications',{action:'create',kind:'specialist',creationKey:randomUUID(),form:{description:'Выполняю монтаж и ремонт сантехники, соблюдаю согласованные сроки.',professionName:'Сантехник',cityName:'Краснодар',price:'1500',contactPhone:'+79991112233',email:'synthetic@example.invalid',placementRightConfirmed:true}},'PUT');
 assert.equal(profile.form.title,'Тестовый специалист');assert.equal(profile.paid,false);
 assert.equal((await owner.query("select count(*)::int n from app.payment_orders where target_type='specialist' and owner_id=$1",[specialist.id])).rows[0].n,0);
 const target=results.find(r=>r.kind==='workRequest');await specialist.page.goto(origin+'/rabota/zakazy/'+target.targetId);
 const composer=specialist.page.getByRole('region',{name:'Отклик на публикацию'});await composer.getByLabel('Сообщение',{exact:true}).fill('Могу выполнить работу завтра. Инструменты есть.');
 const applicationResponse=specialist.page.waitForResponse(r=>r.url()===origin+'/api/account/applications'&&r.request().method()==='PUT');await composer.getByRole('button',{name:'Оплатить и отправить',exact:true}).click();assert.equal((await applicationResponse).status(),200);const application=await(await applicationResponse).json();
 await specialist.page.waitForURL(url=>/^\/oplata\/[a-f0-9-]{36}$/.test(url.pathname)&&url.searchParams.get('type')==='application');
 const applicationPayment=new URL(specialist.page.url()).pathname.split('/').at(-1);
 await author.api('/api/account/applications',{action:'read',applicationId:application.id},'POST',404);
 await specialist.page.getByRole('button',{name:'Открыть локальную TEST-оплату',exact:true}).click();await specialist.page.waitForURL('**/__local/payment?**');await specialist.page.getByRole('button',{name:'Подтвердить успешную оплату',exact:true}).click();await specialist.page.getByText('Оплата подтверждена сервером, отклик доставлен.',{exact:true}).waitFor();
 const received=await author.api('/api/account/applications',{action:'read',applicationId:application.id});assert.equal(received.paid,true);assert.equal(received.message,application.message);
 assert.equal((await owner.query('select count(*)::int n from local_primary.application_deliveries where intent_id=$1',[applicationPayment])).rows[0].n,1);
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 const result={status:'passed',run,results,specialist:{id:profile.id,free:true,applicationId:application.id,paymentId:applicationPayment},realProviderCalls:false,productionTouched:false};
 await writeFile(join(stateDirectory,'core-workflows-'+run+'.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({status:'passed',types:results.map(r=>r.kind),publications:results.length,paidEdits:results.length,cancellations:results.length,phoneGate:true,invalidFieldsRejected:true,workWithdrawRestore:true,freeProfile:true,paidResponseDelivered:true,realProviderCalls:false,productionTouched:false}));
}catch(error){await Promise.allSettled(contexts.flatMap((context,index)=>context.pages().map(page=>page.screenshot({path:join(stateDirectory,'core-workflows-'+run+'-failure-'+index+'.png'),fullPage:true}))));throw error;}
finally{await Promise.allSettled(contexts.map(c=>c.close()));await browser.close();await owner.end();}
