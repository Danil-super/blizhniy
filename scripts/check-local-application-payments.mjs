// Owned local PostgreSQL only; all synthetic data/schema/grants are rolled back.
import assert from 'node:assert/strict';import {randomUUID,randomBytes} from 'node:crypto';import {readFile} from 'node:fs/promises';import {createRequire} from 'node:module';import pg from 'pg';
import {stateFile,localPrimaryDatabaseConfig,docker} from './local-primary-fixture.mjs';import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';import {localPrimaryPaymentHandler} from './local-primary-payment.mjs';
const load=createRequire(import.meta.url)('./local-primary-modules.cjs').loadLocalPrimaryModule,state=readLocalPrimaryState(stateFile,process.cwd());
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const owner=new pg.Client(localPrimaryDatabaseConfig(state,'owner'));await owner.connect();
Object.assign(process.env,{NODE_ENV:'test',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:state.origin,BLIZHNIY_LISTING_WORKFLOW:'postmoderation'});
const origin='https://xn----9sbphbgks4a4a.xn--p1ai',endpoint='/api/account/application-checkout';let count=0,checks=0;
const request=(path,token,body,method='POST',form=false)=>new Request(origin+path,{method,headers:{host:new URL(origin).host,origin,'sec-fetch-site':'same-origin','content-type':form?'application/x-www-form-urlencoded':'application/json','x-blizhniy-request':'1','x-real-ip':'192.0.2.123',cookie:'__Host-blizhniy_session='+token},...(method==='GET'?{}:{body:form?new URLSearchParams(body):JSON.stringify(body)})});
try{
 await owner.query('begin');
 if(!(await owner.query("select to_regclass('app.application_withdrawals') as name")).rows[0].name){const sql=await readFile(new URL('../database/migrations/0030-application-withdrawals.sql',import.meta.url),'utf8');await owner.query(sql.replace(/^begin;\r?\n/m,'').replace(/commit;\s*$/,''));}
 await owner.query('grant select on app.application_withdrawals to blizhniy_runtime;grant insert(application_id,owner_id,withdrawn_revision) on app.application_withdrawals to blizhniy_runtime');
 const tx={query:(sql,values)=>owner.query(sql,values)},db=restricted=>({...tx,transaction:async work=>{const key='app_payment_'+(++count);await owner.query('savepoint '+key);try{if(restricted){await owner.query('set local role blizhniy_runtime');await owner.query("select set_config('blizhniy.application_session','',true)");}const result=await work(tx);if(restricted)await owner.query('reset role');await owner.query('release savepoint '+key);return result;}catch(error){await owner.query('rollback to savepoint '+key);await owner.query('reset role');await owner.query('release savepoint '+key);throw error;}}});
 const runtime=db(true),trusted=db(false),context={state,ownerDb:trusted,runtimeDb:runtime,load};
 const apps=new(load('postgres-applications').PostgresApplicationStore)(runtime,{specialistApplicationReady:true,vacancyPostmoderation:true,localActions:true});
 async function account(){const id=(await owner.query('insert into app.users(email,password_hash,email_verified_at) values($1,$2,clock_timestamp()) returning id',[`app-payment-${randomUUID()}@example.invalid`,`scrypt$131072$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`])).rows[0].id,token=randomBytes(32).toString('hex');await owner.query("insert into app.sessions(token_hash,user_id,scope,auth_version) values($1,$2,'app',0)",[load('identity').hashSessionToken(token),id]);await owner.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2::jsonb)',[id,JSON.stringify({name:'Локальный мастер'})]);return{id,token};}
 const employer=await account(),applicant=await account(),foreign=await account();
 const form={title:'Локальный мастер',description:'Выполняю монтаж и ремонт сантехники, соблюдаю сроки.',professionName:'Сантехник',cityName:'Краснодар',price:'1500',contactPhone:'+79990000000',placementRightConfirmed:true};
 await new(load('postgres-service-publications').PostgresServicePublicationStore)(runtime,{specialistProfileIdentity:true}).create(applicant.token,applicant.id,'specialist',randomUUID(),form);
 const call=(path,actor,body,method='POST')=>localPrimaryPaymentHandler(request(path,actor.token,{expectedOwnerId:actor.id,...body},method),context);
 const pay=(id,type,action='succeed',actor=applicant)=>localPrimaryPaymentHandler(request(`/__local/payment?intent=${id}&type=${type}`,actor.token,{action},'POST',true),context);
 async function target(kind='workRequest'){
  const saved=await new(load('postgres-work-publications').PostgresWorkPublicationStore)(runtime).create(employer.token,employer.id,kind,randomUUID(),{title:'Синтетическая публикация для отклика',description:'Нужно заменить смеситель и проверить соединения.',cityName:'Краснодар',professionName:'Сантехник',contactPhone:'+79991112233',placementRightConfirmed:true,
   ...(kind==='vacancy'?{employerType:'person',organization:'Иван',salary:'45000'}:{budget:'3500'})});
  const endpoint=kind==='vacancy'?'/api/account/vacancy-checkout':'/api/account/work-request-checkout';
  const q=await(await call(endpoint,employer,{action:'testPreview',listingId:saved.id,expectedRevision:saved.revision})).json();
  const order=await(await call(endpoint,employer,{listingId:saved.id,expectedRevision:saved.revision,creationKey:randomUUID(),expectedTariffId:q.tariff.id,expectedAmount:q.tariff.amount,expectedDurationDays:q.tariff.durationDays},'PUT')).json();
  assert.equal((await call(endpoint,employer,{action:'dispatch',paymentId:order.id})).status,200);assert.equal((await pay(order.id,kind,'succeed',employer)).status,200);return saved;
 }
 async function application(kind='workRequest'){const work=await target(kind),preview=await apps.preview(applicant.token,applicant.id,kind,work.id);return apps.create(applicant.token,applicant.id,{kind,targetId:work.id,creationKey:randomUUID(),expectedTargetRevision:preview.target.revision,specialistId:preview.specialist.id,expectedSpecialistRevision:preview.specialist.revision,message:'Могу выполнить эту работу.'});}
 async function prepare(item){const response=await call(endpoint,applicant,{action:'preview',applicationId:item.id,expectedRevision:item.revision});assert.ok(response,'Application checkout must be handled');assert.equal(response.status,200);const q=await response.json();assert.equal(q.tariff.id,'job-response');assert.equal(q.tariff.durationDays,null);const input={applicationId:item.id,expectedRevision:item.revision,creationKey:randomUUID(),expectedTariffId:q.tariff.id,expectedAmount:q.tariff.amount};const saved=await call(endpoint,applicant,input,'PUT');assert.equal(saved.status,200);return{item,input,order:await saved.json()};}
 const row=async id=>(await owner.query('select status,is_paid,sent_at::text from app.applications where id=$1',[id])).rows[0];
 const dispatch=f=>call(endpoint,applicant,{action:'dispatch',paymentId:f.order.id});
 async function edit(item,message='Уточнение: могу приступить завтра.'){
  const preview=await apps.preview(applicant.token,applicant.id,item.target.kind,item.target.id);
  return apps.update(applicant.token,applicant.id,{applicationId:item.id,expectedRevision:item.revision,expectedTargetRevision:preview.target.revision,specialistId:preview.specialist.id,expectedSpecialistRevision:preview.specialist.revision,message});
 }
 const receiptCount=async id=>(await owner.query('select count(*)::int as n from local_primary.application_deliveries where intent_id=$1',[id])).rows[0].n;
 const eventCount=async key=>(await owner.query('select count(*)::int as n from app.notifications where event_key=$1',[key])).rows[0].n;
 async function captured(f){assert.equal((await dispatch(f)).status,200);assert.equal((await pay(f.order.id,'application')).status,200);return f;}
 async function check(name,work){await work();checks++;console.log(JSON.stringify({check:name,status:'passed'}));}
 await check('prepare is a null-duration DB-tariff purchase, exact replay and no delivery before verified capture',async()=>{
  const f=await prepare(await application());assert.equal(f.order.durationDays,null);assert.equal((await row(f.item.id)).is_paid,false);
  const replay=await call(endpoint,applicant,f.input,'PUT');assert.equal(replay.status,200);assert.equal((await replay.json()).id,f.order.id);
  await assert.rejects(apps.read(employer.token,employer.id,f.item.id));
 });
 await check('pending payment remains private; created and pending orders prevent edits and withdrawal',async()=>{
  const f=await prepare(await application());
  for(const phase of ['created','pending']){
   if(phase==='pending'){assert.equal((await dispatch(f)).status,200);assert.equal((await pay(f.order.id,'application','pending')).status,200);}
   await assert.rejects(edit(f.item),error=>error.name==='ApplicationConflictError');
   await assert.rejects(apps.withdraw(applicant.token,applicant.id,f.item.id,f.item.revision));
   assert.deepEqual(await row(f.item.id),{status:'pending_payment',is_paid:false,sent_at:null});
   await assert.rejects(apps.read(employer.token,employer.id,f.item.id));assert.equal(await receiptCount(f.order.id),0);
  }
 });
 await check('verified capture delivers once, recipient decisions notify once and cross-owner access is denied',async()=>{
  const f=await captured(await prepare(await application())),sent=await apps.read(employer.token,employer.id,f.item.id);
  assert.equal(sent.status,'sent');assert.equal(sent.paid,true);assert.ok(sent.sentAt);assert.equal(sent.revision,'2');
  assert.equal(await receiptCount(f.order.id),1);assert.equal(await eventCount('application_paid:'+f.item.id),1);
  assert.equal((await pay(f.order.id,'application')).status,200);assert.equal(await receiptCount(f.order.id),1);assert.equal(await eventCount('application_paid:'+f.item.id),1);
  await assert.rejects(apps.read(foreign.token,foreign.id,f.item.id));assert.equal(await(await call(endpoint,foreign,{action:'order',paymentId:f.order.id})).json(),null);
  assert.equal((await call(endpoint,foreign,{action:'dispatch',paymentId:f.order.id})).status,404);assert.equal((await pay(f.order.id,'application','succeed',foreign)).status,404);
  const viewed=await apps.decide(employer.token,employer.id,sent.id,sent.revision,'viewed');assert.equal(viewed.status,'viewed');
  const selected=await apps.decide(employer.token,employer.id,viewed.id,viewed.revision,'selected');assert.equal(selected.status,'selected');
  assert.equal((await apps.decide(employer.token,employer.id,viewed.id,viewed.revision,'selected')).revision,selected.revision);
  assert.equal(await eventCount('application_decision:'+f.item.id+':selected'),1);
  await assert.rejects(apps.withdraw(applicant.token,applicant.id,f.item.id,selected.revision));
  await owner.query("update app.payment_orders set status='refunded' where id=$1",[f.order.id]);
  assert.deepEqual(await new(load('postgres-application-fulfillment').PostgresApplicationFulfillmentStore)(trusted).fulfill(f.order.id),{state:'blocked',reason:'capture_required'});
  assert.equal(await receiptCount(f.order.id),1);assert.equal((await row(f.item.id)).status,'selected');
 });
 await check('confirmed cancellation permits exact-CAS editing and immutable owner withdrawal without deleting history',async()=>{
  const f=await prepare(await application());assert.equal((await dispatch(f)).status,200);assert.equal((await pay(f.order.id,'application','cancel')).status,200);
  const edited=await edit(f.item);assert.equal(edited.revision,'2');assert.equal(edited.message,'Уточнение: могу приступить завтра.');
  await assert.rejects(edit(f.item));await assert.rejects(apps.withdraw(foreign.token,foreign.id,edited.id,edited.revision));
  const withdrawn=await apps.withdraw(applicant.token,applicant.id,edited.id,edited.revision);assert.equal(withdrawn.withdrawn,true);
  assert.equal((await apps.withdraw(applicant.token,applicant.id,edited.id,edited.revision)).withdrawn,true);
  assert.equal((await call(endpoint,applicant,{action:'preview',applicationId:edited.id,expectedRevision:edited.revision})).status,409);
  await assert.rejects(edit(edited));assert.equal((await row(edited.id)).is_paid,false);
  await assert.rejects(runtime.transaction(tx=>tx.query('delete from app.application_withdrawals where application_id=$1',[edited.id])),error=>error.code==='42501');
  await assert.rejects(runtime.transaction(tx=>tx.query('update app.application_withdrawals set withdrawn_revision=99 where application_id=$1',[edited.id])),error=>error.code==='42501');
 });
 await check('withdrawal requires a live same-owner context and cannot mark an active payment',async()=>{
  const item=await application();
  await assert.rejects(runtime.transaction(tx=>tx.query('insert into app.application_withdrawals(application_id,owner_id,withdrawn_revision) values($1,$2,1)',[item.id,applicant.id])),error=>error.code==='42501');
  await assert.rejects(runtime.transaction(async tx=>{await tx.query("select set_config('blizhniy.application_session',$1,true)",[load('identity').hashSessionToken(foreign.token)]);await tx.query('insert into app.application_withdrawals(application_id,owner_id,withdrawn_revision) values($1,$2,1)',[item.id,applicant.id]);}),error=>error.code==='42501');
  const f=await prepare(item);
  await assert.rejects(runtime.transaction(async tx=>{await tx.query("select set_config('blizhniy.application_session',$1,true)",[load('identity').hashSessionToken(applicant.token)]);await tx.query('insert into app.application_withdrawals(application_id,owner_id,withdrawn_revision) values($1,$2,1)',[item.id,applicant.id]);}),error=>error.code==='23514');
  assert.equal(await receiptCount(f.order.id),0);
 });
 await check('tariff changes before first dispatch cannot charge a stale offer; known provider recovery keeps immutable bytes',async()=>{
  const f=await prepare(await application()),original=(await owner.query('select price::text from app.tariffs where id=$1',['job-response'])).rows[0].price;
  await owner.query("update app.tariffs set price=price+1 where id='job-response'");assert.notEqual((await dispatch(f)).status,200);
  assert.equal((await owner.query('select count(*)::int as n from app.payment_provider_links where intent_id=$1',[f.order.id])).rows[0].n,0);
  await owner.query("update app.tariffs set price=$1 where id='job-response'",[original]);assert.equal((await dispatch(f)).status,200);
  const bytes=(await owner.query('select request_body from app.payment_checkout_intents where id=$1',[f.order.id])).rows[0].request_body;
  await owner.query("update app.tariffs set price=price+1 where id='job-response'");assert.equal((await dispatch(f)).status,200);
  assert.equal((await owner.query('select request_body from app.payment_checkout_intents where id=$1',[f.order.id])).rows[0].request_body,bytes);
  await owner.query("update app.tariffs set price=$1 where id='job-response'",[original]);
 });
 for(const change of ['refund','revision','profession','city','deletion'])await check('capture cannot deliver after target '+change,async()=>{
  const f=await prepare(await application());assert.equal((await dispatch(f)).status,200);
  const target=f.item.target.id;
  if(change==='refund')await owner.query("update app.payment_orders set status='refunded' where id in(select id from app.payment_checkout_intents where target_id=$1 and target_type='workRequest')",[target]);
  if(change==='revision')await owner.query('update app.work_publications set revision=revision+1 where id=$1',[target]);
  if(change==='profession')await owner.query('update app.specialist_categories set active=false where id=(select profession_id from app.work_publications where id=$1)',[target]);
  if(change==='city')await owner.query("update app.cities set name=name||' — изменён' where id=(select city_id from app.work_publications where id=$1)",[target]);
  if(change==='deletion')await owner.query("update app.work_publications set status='archived',deleted_at=clock_timestamp() where id=$1",[target]);
  assert.equal((await pay(f.order.id,'application')).status,200);assert.equal((await row(f.item.id)).is_paid,false);assert.equal(await receiptCount(f.order.id),0);
  assert.equal((await owner.query('select status from app.payment_orders where id=$1',[f.order.id])).rows[0].status,'succeeded');
  if(change==='profession')await owner.query('update app.specialist_categories set active=true where id=(select profession_id from app.work_publications where id=$1)',[target]);
  if(change==='city')await owner.query("update app.cities set name='Краснодар' where id=(select city_id from app.work_publications where id=$1)",[target]);
 });
 await check('runtime cannot forge capture, delivery, receipt or financial status',async()=>{
  const f=await prepare(await application());
  for(const sql of ['update app.applications set is_paid=true where id=$1','update app.applications set sent_at=clock_timestamp() where id=$1',"update app.payment_orders set status='succeeded' where id=$1",'delete from local_primary.application_deliveries where intent_id=$1'])await assert.rejects(runtime.transaction(tx=>tx.query(sql,[sql.includes('applications')?f.item.id:f.order.id])),error=>error.code==='42501');
 });
 await check('database failure after verified capture rolls delivery back and retry delivers exactly once',async()=>{
  const f=await prepare(await application());assert.equal((await dispatch(f)).status,200);
  let injected=false;
  const faultDb={...trusted,transaction:work=>trusted.transaction(tx=>work({query:async(sql,values)=>{
   if(sql.startsWith('insert into app.notifications')){injected=true;await tx.query('select 1/0');}
   return tx.query(sql,values);
  }}))};
  const failed=await localPrimaryPaymentHandler(request(`/__local/payment?intent=${f.order.id}&type=application`,applicant.token,{action:'succeed'},'POST',true),{...context,ownerDb:faultDb});
  assert.equal(injected,true);assert.equal(failed.status,503);assert.equal((await row(f.item.id)).is_paid,false);assert.equal(await receiptCount(f.order.id),0);assert.equal(await eventCount('application_paid:'+f.item.id),0);
  assert.equal((await owner.query('select status from app.payment_orders where id=$1',[f.order.id])).rows[0].status,'succeeded');
  assert.equal((await pay(f.order.id,'application')).status,200);assert.equal(await receiptCount(f.order.id),1);assert.equal(await eventCount('application_paid:'+f.item.id),1);
 });
 await check('expiry while creating notification rolls back delivery and does not fabricate success',async()=>{
  const f=await prepare(await application());assert.equal((await dispatch(f)).status,200);
  let injected=false;
  const faultDb={...trusted,transaction:work=>trusted.transaction(tx=>work({query:async(sql,values)=>{
   if(sql.startsWith('insert into app.notifications')){injected=true;await tx.query("update app.work_publications set published_at=clock_timestamp()-interval '1 day',expires_at=clock_timestamp()-interval '1 second' where id=$1",[f.item.target.id]);}
   return tx.query(sql,values);
  }}))};
  const failed=await localPrimaryPaymentHandler(request(`/__local/payment?intent=${f.order.id}&type=application`,applicant.token,{action:'succeed'},'POST',true),{...context,ownerDb:faultDb});
  assert.equal(injected,true);assert.equal(failed.status,503);assert.equal((await row(f.item.id)).is_paid,false);assert.equal(await receiptCount(f.order.id),0);assert.equal(await eventCount('application_paid:'+f.item.id),0);
  assert.equal((await pay(f.order.id,'application')).status,200);assert.equal(await receiptCount(f.order.id),1);
 });
 await check('vacancy application follows the same paid-once delivery process as a work request',async()=>{
  const f=await captured(await prepare(await application('vacancy')));assert.equal((await apps.read(employer.token,employer.id,f.item.id)).target.kind,'vacancy');
  assert.equal(await receiptCount(f.order.id),1);assert.equal(await eventCount('application_paid:'+f.item.id),1);
 });
 await check('executor choice closes only this order, rejects delivered peers and notifies unpaid peers once without granting delivery',async()=>{
  const work=await target(),winner=await applicationOn(applicant,work),second=await applicationOn(foreign,work),thirdActor=await account(),lateActor=await account();
  const secondOrder=await purchaseFor(foreign,second),third=await applicationOn(thirdActor,work),thirdOrder=await purchaseFor(thirdActor,third),late=await applicationOn(lateActor,work),lateOrder=await purchaseFor(lateActor,late);
  const firstOrder=await purchaseFor(applicant,winner);
  for(const [actor,payment] of [[applicant,firstOrder],[foreign,secondOrder]]){
   assert.equal((await call(endpoint,actor,{action:'dispatch',paymentId:payment.id})).status,200);
   assert.equal((await pay(payment.id,'application','succeed',actor)).status,200);
  }
  // A pending simulator payment must not capture after another specialist wins.
  assert.equal((await call(endpoint,thirdActor,{action:'dispatch',paymentId:thirdOrder.id})).status,200);
  const sent=await apps.read(employer.token,employer.id,winner.id);
  const selected=await apps.decide(employer.token,employer.id,sent.id,sent.revision,'selected');assert.equal(selected.status,'selected');
  const publicStore=new(load('postgres-public-work').PostgresPublicWorkStore)(runtime,{vacancyPostmoderation:true});
  assert.equal(await publicStore.read('workRequest',work.id),undefined);assert.ok(!(await publicStore.list('workRequest',1000)).some(item=>item.id===work.id));
  const history=await new(load('postgres-work-cabinet').PostgresWorkCabinetStore)(runtime).list(employer.token,employer.id,'workRequest',null);
  assert.equal(history.items.find(item=>item.id===work.id).status,'assigned');
  assert.equal((await row(second.id)).status,'rejected');assert.equal((await row(third.id)).status,'pending_payment');assert.equal(await receiptCount(thirdOrder.id),0);
  assert.equal(await eventCount('application_other_selected:'+second.id),1);assert.equal(await eventCount('application_other_selected:'+third.id),1);
  await apps.decide(employer.token,employer.id,sent.id,sent.revision,'selected');assert.equal(await eventCount('application_other_selected:'+second.id),1);
  await assert.rejects(apps.decide(employer.token,employer.id,second.id,'2','selected'));
  assert.notEqual((await pay(thirdOrder.id,'application','succeed',thirdActor)).status,200);
  assert.equal((await owner.query('select status from local_primary.provider_payments where intent_id=$1',[thirdOrder.id])).rows[0].status,'pending');
  assert.notEqual((await call(endpoint,lateActor,{action:'dispatch',paymentId:lateOrder.id})).status,200);
  assert.equal((await owner.query('select count(*)::int as n from local_primary.provider_payments where intent_id=$1',[lateOrder.id])).rows[0].n,0);
  for(const actor of [applicant,foreign,thirdActor,lateActor])await assert.rejects(apps.preview(actor.token,actor.id,'workRequest',work.id));
  // Replaying captured delivery remains idempotent after the order closes.
  assert.equal((await pay(firstOrder.id,'application','succeed',applicant)).status,200);assert.equal(await receiptCount(firstOrder.id),1);
  assert.equal((await(await call(endpoint,thirdActor,{action:'order',paymentId:thirdOrder.id})).json()).targetClosed,true);
 });
 await check('captured but undelivered payment stays truthful when executor selection closes its target',async()=>{
  const work=await target(),winner=await applicationOn(applicant,work),other=await applicationOn(foreign,work);
  const first=await purchaseFor(applicant,winner),late=await purchaseFor(foreign,other);
  for(const [actor,payment] of [[applicant,first],[foreign,late]])assert.equal((await call(endpoint,actor,{action:'dispatch',paymentId:payment.id})).status,200);
  // Model the already committed capture with a transient delivery failure.
  await owner.query("update local_primary.provider_payments set status='succeeded',captured_at=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') where intent_id=$1",[late.id]);
  // The simulator read/reconciliation path recovers this original capture; no new capture is made.
  assert.equal((await pay(first.id,'application','succeed',applicant)).status,200);
  const sent=await apps.read(employer.token,employer.id,winner.id);await apps.decide(employer.token,employer.id,sent.id,sent.revision,'selected');
  const snapshot=await(await call(endpoint,foreign,{action:'order',paymentId:late.id})).json();
  assert.equal(snapshot.order.status,'succeeded');assert.equal(snapshot.targetClosed,true);assert.equal(snapshot.deliveredAt,null);
  assert.equal(await receiptCount(late.id),0);assert.equal((await row(other.id)).is_paid,false);
  assert.equal((await pay(late.id,'application','succeed',foreign)).status,200);
 });
 await check('explicit rejection notifies its applicant once and leaves the order open',async()=>{
  const f=await captured(await prepare(await application())),sent=await apps.read(employer.token,employer.id,f.item.id);
  await apps.decide(employer.token,employer.id,sent.id,sent.revision,'rejected');await apps.decide(employer.token,employer.id,sent.id,sent.revision,'rejected');
  assert.equal(await eventCount('application_decision:'+sent.id+':rejected'),1);
  assert.ok(await new(load('postgres-public-work').PostgresPublicWorkStore)(runtime,{vacancyPostmoderation:true}).read('workRequest',sent.target.id));
 });
 await check('first dispatch race cannot capture a provider row absent at the original confirmation read',async()=>{
  const f=await prepare(await application());let inserted=false;
  const faultDb={...trusted,transaction:work=>trusted.transaction(tx=>work({query:async(sql,values)=>{
   const result=await tx.query(sql,values);
   if(sql==='select status from local_primary.provider_payments where intent_id=$1'&&!inserted){
    assert.equal(result.rowCount,0);inserted=true;
    await tx.query("insert into local_primary.provider_payments(intent_id,provider_id,status) values($1,$2,'pending')",[f.order.id,randomUUID()]);
   }
   return result;
  }}))};
  const result=await localPrimaryPaymentHandler(request(`/__local/payment?intent=${f.order.id}&type=application`,applicant.token,{action:'succeed'},'POST',true),{...context,ownerDb:faultDb});
  assert.equal(inserted,true);assert.equal(result.status,503);
  assert.equal((await owner.query('select status from local_primary.provider_payments where intent_id=$1',[f.order.id])).rows[0].status,'pending');
  assert.equal(await receiptCount(f.order.id),0);assert.equal((await row(f.item.id)).is_paid,false);
 });
 await check('lost simulator response recovers the exact provider identity after closure without another payment or capture',async()=>{
  const work=await target(),winner=await applicationOn(applicant,work),other=await applicationOn(foreign,work),first=await purchaseFor(applicant,winner),lost=await purchaseFor(foreign,other);
  let failed=false;
  const faultRuntime={...runtime,transaction:work=>runtime.transaction(tx=>work({query:async(sql,values)=>{
   if(sql.startsWith('insert into app.payment_provider_links')){failed=true;throw Error('Synthetic lost provider link');}return tx.query(sql,values);
  }}))};
  const response=await localPrimaryPaymentHandler(request(endpoint,foreign.token,{expectedOwnerId:foreign.id,action:'dispatch',paymentId:lost.id}),{...context,ownerDb:{...trusted},runtimeDb:faultRuntime});
  assert.notEqual(response.status,200);assert.equal(failed,true);
  const provider=(await owner.query('select provider_id,status from local_primary.provider_payments where intent_id=$1',[lost.id])).rows[0];assert.equal(provider.status,'pending');
  assert.equal((await owner.query('select count(*)::int as n from app.payment_provider_links where intent_id=$1',[lost.id])).rows[0].n,0);
  assert.equal((await call(endpoint,applicant,{action:'dispatch',paymentId:first.id})).status,200);assert.equal((await pay(first.id,'application')).status,200);
  const sent=await apps.read(employer.token,employer.id,winner.id);await apps.decide(employer.token,employer.id,sent.id,sent.revision,'selected');
  assert.equal((await call(endpoint,foreign,{action:'dispatch',paymentId:lost.id})).status,200);
  assert.equal((await owner.query('select provider_payment_id from app.payment_provider_links where intent_id=$1',[lost.id])).rows[0].provider_payment_id,provider.provider_id);
  assert.deepEqual((await owner.query('select provider_id,status from local_primary.provider_payments where intent_id=$1',[lost.id])).rows[0],provider);
  assert.notEqual((await pay(lost.id,'application','succeed',foreign)).status,200);assert.equal(await receiptCount(lost.id),0);
 });
 async function applicationOn(actor,work){
  if(!(await owner.query("select id from app.service_publications where author_id=$1 and kind='specialist' and deleted_at is null",[actor.id])).rowCount)await new(load('postgres-service-publications').PostgresServicePublicationStore)(runtime,{specialistProfileIdentity:true}).create(actor.token,actor.id,'specialist',randomUUID(),form);
  const preview=await apps.preview(actor.token,actor.id,'workRequest',work.id);
  return apps.create(actor.token,actor.id,{kind:'workRequest',targetId:work.id,creationKey:randomUUID(),expectedTargetRevision:preview.target.revision,specialistId:preview.specialist.id,expectedSpecialistRevision:preview.specialist.revision,message:'Могу приступить завтра.'});
 }
 async function purchaseFor(actor,item){
  const q=await(await call(endpoint,actor,{action:'preview',applicationId:item.id,expectedRevision:item.revision})).json();
  const response=await call(endpoint,actor,{applicationId:item.id,expectedRevision:item.revision,creationKey:randomUUID(),expectedTariffId:q.tariff.id,expectedAmount:q.tariff.amount},'PUT');assert.equal(response.status,200);return response.json();
 }
 console.log(JSON.stringify({status:'passed',checks,rollback:true,productionTouched:false,realProviderCalls:false}));
}finally{await owner.query('rollback');await owner.end();}
