// Real compiled local HTTP/SQL/browser proof with synthetic data; no provider calls.
import assert from 'node:assert/strict';import {readFile,mkdtemp} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {randomBytes,randomUUID,randomInt} from 'node:crypto';import {createRequire} from 'node:module';import {request as httpsRequest} from 'node:https';
import pg from 'pg';import {chromium} from 'playwright';
import {prepareLocalPrimaryFixture,localPrimaryDatabaseConfig,stateDirectory} from './local-primary-fixture.mjs';
const load=createRequire(import.meta.url)('./local-primary-modules.cjs').loadLocalPrimaryModule;
const state=await prepareLocalPrimaryFixture();assert.equal(state.origin,'https://127.0.0.1:3045');
const config=localPrimaryDatabaseConfig(state,'owner');assert.equal(config.host,'127.0.0.1');
const db=new pg.Client(config);await db.connect();const ca=await readFile(join(stateDirectory,'tls-cert.pem'));
const id=randomUUID(),token=randomBytes(32).toString('hex'),paymentId=randomUUID(),providerId=randomUUID(),title='Проверка управления заказом '+randomBytes(4).toString('hex');
let workId,browser,page,artifacts;const errors=[];
async function status(path){return new Promise((resolve,reject)=>{const request=httpsRequest(state.origin+path,{ca},response=>{response.resume();response.on('end',()=>resolve(response.statusCode));});request.setTimeout(15000,()=>request.destroy(Error('Local request timed out')));request.on('error',reject);request.end();});}
const publicStatus=()=>status('/rabota/zakazy/'+workId);
try{
 const readyBy=Date.now()+30000;
 for(;;){try{if(await status('/api/ready')===200)break;}catch(error){assert.ok(error&&['ECONNREFUSED','ECONNRESET','ETIMEDOUT'].includes(error.code),'Unexpected owned local readiness transport error');}assert.ok(Date.now()<readyBy,'Owned local server did not become ready');await new Promise(resolve=>setTimeout(resolve,100));}
 const phone='+7999'+String(randomInt(1000000,9999999)),{hashSessionToken}=load('identity');
 await db.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',[id,id+'@local.invalid','scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128)]);
 const profile=Object.fromEntries(Object.entries({...load('cabinet-profile').createDefaultCabinetProfile({name:'Проверка заказчика',email:id+'@local.invalid'}),phone}).filter(([key])=>!['email','phoneVerified','verifiedPhone'].includes(key)));
 await db.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2)',[id,profile]);await db.query('insert into app.telegram_phone_bindings(user_id,phone,telegram_subject) values($1,$2,$3)',[id,phone,'work-owner-'+id]);
 await db.query("insert into app.sessions(token_hash,user_id,scope,auth_version,expires_at) values($1,$2,'app',0,clock_timestamp()+interval '1 hour')",[hashSessionToken(token),id]);
 const ref=(await db.query("select c.id as city,p.id as profession,p.name from app.cities c cross join app.specialist_categories p where c.name='Краснодар' and p.name='Сантехник' and p.active limit 1")).rows[0];assert.ok(ref);
 const form=load('work-publication-contract').parseWorkPublicationForm('workRequest',{kind:'workRequest',title,description:'Синтетический заказ для локальной проверки снятия, восстановления и удаления. Реальные услуги и платежи отсутствуют.',cityName:'Краснодар',professionName:ref.name,professionId:ref.profession,budget:'3500.00',contactPhone:phone,placementRightConfirmed:true});
 assert.deepEqual(load('work-checkout-validation').checkWorkCheckoutForm(form),[]);
 await db.query('begin');try{
  workId=(await db.query("insert into app.work_publications(author_id,kind,creation_key,form,city_id,profession_id,status,is_paid,created_at,published_at,expires_at) values($1,'workRequest',$2,$3,$4,$5,'published',true,clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '30 days') returning id",[id,randomUUID(),form,ref.city,ref.profession])).rows[0].id;
  const body=JSON.stringify({amount:{value:'199.00',currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://fixture.example.invalid/return'},metadata:{localPaymentId:paymentId,targetId:workId,targetType:'workRequest',tariffId:'work-request-publication'}});
  await new(load('postgres-payment-intents').PostgresPaymentIntentStore)({transaction:work=>work({query:(sql,params)=>db.query(sql,params)})}).persistInTransaction({query:(sql,params)=>db.query(sql,params)},{id:paymentId,ownerId:id,targetType:'workRequest',targetId:workId,targetRevision:'1',tariffId:'work-request-publication',amount:'199.00',durationDays:30,shopId:'local-fixture-shop',isTest:true,requestBody:body});
  await db.query("insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,'workRequest',$4,1)",[paymentId,id,randomUUID(),workId]);
  await db.query('insert into app.payment_dispatch_anchors(intent_id) values($1)',[paymentId]);await db.query('insert into app.payment_provider_links(intent_id,provider_payment_id) values($1,$2)',[paymentId,providerId]);
  await db.query("update app.payment_orders set status='succeeded' where id=$1",[paymentId]);
  await db.query("insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,'succeeded',$3)",[paymentId,providerId,new Date(Date.now()-60000).toISOString()]);
  await db.query('insert into app.payment_fulfillments(intent_id,published_at,expires_at) select $1,published_at,expires_at from app.work_publications where id=$2',[paymentId,workId]);await db.query('commit');
 }catch(error){await db.query('rollback');throw error;}
 const before=(await db.query('select form,is_paid,published_at::text,expires_at::text from app.work_publications where id=$1',[workId])).rows[0];
 assert.equal(await publicStatus(),200);
 browser=await chromium.launch({headless:true});const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1080}});
 await context.addCookies([{name:'__Host-blizhniy_session',value:token,url:state.origin,secure:true,httpOnly:true,sameSite:'Lax'}]);page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>new URL(route.request().url()).origin===state.origin?route.continue():route.abort());
 await page.goto(state.origin+'/cabinet/zakazy');await page.getByText('Проверка заказчика',{exact:true}).waitFor();
 const card=page.getByRole('article').filter({has:page.getByRole('heading',{name:title,exact:true})});await card.waitFor();
 artifacts=await mkdtemp(join(tmpdir(),'blizhniy-work-owner-ui-'));
 await card.getByRole('button',{name:'Действия: '+title,exact:true}).click();const dialog=page.getByRole('dialog');await dialog.waitFor();
 await dialog.getByLabel('Причина',{exact:true}).fill('Локальная проверка снятия заказа.');await page.screenshot({path:join(artifacts,'desktop-dialog.png'),fullPage:true});
 let response=page.waitForResponse(response=>response.url().endsWith('/api/account/work-actions'));await dialog.getByRole('button',{name:'Подтвердить',exact:true}).click();assert.equal((await response).status(),200);await card.getByText('Архив',{exact:true}).waitFor();assert.equal(await publicStatus(),404);
 await card.getByRole('button',{name:'Действия: '+title,exact:true}).click();response=page.waitForResponse(response=>response.url().endsWith('/api/account/work-actions'));await dialog.getByRole('button',{name:'Подтвердить',exact:true}).click();assert.equal((await response).status(),200);await card.getByText('Опубликовано',{exact:true}).waitFor();assert.equal(await publicStatus(),200);
 await page.setViewportSize({width:390,height:844});await card.getByRole('button',{name:'Действия: '+title,exact:true}).click();await dialog.getByRole('button',{name:'Удалить',exact:true}).click();await dialog.getByLabel('Причина',{exact:true}).fill('Локальная проверка удаления заказа.');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(artifacts,'mobile-dialog.png'),fullPage:true});
 response=page.waitForResponse(response=>response.url().endsWith('/api/account/work-actions'));await dialog.getByRole('button',{name:'Подтвердить',exact:true}).click();assert.equal((await response).status(),200);await card.waitFor({state:'detached'});assert.equal(await publicStatus(),404);
 const after=(await db.query('select form,is_paid,published_at::text,expires_at::text from app.work_publications where id=$1',[workId])).rows[0];assert.deepEqual(after,before);
 assert.equal((await db.query('select count(*)::int as n from app.work_owner_actions where publication_id=$1',[workId])).rows[0].n,3);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,compiledHttp:true,browser:true,publicVisibility:true,originalPeriodPreserved:true,historyEvents:3,providerCalls:false,productionTouched:false,artifacts}));await context.close();
}catch(error){
 if(page&&artifacts){await page.screenshot({path:join(artifacts,'failure.png'),fullPage:true});console.log(JSON.stringify({artifacts,dialogs:await page.getByRole('dialog').count(),labels:await page.locator('dialog label').allTextContents(),textareas:await page.locator('dialog textarea').count()}));}
 throw error;
}finally{
 await browser?.close();
 // Preserve synthetic financial/journal evidence, retire the exact test account and publication.
 if(workId)await db.query("update app.work_publications set status='archived',deleted_at=coalesce(deleted_at,clock_timestamp()) where id=$1 and author_id=$2",[workId,id]);
 await db.query('delete from app.sessions where user_id=$1',[id]);await db.query('update app.users set is_blocked=true where id=$1 and email=$2',[id,id+'@local.invalid']);await db.end();
}
