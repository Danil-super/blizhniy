// Compiled local browser/HTTP/SQL proof; only synthetic local simulator checkouts.
import assert from 'node:assert/strict';import {mkdtemp} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {randomBytes,randomUUID,randomInt} from 'node:crypto';import {createRequire} from 'node:module';import pg from 'pg';import {chromium} from 'playwright';
import {prepareLocalPrimaryFixture,localPrimaryDatabaseConfig} from './local-primary-fixture.mjs';
const load=createRequire(import.meta.url)('./local-primary-modules.cjs').loadLocalPrimaryModule,state=await prepareLocalPrimaryFixture();assert.equal(state.origin,'https://127.0.0.1:3045');
const db=new pg.Client(localPrimaryDatabaseConfig(state,'owner'));await db.connect();const id=randomUUID(),token=randomBytes(32).toString('hex'),hash=load('identity').hashSessionToken(token),payments=[],errors=[];
let browser,context,page,workId;const artifacts=await mkdtemp(join(tmpdir(),'blizhniy-checkout-cancel-ui-'));
const api=async(path,body,method='POST')=>page.evaluate(async({path,body,method})=>{const r=await fetch(path,{method,credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Blizhniy-Request':'1'},body:JSON.stringify(body)});return{status:r.status,value:await r.json()};},{path,body:{...body,expectedOwnerId:id},method});
async function synthetic(type){const payment=randomUUID(),target=randomUUID(),tariffId=type==='application'?'job-response':'local-checkout',body=JSON.stringify({amount:{value:'199.00',currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://fixture.example.invalid/return'},metadata:{localPaymentId:payment,targetId:target,targetType:type,tariffId}});
 await db.query('begin');try{await new(load('postgres-payment-intents').PostgresPaymentIntentStore)({transaction:work=>work({query:(sql,values)=>db.query(sql,values)})}).persistInTransaction({query:(sql,values)=>db.query(sql,values)},{id:payment,ownerId:id,targetType:type,targetId:target,targetRevision:'1',tariffId,amount:'199.00',durationDays:type==='application'?null:30,shopId:'local-fixture-shop',isTest:true,requestBody:body});await db.query('insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,$4,$5,1)',[payment,id,randomUUID(),type,target]);await db.query('commit');}catch(error){await db.query('rollback');throw error;}payments.push(payment);return{type,payment};}
try{
 const phone='+7999'+String(randomInt(1000000,9999999));await db.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',[id,id+'@local.invalid','scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128)]);
 const profile=Object.fromEntries(Object.entries({...load('cabinet-profile').createDefaultCabinetProfile({name:'Проверка отмены подготовки',email:id+'@local.invalid'}),phone}).filter(([key])=>!['email','phoneVerified','verifiedPhone'].includes(key)));
 await db.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2)',[id,profile]);await db.query('insert into app.telegram_phone_bindings(user_id,phone,telegram_subject) values($1,$2,$3)',[id,phone,'checkout-cancel-'+id]);await db.query("insert into app.sessions(token_hash,user_id,scope,auth_version,expires_at) values($1,$2,'app',0,clock_timestamp()+interval '1 hour')",[hash,id]);
 const profession=(await db.query("select id,name from app.specialist_categories where name='Сантехник' and active limit 1")).rows[0];assert.ok(profession);
 browser=await chromium.launch({headless:true});context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1080}});await context.addCookies([{name:'__Host-blizhniy_session',value:token,url:state.origin,secure:true,httpOnly:true,sameSite:'Lax'}]);page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>new URL(route.request().url()).origin===state.origin?route.continue():route.abort());
 await page.goto(state.origin+'/cabinet/zakazy');await page.getByText('Проверка отмены подготовки',{exact:true}).waitFor();
 const form={title:'Проверка отмены подготовки '+randomBytes(4).toString('hex'),description:'Синтетический заказ для проверки отмены подготовки оплаты.',cityName:'Краснодар',professionName:profession.name,professionId:profession.id,budget:'3500',contactPhone:phone,placementRightConfirmed:true};
 const saved=await api('/api/account/work-publications',{action:'create',kind:'workRequest',creationKey:randomUUID(),form},'PUT');assert.equal(saved.status,200);workId=saved.value.id;
 async function prepare(revision){const preview=await api('/api/account/work-request-checkout',{action:'testPreview',listingId:workId,expectedRevision:revision});assert.equal(preview.status,200);const q=preview.value.tariff;const result=await api('/api/account/work-request-checkout',{listingId:workId,expectedRevision:revision,creationKey:randomUUID(),expectedTariffId:q.id,expectedAmount:q.amount,expectedDurationDays:q.durationDays},'PUT');assert.equal(result.status,200);payments.push(result.value.id);return result.value.id;}
 const workPayment=await prepare(saved.value.revision),updated={...saved.value.form,title:form.title+' — изменён'};
 const blocked=await api('/api/account/work-publications',{action:'update',kind:'workRequest',publicationId:workId,expectedRevision:saved.value.revision,form:updated},'PUT');assert.equal(blocked.status,409);assert.equal(blocked.value.error.code,'CHECKOUT_ACTIVE');
 const checkouts=[{type:'workRequest',payment:workPayment},await synthetic('listing'),await synthetic('vacancy'),await synthetic('application')];
 let lost=false,recheckSession=false,releaseAuth,releaseLost,committed,authHeld;
 const cancellationMethods=[];
 page.on('request',request=>{
  if (new URL(request.url()).pathname==='/api/account/checkout-cancellation'&&request.postDataJSON()?.paymentId===checkouts[1].payment) {
   cancellationMethods.push(request.method());
  }
 });
 const captured=new Promise(resolve=>committed=resolve),authPaused=new Promise(resolve=>authHeld=resolve),authRelease=new Promise(resolve=>releaseAuth=resolve),lostRelease=new Promise(resolve=>releaseLost=resolve);
 await page.route('**/api/account/session',async route=>{if(recheckSession){authHeld();await authRelease;}await route.continue();});
 await page.route('**/api/account/checkout-cancellation',async route=>{if(!lost&&route.request().method()==='PUT'&&route.request().postDataJSON().paymentId===checkouts[1].payment){lost=true;const reply=await route.fetch();assert.equal(reply.status(),200);committed();await lostRelease;await route.abort('failed');}else await route.continue();});
 for(const item of checkouts){await page.setViewportSize(item.type==='application'?{width:390,height:844}:{width:1440,height:1080});await page.goto(state.origin+`/oplata/${item.payment}${item.type==='listing'?'':'?type='+item.type}`);
  const button=page.getByRole('button',{name:'Отменить подготовку оплаты',exact:true});await button.waitFor();await button.click();
  if(item.type==='listing'){
   await captured;recheckSession=true;await page.evaluate(()=>window.dispatchEvent(new Event('blizhniy-account-changed')));await authPaused;
   await page.getByText('Проверяем доступ. Данные заказа временно скрыты.',{exact:true}).waitFor();recheckSession=false;releaseAuth();
   const readback=page.getByRole('button',{name:'Проверить отмену',exact:true});await readback.waitFor();assert.equal(await readback.isDisabled(),false);
   assert.equal(await page.getByRole('button',{name:'Открыть локальный симулятор',exact:true}).isDisabled(),true);releaseLost();await readback.click();
  }
  await page.getByRole('heading',{name:item.type==='application'?'Оплата не завершена':'Платёж отменён',exact:true}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:join(artifacts,item.type+'-cancelled.png'),fullPage:true});assert.equal((await db.query('select status from app.payment_orders where id=$1',[item.payment])).rows[0].status,'failed');
  assert.equal((await db.query('select count(*)::int as n from app.payment_checkout_cancellations where payment_id=$1',[item.payment])).rows[0].n,1);assert.equal((await db.query('select count(*)::int as n from app.payment_dispatch_anchors where intent_id=$1',[item.payment])).rows[0].n,0);
 }
 assert.deepEqual(cancellationMethods,['PUT','POST']);
 assert.equal(lost,true);const edited=await api('/api/account/work-publications',{action:'update',kind:'workRequest',publicationId:workId,expectedRevision:saved.value.revision,form:updated},'PUT');assert.equal(edited.status,200);assert.equal(edited.value.revision,'2');
 const replacement=await prepare('2');assert.notEqual(replacement,workPayment);const cancelled=await api('/api/account/checkout-cancellation',{paymentId:replacement,targetType:'workRequest'},'PUT');assert.equal(cancelled.status,200);
 assert.equal((await db.query('select count(*)::int as n from local_primary.provider_payments where intent_id=any($1::uuid[])',[payments])).rows[0].n,0);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,compiledHttp:true,browser:true,targetTypes:4,workEditUnblocked:true,newPreparationAllowed:true,lostAcknowledgementRecovered:true,sessionRevalidationRecovered:true,providerCalls:false,productionTouched:false,artifacts}));
}catch(error){if(page)await page.screenshot({path:join(artifacts,'failure.png'),fullPage:true});console.log(JSON.stringify({artifacts}));throw error;}
finally{
 await browser?.close();
 for(const payment of payments){await db.query('begin');try{await db.query("select set_config('blizhniy.checkout_cancel_session',$1,true)",[hash]);await db.query('insert into app.payment_checkout_cancellations(payment_id) values($1) on conflict(payment_id) do nothing',[payment]);await db.query('commit');}catch(error){await db.query('rollback');throw error;}}
 if(workId)await db.query("update app.work_publications set status='archived',deleted_at=clock_timestamp() where id=$1 and author_id=$2",[workId,id]);
 await db.query('delete from app.sessions where user_id=$1',[id]);await db.query('update app.users set is_blocked=true where id=$1 and email=$2',[id,id+'@local.invalid']);await db.end();
}
