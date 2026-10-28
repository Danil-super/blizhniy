// Two synthetic browser accounts, local provider only. Fixtures remain for manual review.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import pg from 'pg';
import {REGISTRATION_LEGAL_VERSIONS as legal} from '../src/lib/registration-legal.ts';
import {stateFile,stateDirectory,docker,localPrimaryDatabaseConfig} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
import {lockLocalPaymentTarget} from './local-primary-payment.mjs';

const state=readLocalPrimaryState(stateFile,process.cwd()),origin=state.origin;
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const browser=await chromium.launch({headless:true}),contexts=[],errors=[],external=[];
const headers={Origin:origin,'Content-Type':'application/json','X-Blizhniy-Request':'1','Sec-Fetch-Site':'same-origin'};
const axePath=createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const db=new pg.Client(localPrimaryDatabaseConfig(state,'owner'));await db.connect();
async function account(name){
 const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',viewport:{width:1440,height:1000}});contexts.push(context);
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(['http:','https:'].includes(url.protocol)&&url.origin!==origin){external.push(url.origin);return route.abort();}return route.continue();});
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.name));
 const email='application-chain-'+randomUUID()+'@local.invalid',password='SyntheticChain-'+randomUUID()+'!';
 assert.equal((await context.request.post(origin+'/api/account/register',{headers,data:{name,email,password,captchaToken:'',acceptedAgreement:true,acknowledgedPrivacy:true,agreementVersion:legal.agreement,privacyVersion:legal.privacy}})).status(),202);
 let token;const deadline=Date.now()+10000;
 while(!token&&Date.now()<deadline){
  for(const file of(await readdir(stateDirectory)).filter(file=>/^mail-[a-f0-9-]{36}\.json$/.test(file))){const mail=JSON.parse(await readFile(join(stateDirectory,file),'utf8'));if(mail.to===email)token=mail.text.match(/#token=([a-f0-9]{64})/)?.[1];}
  if(!token)await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.ok(token);assert.equal((await context.request.post(origin+'/api/account/confirm',{headers,data:{token}})).status(),200);
 await page.goto(origin+'/auth');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Пароль',{exact:true}).fill(password);
 await page.getByRole('button',{name:'Войти',exact:true}).click();await page.waitForURL(origin+'/');
 const session=await context.request.post(origin+'/api/account/session',{headers,data:{}});assert.equal(session.status(),200);const id=(await session.json()).user.id;
 const api=async(path,data,method='post',status=200)=>{const response=await context.request[method](origin+path,{headers,data:{expectedOwnerId:id,...data}});assert.equal(response.status(),status,`${method} ${path}`);return response.json();};
 return{context,page,id,api};
}
async function publication(actor,kind='workRequest'){
 const form={title:'Проверка отклика — '+randomUUID().slice(0,8),description:'Нужно заменить смеситель и проверить соединения.',cityName:'Краснодар',professionName:'Сантехник',contactPhone:'+79991112233',placementRightConfirmed:true,
  ...(kind==='vacancy'?{employerType:'person',organization:'Михаил',salary:'45000'}:{budget:'3500'})};
 const saved=await actor.api('/api/account/work-publications',{action:'create',kind,creationKey:randomUUID(),form},'put');
 const endpoint=kind==='vacancy'?'/api/account/vacancy-checkout':'/api/account/work-request-checkout';
 const q=await actor.api(endpoint,{action:'testPreview',listingId:saved.id,expectedRevision:saved.revision});
 const order=await actor.api(endpoint,{listingId:saved.id,expectedRevision:saved.revision,creationKey:randomUUID(),expectedTariffId:q.tariff.id,expectedAmount:q.tariff.amount,expectedDurationDays:q.tariff.durationDays},'put');
 await actor.api(endpoint,{action:'dispatch',paymentId:order.id});
 assert.equal((await actor.context.request.post(origin+`/__local/payment?intent=${order.id}&type=${kind}`,{headers:{Origin:origin,'Sec-Fetch-Site':'same-origin'},form:{action:'succeed'}})).status(),200);
 return saved;
}
async function application(actor,target,kind='workRequest'){
 const page=actor.page;await page.goto(origin+(kind==='vacancy'?'/vakansiya/':'/rabota/zakazy/')+target.id);
 const composer=page.getByRole('region',{name:'Отклик на публикацию'});await composer.getByLabel('Сообщение',{exact:true}).fill('Могу выполнить работу на этой неделе.');
 const response=page.waitForResponse(response=>response.url()===origin+'/api/account/applications'&&response.request().method()==='PUT');
 await composer.getByRole('button',{name:'Сохранить отклик',exact:true}).click();const http=await response;assert.equal(http.status(),200);const saved=await http.json();assert.equal(saved.paid,false);assert.equal(saved.sentAt,null);
 await composer.getByRole('button',{name:'Оплатить отклик (локальная TEST)',exact:true}).waitFor();return saved;
}
async function detail(actor,id){
 await actor.page.goto(origin+'/cabinet/otkliki');const list=actor.page.getByRole('list',{name:'Список своих откликов'});
 const row=list.locator('li').filter({has:actor.page.locator(`a[href$="/${id}"]`)});await row.getByRole('button',{name:'Подробнее',exact:true}).click();
 return actor.page.getByRole('region',{name:'Детали отклика'});
}
async function responsive(page,region,label){
 await page.addScriptTag({path:axePath});
 for(const width of [320,768,1024,1440]){
  await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const violations=await region.evaluate(async node=>(await window.axe.run(node,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>v.id));assert.deepEqual(violations,[]);
  await page.screenshot({path:`/tmp/blizhniy-application-${label}-${width}.png`,fullPage:true});
 }
}
try{
 assert.equal((await db.query("select count(*)::int as n from blizhniy_meta.migrations where name='0030-application-withdrawals.sql'")).rows[0].n,1);
 const employer=await account('Михаил'),applicant=await account('Анна'),otherApplicant=await account('Елена');
 const specialist=await applicant.api('/api/account/service-publications',{action:'create',kind:'specialist',creationKey:randomUUID(),form:{title:'Анна',description:'Выполняю монтаж и ремонт сантехники, соблюдаю сроки.',professionName:'Сантехник',cityName:'Краснодар',price:'1500',contactPhone:'+79990000000',placementRightConfirmed:true}},'put');assert.equal(specialist.paid,false);
 const work=await publication(employer),saved=await application(applicant,work);
 await employer.api('/api/account/applications',{action:'read',applicationId:saved.id},'post',404);
 const details=await detail(applicant,work.id);await details.getByRole('button',{name:'Редактировать',exact:true}).click();
 const editor=applicant.page.getByRole('region',{name:'Редактирование отклика'});await editor.getByRole('button',{name:'Сохранить изменения',exact:true}).waitFor({state:'visible'});
 await editor.getByLabel('Сообщение',{exact:true}).fill('После уточнения готова приступить завтра.');
 const editResponse=applicant.page.waitForResponse(response=>response.url()===origin+'/api/account/applications'&&response.request().method()==='PUT');
 await editor.getByRole('button',{name:'Сохранить изменения',exact:true}).click();assert.equal((await editResponse).status(),200);
 await details.getByText('После уточнения готова приступить завтра.',{exact:true}).waitFor();
 const pay=applicant.page.getByRole('region',{name:'Локальная TEST-оплата отклика'});
 await pay.getByRole('button',{name:'Оплатить отклик (локальная TEST)',exact:true}).click();await applicant.page.waitForURL(/\/oplata\/[a-f0-9-]{36}\?type=application$/);
 const paymentId=new URL(applicant.page.url()).pathname.split('/').at(-1),payment=applicant.page.getByRole('region',{name:'Оплата отклика'});
 await payment.getByRole('heading',{name:'Заказ ожидает оплаты',exact:true}).waitFor();await responsive(applicant.page,payment,'payment');
 await payment.getByRole('button',{name:'Открыть локальную TEST-оплату',exact:true}).click();await applicant.page.waitForURL(/\/__local\/payment\?/);
 // Real second PostgreSQL session holds the actual employer row, not a mocked error.
 const blocker=new pg.Client(localPrimaryDatabaseConfig(state,'owner'));await blocker.connect();
 try{
  await blocker.query('begin');await blocker.query("set local lock_timeout='2s';set local statement_timeout='5s'");await blocker.query('select id from app.users where id=$1 for update',[employer.id]);
  const failure=applicant.page.waitForResponse(response=>new URL(response.url()).pathname==='/__local/payment'&&response.request().method()==='POST');
  await applicant.page.getByRole('button',{name:'Подтвердить успешную оплату',exact:true}).click();assert.equal((await failure).status(),503);
  const row=(await db.query('select a.is_paid,a.sent_at,o.status from app.applications a join app.payment_orders o on o.target_id=a.id where a.id=$1 and o.id=$2',[saved.id,paymentId])).rows[0];assert.deepEqual(row,{is_paid:false,sent_at:null,status:'succeeded'});
  assert.equal((await db.query('select count(*)::int as n from local_primary.application_deliveries where intent_id=$1',[paymentId])).rows[0].n,0);
 }finally{await blocker.query('rollback');await blocker.end();}
 await applicant.page.goto(origin+`/__local/payment?intent=${paymentId}&type=application`);await applicant.page.getByRole('button',{name:'Подтвердить успешную оплату',exact:true}).click();
 await applicant.page.getByText('Оплата подтверждена сервером, отклик доставлен.',{exact:true}).waitFor();
 await applicant.page.getByRole('link',{name:'Статус заказа',exact:true}).click();await applicant.page.getByRole('heading',{name:'Отклик доставлен',exact:true}).waitFor();
 assert.equal((await db.query('select count(*)::int as n from local_primary.application_deliveries where intent_id=$1',[paymentId])).rows[0].n,1);
 await employer.page.goto(origin+'/cabinet/otkliki');await employer.page.getByRole('button',{name:'Входящие отклики',exact:true}).click();
 const incoming=employer.page.getByRole('list',{name:'Список входящих откликов'}).locator('li').filter({has:employer.page.locator(`a[href$="/${work.id}"]`)});
 await incoming.getByRole('button',{name:'Подробнее',exact:true}).click();const received=employer.page.getByRole('region',{name:'Детали отклика'});await received.getByText('Просмотрен',{exact:true}).waitFor();
 await responsive(employer.page,received,'recipient');await received.getByRole('button',{name:'Выбрать исполнителя',exact:true}).click();await received.getByRole('button',{name:'Подтвердить выбор',exact:true}).click();await received.getByText('Исполнитель выбран',{exact:true}).waitFor();
 const selected=await applicant.api('/api/account/applications',{action:'read',applicationId:saved.id});assert.equal(selected.status,'selected');assert.equal(selected.message,'После уточнения готова приступить завтра.');
 assert.equal((await db.query('select count(*)::int as n from app.notifications where user_id=$1 and event_key=$2',[applicant.id,`application_decision:${saved.id}:selected`])).rows[0].n,1);
 // The new single-click route saves the exact message then opens its payment page.
 await otherApplicant.api('/api/account/service-publications',{action:'create',kind:'specialist',creationKey:randomUUID(),form:{description:'Выполняю монтаж и ремонт сантехники, соблюдаю сроки.',professionName:'Сантехник',cityName:'Краснодар',price:'1500',contactPhone:'+79992223344',email:'specialist@example.invalid',placementRightConfirmed:true}},'put');
 const directWork=await publication(employer);await otherApplicant.page.goto(origin+'/rabota/zakazy/'+directWork.id);
 const composer=otherApplicant.page.getByRole('region',{name:'Отклик на публикацию'}),messageField=composer.getByLabel('Сообщение',{exact:true});
 await messageField.fill('а'.repeat(500));await messageField.press('End');await messageField.press('b');assert.equal((await messageField.inputValue()).length,500);assert.equal(await messageField.getAttribute('maxlength'),'500');
 await messageField.fill('Могу приехать завтра. Есть необходимые инструменты.');
 const createResponse=otherApplicant.page.waitForResponse(response=>response.url()===origin+'/api/account/applications'&&response.request().method()==='PUT');
 await composer.getByRole('button',{name:'Оплатить и отправить',exact:true}).click();assert.equal((await createResponse).status(),200);
 const direct=await(await createResponse).json();assert.equal(direct.message,'Могу приехать завтра. Есть необходимые инструменты.');await otherApplicant.page.waitForURL(/\/oplata\/[a-f0-9-]{36}\?type=application$/);
 await otherApplicant.page.getByRole('button',{name:'Открыть локальную TEST-оплату',exact:true}).click();await otherApplicant.page.waitForURL(/\/__local\/payment\?/);
 await otherApplicant.page.getByRole('button',{name:'Подтвердить успешную оплату',exact:true}).click();await otherApplicant.page.getByText('Оплата подтверждена сервером, отклик доставлен.',{exact:true}).waitFor();
 const peer=await application(applicant,directWork);
 const racePreview=await applicant.api('/api/account/application-checkout',{action:'preview',applicationId:peer.id,expectedRevision:peer.revision});
 const raceOrder=await applicant.api('/api/account/application-checkout',{applicationId:peer.id,expectedRevision:peer.revision,creationKey:randomUUID(),expectedTariffId:racePreview.tariff.id,expectedAmount:racePreview.tariff.amount},'put');
 await employer.page.goto(origin+'/cabinet/otkliki');await employer.page.getByRole('button',{name:'Входящие отклики',exact:true}).click();
 const directRow=employer.page.getByRole('list',{name:'Список входящих откликов'}).locator('li').filter({has:employer.page.locator(`a[href$="/${directWork.id}"]`)});
 await directRow.getByRole('button',{name:'Подробнее',exact:true}).click();const directDetails=employer.page.getByRole('region',{name:'Детали отклика'});await directDetails.getByText('Просмотрен',{exact:true}).waitFor();
 assert.equal(await directDetails.locator('a[href="tel:+79992223344"]').count(),1);assert.equal(await directDetails.locator('a[href="mailto:specialist%40example.invalid"]').count(),1);
 assert.equal(await directDetails.getByRole('button',{name:'Проверить отклик',exact:true}).count(),0);
 // Hold the actual runtime decision transaction before COMMIT. A provider
 // mutation starts while the committed order is still open and waits behind it.
 // Only a separate fresh read after acquiring the work lock observes closure.
 const locker=new pg.Client(localPrimaryDatabaseConfig(state,'owner')),waiting=new pg.Client(localPrimaryDatabaseConfig(state,'owner'));await locker.connect();await waiting.connect();
 let releaseChoice;const permitCommit=new Promise(resolve=>{releaseChoice=resolve;});
 try{
  Object.assign(process.env,{NODE_ENV:'test',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:origin,BLIZHNIY_LISTING_WORKFLOW:'postmoderation'});
  const load=createRequire(import.meta.url)('./local-primary-modules.cjs').loadLocalPrimaryModule;
  const sessionToken=(await employer.context.cookies(origin)).find(cookie=>cookie.name==='__Host-blizhniy_session')?.value;assert.ok(sessionToken);
  let decisionReady;const ready=new Promise(resolve=>{decisionReady=resolve;});
  const decisionDb={transaction:async work=>{await locker.query('begin');await locker.query('set local role blizhniy_runtime');try{const result=await work({query:(sql,values)=>locker.query(sql,values)});decisionReady();await permitCommit;await locker.query('commit');return result;}catch(error){await locker.query('rollback');throw error;}}};
  const current=await employer.api('/api/account/applications',{action:'read',applicationId:direct.id});
  const choosing=new(load('postgres-applications').PostgresApplicationStore)(decisionDb,{vacancyPostmoderation:true,specialistApplicationReady:true,localActions:true}).decide(sessionToken,employer.id,direct.id,current.revision,'selected');
  await Promise.race([ready,choosing.then(()=>{throw Error('Decision must wait for the commit barrier');}),new Promise((_,reject)=>setTimeout(()=>reject(Error('Decision did not reach commit barrier')),3000))]);
  await waiting.query('begin');await waiting.query("set local lock_timeout='5s'");
  let settled=false;const blocked=lockLocalPaymentTarget({query:(sql,values)=>waiting.query(sql,values)},raceOrder.id).then(()=>{settled=true;return null;},error=>{settled=true;return error;});
  const deadline=Date.now()+2000;let lockObserved=false;
  while(Date.now()<deadline&&!lockObserved){lockObserved=(await db.query("select wait_event_type='Lock' as waiting from pg_stat_activity where pid=$1",[waiting.processID])).rows[0]?.waiting===true;if(!lockObserved)await new Promise(resolve=>setTimeout(resolve,20));}
  assert.equal(lockObserved,true);assert.equal(settled,false);releaseChoice();assert.equal((await choosing).status,'selected');assert.ok(await blocked);await waiting.query('rollback');
 }finally{releaseChoice();await locker.end();await waiting.end();}
 assert.equal((await db.query('select count(*)::int as n from app.notifications where user_id=$1 and event_key=$2',[applicant.id,`application_other_selected:${peer.id}`])).rows[0].n,1);
 assert.equal((await employer.context.request.get(origin+'/rabota/zakazy/'+directWork.id)).status(),404);
 const closedDetail=await detail(applicant,directWork.id);await closedDetail.getByText('Заказ закрыт',{exact:true}).waitFor();assert.equal(await applicant.page.getByRole('region',{name:'Локальная TEST-оплата отклика'}).count(),0);
 await employer.page.goto(origin+'/cabinet/zakazy');await employer.page.getByText('Исполнитель выбран',{exact:true}).first().waitFor();
 await employer.page.goto(origin+'/rabota/zakazy/sozdat');const orderForm=employer.page.getByRole('form',{name:'Создание заказа'});await orderForm.locator('[name="phone"]').waitFor();
 assert.equal(await orderForm.getByLabel('Район',{exact:true}).count(),0);
 const phone=orderForm.locator('[name="phone"]');await phone.fill('+79001234567');await phone.press('End');for(let i=0;i<25;i++)await phone.press('Backspace');assert.equal(await phone.inputValue(),'');
 await phone.fill('+79011234567');assert.equal(await phone.inputValue(),'+7-(901)-123-45-67');
 await employer.page.goto(origin+'/rabota');assert.equal(await employer.page.getByText('Автор заказа',{exact:true}).count(),0);
 // A lost create response must not offer payment after somebody else was chosen.
 const recoveryWork=await publication(employer),winnerPreview=await otherApplicant.api('/api/account/applications',{action:'preview',kind:'workRequest',targetId:recoveryWork.id});
 const recoveryWinner=await otherApplicant.api('/api/account/applications',{action:'create',input:{kind:'workRequest',targetId:recoveryWork.id,creationKey:randomUUID(),expectedTargetRevision:winnerPreview.target.revision,specialistId:winnerPreview.specialist.id,expectedSpecialistRevision:winnerPreview.specialist.revision,message:'Готова выполнить заказ.'}},'put');
 const winnerQuote=await otherApplicant.api('/api/account/application-checkout',{action:'preview',applicationId:recoveryWinner.id,expectedRevision:recoveryWinner.revision});
 const winnerOrder=await otherApplicant.api('/api/account/application-checkout',{applicationId:recoveryWinner.id,expectedRevision:recoveryWinner.revision,creationKey:randomUUID(),expectedTariffId:winnerQuote.tariff.id,expectedAmount:winnerQuote.tariff.amount},'put');await otherApplicant.api('/api/account/application-checkout',{action:'dispatch',paymentId:winnerOrder.id});
 assert.equal((await otherApplicant.context.request.post(origin+`/__local/payment?intent=${winnerOrder.id}&type=application`,{headers:{Origin:origin,'Sec-Fetch-Site':'same-origin'},form:{action:'succeed'}})).status(),200);
 await applicant.page.goto(origin+'/rabota/zakazy/'+recoveryWork.id);const recovering=applicant.page.getByRole('region',{name:'Отклик на публикацию'});await recovering.getByLabel('Сообщение',{exact:true}).fill('Сообщение с потерянным ответом.');
 let unknownSaved,markLost;const lostComplete=new Promise(resolve=>{markLost=resolve;});const lostResponse=async route=>{
  if(route.request().method()!=='PUT'||route.request().postDataJSON()?.action!=='create')return route.continue();
  const response=await route.fetch();assert.equal(response.status(),200);unknownSaved=await response.json();await route.abort('failed');markLost();
 };await applicant.context.route('**/api/account/applications',lostResponse);
 await recovering.getByRole('button',{name:'Оплатить и отправить',exact:true}).click();await lostComplete;await recovering.getByRole('button',{name:'Проверить сохранение',exact:true}).waitFor();assert.ok(unknownSaved);
 await applicant.context.unroute('**/api/account/applications',lostResponse);
 const chosen=await employer.api('/api/account/applications',{action:'read',applicationId:recoveryWinner.id});await employer.api('/api/account/applications',{action:'decide',applicationId:chosen.id,expectedRevision:chosen.revision,state:'selected'},'put');
 await recovering.getByRole('button',{name:'Проверить сохранение',exact:true}).click();await recovering.getByRole('heading',{name:'Заказ закрыт',exact:true}).waitFor();
 assert.equal(await recovering.getByRole('region',{name:'Локальная TEST-оплата отклика'}).count(),0);
 assert.equal((await db.query("select count(*)::int as n from app.payment_orders where target_type='application' and target_id=$1",[unknownSaved.id])).rows[0].n,0);
 const vacancy=await publication(employer,'vacancy'),withdrawn=await application(applicant,vacancy,'vacancy');const withdrawal=await detail(applicant,vacancy.id);
 await withdrawal.getByRole('button',{name:'Отозвать отклик',exact:true}).click();await applicant.page.getByRole('button',{name:'Подтвердить отзыв',exact:true}).click();await withdrawal.getByText('Отозван',{exact:true}).waitFor();
 assert.equal((await applicant.api('/api/account/applications',{action:'read',applicationId:withdrawn.id})).withdrawn,true);
 await employer.api('/api/account/applications',{action:'read',applicationId:withdrawn.id},'post',404);
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 console.log(JSON.stringify({status:'passed',accounts:3,edit:true,withdrawal:true,directPayment:true,messageLimit:500,phoneFullyEditable:true,noDistrict:true,noAuthorLabel:true,clickableContacts:true,realEmployerRowLock:true,verifiedCaptureRetry:true,decisionNotification:true,otherApplicantNotification:true,closedOrder404:true,responsive:[320,768,1024,1440],axeSeriousCritical:0,productionTouched:false,realProviderCalls:false}));
}finally{await db.end();for(const context of contexts)await context.close();await browser.close();}
