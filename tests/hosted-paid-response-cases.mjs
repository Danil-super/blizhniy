// Production handlers and compiled reconciliation on a disposable database. Provider transport is synthetic.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {formModule} from './listing-form-module.mjs';

export async function testHostedPaidResponses({admin,config,workerDb,refundDb,compiledWorker,load}){
 const origin='https://xn----9sbphbgks4a4a.xn--p1ai',merchant={shopId:'9203',isTest:true,secretKey:'test_synthetic_only'};
 const flags={NODE_ENV:'production',BLIZHNIY_APPLICATION_PAYMENT:'account-response-test',BLIZHNIY_APPLICATION_CONTACT_VIEWS:'production-v1',
  BLIZHNIY_LISTING_PAYMENT:'account-publication-test',
  BLIZHNIY_LISTING_CHECKOUT:'prepare-only',BLIZHNIY_PAYMENT_MODE:'test',BLIZHNIY_PAYMENT_SHOP_ID:merchant.shopId,
  BLIZHNIY_PAYMENT_RECEIPT_VAT:'1',YOOKASSA_SHOP_ID:merchant.shopId,YOOKASSA_SECRET_KEY:merchant.secretKey};
 const saved=Object.fromEntries([...Object.keys(flags),'BLIZHNIY_PAYMENT_TEST_USER_ID'].map(key=>[key,process.env[key]]));
 const password=randomBytes(32).toString('hex');
 await admin.query('alter role blizhniy_runtime login password '+pg.escapeLiteral(password));
 await admin.query(`grant usage on schema app to blizhniy_runtime;
  grant select on app.users,app.sessions,app.cabinet_profiles,app.cities,app.specialist_categories,app.work_publications,
   app.work_publication_photos,app.work_moderation,app.media_objects,app.service_publications,app.applications,
   app.application_withdrawals,app.tariffs,app.payment_orders,app.payment_checkout_intents,app.payment_fulfillments,app.notifications to blizhniy_runtime;
  grant update(id) on app.users,app.work_publications,app.service_publications,app.payment_orders to blizhniy_runtime;
  grant update(last_seen_at) on app.sessions to blizhniy_runtime;
  grant insert(applicant_id,work_publication_id,specialist_publication_id,creation_key,target_revision,specialist_revision,snapshot,message),
   update(status,revision,updated_at) on app.applications to blizhniy_runtime;
  grant insert(id,owner_id,creation_key,target_type,target_id,target_revision) on app.payment_orders to blizhniy_runtime;
  grant insert(user_id,event_key,category,tone,title,body,action_href,booking_request_id) on app.notifications to blizhniy_runtime;
  grant insert(id,owner_id,target_type,target_id,target_revision,tariff_id,amount,duration_days,merchant_shop_id,is_test,request_body)
   on app.payment_checkout_intents to blizhniy_runtime;`);
 await admin.query(await readFile(new URL('../database/permissions/listing-checkout-dispatch.sql',import.meta.url),'utf8'));
 const db=new(load('postgres').PostgresDatabase)(new pg.Pool({...config,user:'blizhniy_runtime',password,max:4}));
 try{
  Object.assign(process.env,flags);
  const city=(await admin.query("select id from app.cities where slug='hosted-refund-city'")).rows[0].id;
  const profession=(await admin.query("select id from app.specialist_categories where slug='hosted-refund-work'")).rows[0].id;
  await admin.query("insert into app.tariffs(id,action,name,price) values('job-response','job_response','Стендовый отклик',99)");
  const {hashSessionToken}=load('identity');
  async function actor(name,phone){
   const id=randomUUID(),token=randomBytes(32).toString('hex'),email=id+'@response.invalid';
   await admin.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',
    [id,email,'scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128)]);
   await admin.query("insert into app.sessions(token_hash,user_id,scope,auth_version,expires_at) values($1,$2,'app',0,clock_timestamp()+interval '1 hour')",[hashSessionToken(token),id]);
   if(phone){
    await admin.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2)',[id,{name,phone}]);
    await admin.query('insert into app.telegram_phone_bindings(user_id,phone,telegram_subject) values($1,$2,$3)',[id,phone,'hosted-response-'+id]);
    const profile=load('service-publication-contract').parseServicePublicationForm('specialist',{title:name,professionName:'Стендовая профессия',
     professionId:profession,cityName:'Стендовый город',description:'Ремонтирую оборудование и согласую сроки с заказчиком.',price:'1500',
     contactPhone:phone,email,placementRightConfirmed:true});
    const specialist=(await admin.query("insert into app.service_publications(author_id,kind,creation_key,form,city_id,profession_id) values($1,'specialist',$2,$3,$4,$5) returning id",
     [id,randomUUID(),profile,city,profession])).rows[0].id;
    return{id,token,email,phone,specialist};
   }
   return{id,token,email};
  }
  const recipient=await actor('Стендовый заказчик'),first=await actor('Первый исполнитель','+79995551301'),
   second=await actor('Второй исполнитель','+79995551302'),outsider=await actor('Другой пользователь');
  async function work(kind){
   const form=load('work-publication-contract').parseWorkPublicationForm(kind,{title:'Стендовая публикация для платного отклика',
    description:'Проверка доставки после оплаты и выбора исполнителя.',cityName:'Стендовый город',professionName:'Стендовая профессия',
    professionId:profession,contactPhone:'+79995551303',placementRightConfirmed:true,
    ...(kind==='vacancy'?{employerType:'person',organization:'Стендовый заказчик',salary:'3500'}:{budget:'3500'})});
   return (await admin.query(`insert into app.work_publications(author_id,kind,creation_key,form,city_id,profession_id,status,is_paid,published_at,expires_at)
    values($1,$2,$3,$4,$5,$6,'published',true,clock_timestamp(),clock_timestamp()+interval '30 days') returning id`,
   [recipient.id,kind,randomUUID(),form,city,profession])).rows[0].id;
  }
  const remote=new Map();let posts=0;
  async function fetcher(url,init){
   const path=new URL(url);assert.equal(path.origin,'https://api.yookassa.ru');
   let payment;
   if(init.method==='POST'){
    assert.equal(path.pathname,'/v3/payments');posts++;
    const key=init.headers['Idempotence-Key'],body=JSON.parse(init.body);
    assert.equal(body.metadata.localPaymentId,key);
    assert.equal(body.confirmation.return_url,origin+'/oplata/'+key+'?type=application');
    assert.deepEqual(body.receipt.items[0].amount,body.amount);
    payment={id:randomUUID(),order:key,body,status:'pending'};
    remote.set(payment.id,payment);
   }else{
    assert.equal(init.method,'GET');
    payment=remote.get(path.pathname.split('/').at(-1));assert.ok(payment);
   }
   const {id,body,status}=payment;
   return Response.json({id,status,paid:status==='succeeded',test:true,recipient:{account_id:merchant.shopId},
    amount:body.amount,metadata:body.metadata,...(status==='succeeded'?{captured_at:payment.capturedAt}:{}),
    ...(status==='pending'?{confirmation:{type:'redirect',confirmation_url:'https://yoomoney.ru/checkout'}}:{})});
  }
  const auth={'./production-auth-config':{readProductionAuthConfig:()=>({origin})},
   './production-auth-runtime':{getProductionAccountDatabase:async()=>({db,limiter:{allowProduction:async()=>true}})}};
  const dispatch=load('primary-payment-dispatch').createPrimaryPaymentDispatcher;
  const {handleApplicationCheckoutRequest}=formModule('application-checkout-runtime',{...auth,'./auth-http':load('auth-http'),
   './application-test-config':load('application-test-config'),'./application-checkout-http':load('application-checkout-http'),
   './postgres-application-checkout':load('postgres-application-checkout'),
   './primary-payment-dispatch':{createPrimaryPaymentDispatcher:(db,merchant)=>dispatch(db,merchant,fetcher)}});
  const {handleProductionApplicationRequest}=formModule('production-application-runtime',{...auth,'./auth-http':load('auth-http'),
   './application-contact-views-config':load('application-contact-views-config'),
   './postgres-applications':load('postgres-applications'),'./production-application-http':load('production-application-http')});
  async function invoke(handler,path,actor,body,{method='POST',status=200,loseResponse=false}={}){
   const headers={host:new URL(origin).host,origin,'x-real-ip':'192.0.2.10','x-blizhniy-request':'1','content-type':'application/json'};
   if(actor.token)headers.cookie='__Host-blizhniy_session='+actor.token;
   const response=await handler(new Request(origin+path,{method,headers,body:JSON.stringify({expectedOwnerId:actor.id,...body})}));
   const result=await response.json();
   assert.ok([status].flat().includes(response.status),`${body.action??method} returned ${response.status} ${result?.error?.code??''}`);
   if(loseResponse)throw Error('Synthetic lost payment redirect response');
   return result;
  }
  const app=(actor,action,body,options)=>invoke(handleProductionApplicationRequest,'/api/account/applications',actor,{action,...body},options);
  const checkout=(actor,body,options)=>invoke(handleApplicationCheckoutRequest,'/api/account/application-checkout',actor,body,options);
  const incoming=()=>app(recipient,'list',{mode:'recipient',after:null});
  async function draft(actor,kind,targetId){
   const preview=await app(actor,'preview',{kind,targetId});
   const input={kind,targetId,expectedTargetRevision:preview.target.revision,creationKey:randomUUID(),specialistId:preview.specialist.id,
    expectedSpecialistRevision:preview.specialist.revision,message:'Готовы выполнить работу по согласованному графику.'};
   return app(actor,'create',{input},{method:'PUT'});
  }
  async function settle(actor,application,status,beforeCapture){
   await admin.query('delete from app_response.enrollment');
   process.env.BLIZHNIY_PAYMENT_TEST_USER_ID=actor.id;
   await admin.query('insert into app_response.enrollment(singleton,owner_id,shop_id,vat_code) values(true,$1,$2,1)',[actor.id,merchant.shopId]);
   const preview=await checkout(actor,{action:'preview',applicationId:application.id,expectedRevision:application.revision});
   const input={applicationId:application.id,expectedRevision:application.revision,creationKey:randomUUID(),
    expectedTariffId:preview.tariff.id,expectedAmount:preview.tariff.amount};
   const order=await checkout(actor,input,{method:'PUT'});
   assert.deepEqual(await checkout(actor,{action:'intent',creationKey:input.creationKey}),order);
   assert.equal(order.amount,'99.00');
   const phone=(await admin.query('delete from app.telegram_phone_bindings where user_id=$1 returning phone,telegram_subject',[actor.id])).rows[0];
   const attempted={action:'dispatch',paymentId:order.id};
   const previousPosts=posts;
   assert.equal((await checkout(actor,attempted,{status:409})).error.code,'CHECKOUT_CHANGED');
   assert.equal(posts,previousPosts);
   assert.equal((await admin.query('select intent_id from app.payment_dispatch_anchors where intent_id=$1',[order.id])).rowCount,0);
   await admin.query('insert into app.telegram_phone_bindings(user_id,phone,telegram_subject) values($1,$2,$3)',[actor.id,phone.phone,phone.telegram_subject]);
   await assert.rejects(checkout(actor,attempted,{loseResponse:true}),/Synthetic lost payment redirect response/);
   assert.equal((await checkout(actor,{action:'dispatch',paymentId:order.id})).confirmationUrl,'https://yoomoney.ru/checkout');
   const payment=[...remote.values()].find(payment=>payment.order===order.id);assert.equal(payment.body.receipt.customer.email,actor.email);
   let deliveryReplyLost=false;
   const connection={transaction:async work=>{
    let delivery=false;
    const result=await workerDb.transaction(tx=>work({query:(sql,params)=>{
     delivery ||= sql.includes('app_response.deliver(');
     return tx.query(sql,params);
    }}));
    if(delivery&&!deliveryReplyLost){
     deliveryReplyLost=true;
     throw Error('Synthetic lost delivery acknowledgement after commit');
    }
    return result;
   }};
   const reconciler=compiledWorker(connection,merchant,fetcher,actor.id,undefined,true);
   assert.deepEqual(await reconciler.tick(),{state:'deferred',code:'provider_pending'});
   await app(recipient,'read',{applicationId:application.id},{status:404});
   assert.equal((await incoming()).items.some(row=>row.id===application.id),false);
   payment.status=status;
   payment.capturedAt=new Date().toISOString();
   const due=()=>admin.query('update app.payment_reconciliation_jobs set next_attempt_at=clock_timestamp() where intent_id=$1',[order.id]);
   await due();
   if(beforeCapture){
    const worker=compiledWorker(workerDb,merchant,fetcher,actor.id,undefined,true);
    await beforeCapture(worker,order.id);
    assert.deepEqual(await worker.tick(),{state:'blocked',code:'publication_blocked'});
    assert.deepEqual(await worker.tick(),{state:'idle'});
    const receipt=await checkout(actor,{action:'order',paymentId:order.id});
    assert.equal(receipt.order.status,'succeeded');
    assert.equal(receipt.deliveredAt,null);
    assert.equal((await admin.query('select intent_id from app_response.deliveries where intent_id=$1',[order.id])).rowCount,0);
    assert.equal((await admin.query('select event_key from app.notifications where event_key=$1',['application_paid:'+application.id])).rowCount,0);
    await app(recipient,'read',{applicationId:application.id},{status:404});
    assert.equal((await incoming()).items.some(row=>row.id===application.id),false);
    assert.equal(posts,previousPosts+1);
    assert.equal((await compensation.claim(order.id)).state,'claimed');
    const record=await compensation.read(order.id);
    assert.equal(record.policyVersion,'paid-response-undelivered-v1');
    assert.equal(record.reason,'delivery-blocked');
    assert.equal(record.deliveredAt,null);
    assert.equal(record.contactViewAt,null);
    return;
   }
   if(status==='succeeded'){
    assert.deepEqual(await reconciler.tick(),{state:'deferred',code:'processing_unavailable'});
    assert.equal(deliveryReplyLost,true);
    assert.equal((await admin.query('select intent_id from app_response.deliveries where intent_id=$1',[order.id])).rowCount,1);
    await due();
   }
   assert.deepEqual(await reconciler.tick(),{state:'completed'});
   assert.deepEqual(await reconciler.tick(),{state:'idle'});
   const receipt=await checkout(actor,{action:'order',paymentId:order.id});
   assert.equal(receipt.order.status,status==='succeeded'?'succeeded':'failed');
   const deliveries=(await admin.query('select application_id,sent_at from app_response.deliveries where intent_id=$1',[order.id])).rows;
   const notices=(await admin.query('select user_id from app.notifications where event_key=$1',['application_paid:'+application.id])).rows;
   if(status==='canceled'){
    assert.equal(receipt.deliveredAt,null);assert.deepEqual(deliveries,[]);assert.deepEqual(notices,[]);
    await app(recipient,'read',{applicationId:application.id},{status:404});
    return;
   }
   assert.equal(deliveries.length,1);assert.equal(deliveries[0].application_id,application.id);
   assert.equal(Date.parse(receipt.deliveredAt),deliveries[0].sent_at.getTime());assert.deepEqual(notices,[{user_id:recipient.id}]);
   const evidence=async()=>(await admin.query('select recipient_id,evidence,recorded_at::text from app.application_contact_views where application_id=$1',[application.id])).rows;
   const read={applicationId:application.id};
   assert.deepEqual(await evidence(),[]);
   if(posts===1){
    assert.deepEqual(await app(recipient,'read',read,{status:503}),{error:{code:'APPLICATIONS_UNAVAILABLE'}});
    assert.deepEqual(await evidence(),[]);
    await admin.query(await readFile(new URL('../database/permissions/application-contact-views.sql',import.meta.url),'utf8'));
    await assert.rejects(db.query('select * from app.application_contact_views'),{code:'42501'});
   }
   const seen=await app(recipient,'read',read);
   assert.equal(seen.status,'sent');assert.equal(seen.paid,true);assert.equal(seen.sentAt,receipt.deliveredAt);
   assert.deepEqual(seen.snapshot,application.snapshot);assert.equal(seen.message,application.message);
   const disclosure=await evidence();
   assert.deepEqual(disclosure.map(({recipient_id,evidence})=>({recipient_id,evidence})),[{recipient_id:recipient.id,evidence:'recipient_read'}]);
   assert.deepEqual(await app(recipient,'read',read),seen);
   await app(outsider,'read',{applicationId:application.id},{status:404});
   assert.deepEqual(await evidence(),disclosure);
   return seen;
  }
  const decide=(response,status=200)=>app(recipient,'decide',
   {applicationId:response.id,expectedRevision:response.revision,state:'selected'},{method:'PUT',status});
  const vacancy=await work('vacancy'),order=await work('workRequest');
  await app(recipient,'preview',{kind:'vacancy',targetId:vacancy},{status:404});
  const vacancyResponse=await settle(first,await draft(first,'vacancy',vacancy),'succeeded');
  const selected=await decide(vacancyResponse);
  assert.equal(selected.status,'selected');assert.equal(selected.targetClosed,false);
  await settle(second,await draft(second,'vacancy',vacancy),'canceled');
  const accepted=[];
  for(const applicant of [first,second])accepted.push(await settle(applicant,await draft(applicant,'workRequest',order),'succeeded'));
  await admin.query("update app.service_publications set form=jsonb_set(form,'{description}',to_jsonb($2::text)),revision=revision+1 where id=$1",
   [first.specialist,'Анкета изменена после доставки исходного отклика.']);
  assert.deepEqual((await app(recipient,'read',{applicationId:accepted[0].id})).snapshot,accepted[0].snapshot);
  const choices=await Promise.all(accepted.map(row=>decide(row,[200,409])));
  const winners=choices.filter(result=>result.status==='selected');
  assert.equal(winners.length,1);
  assert.deepEqual(choices.find(result=>result.error),{error:{code:'APPLICATION_CHANGED'}});
  const [winner]=winners;
  assert.equal(winner.targetClosed,true);
  const losing=accepted.find(row=>row.id!==winner.id);
  assert.equal((await app(recipient,'read',{applicationId:losing.id})).status,'rejected');
  assert.equal((await admin.query('select count(*)::int as n from app.application_selection_events where work_publication_id=$1',[order])).rows[0].n,1);
  const losingPayment=[...remote.values()].find(payment=>payment.body.metadata.targetId===losing.id);
  const compensation=new(load('postgres-application-compensation').PostgresApplicationCompensationStore)(refundDb,merchant);
  assert.deepEqual(await compensation.claim(losingPayment.order),{state:'ineligible',reason:'viewed'});
  assert.equal(await compensation.read(losingPayment.order),null);
  const publicWork=new(load('postgres-public-work').PostgresPublicWorkStore)(db,{vacancyPostmoderation:true});
  assert.equal(await publicWork.read('workRequest',order),undefined);
  assert.equal((await publicWork.read('vacancy',vacancy)).id,vacancy);
  assert.equal(posts,4);assert.equal(remote.size,4);
  await admin.query('delete from app_response.enrollment');
  process.env.BLIZHNIY_PAYMENT_TEST_USER_ID=first.id;
  await admin.query('insert into app_response.enrollment(singleton,owner_id,shop_id,vat_code) values(true,$1,$2,1)',[first.id,merchant.shopId]);
  for(const [kind,status] of [['workRequest',404],['specialist',409]]){
   const targetId=await work('workRequest'),response=await draft(first,'workRequest',targetId);
   const previewInput={action:'preview',applicationId:response.id,expectedRevision:response.revision};
   const preview=await checkout(first,previewInput);
   const input={applicationId:response.id,expectedRevision:response.revision,creationKey:randomUUID(),
    expectedTariffId:preview.tariff.id,expectedAmount:preview.tariff.amount};
   const order=await checkout(first,input,{method:'PUT'});
   const restrictedId=kind==='specialist'?first.specialist:targetId;
   const table=kind==='specialist'?'app.service_publications':'app.work_publications';
   assert.equal((await admin.query(`insert into app_publication_restriction.restrictions(kind,publication_id,restricted_revision,case_id)
     select kind,id,revision,$2 from ${table} where id=$1`,[restrictedId,randomUUID()])).rowCount,1);
   await app(first,'preview',{kind:'workRequest',targetId},{status});
   await checkout(first,previewInput,{status});
   await checkout(first,{...input,creationKey:randomUUID()},{method:'PUT',status});
   await checkout(first,{action:'dispatch',paymentId:order.id},{status});
   assert.equal((await admin.query('select intent_id from app.payment_dispatch_anchors where intent_id=$1',[order.id])).rowCount,0);
   assert.deepEqual(await checkout(first,{action:'intent',creationKey:input.creationKey}),order);
   assert.equal((await checkout(first,{action:'order',paymentId:order.id})).order.status,'created');
  }
  assert.equal(posts,4);assert.equal(remote.size,4);
  const {rows:[original]}=await admin.query("select pg_get_functiondef('app_response.deliver(uuid,uuid)'::regprocedure) as sql");
  await admin.query(await readFile(new URL('../database/candidates/0095-restricted-response-delivery.sql',import.meta.url),'utf8'));
  try{
   async function restrict(db,table,id){
    assert.equal((await db.query(`insert into app_publication_restriction.restrictions(kind,publication_id,restricted_revision,case_id)
     select kind,id,revision,$2 from ${table} where id=$1`,[id,randomUUID()])).rowCount,1);
   }
   const paidVacancy=[...remote.values()].find(payment=>payment.body.metadata.targetId===vacancyResponse.id);
   const delivered=await checkout(first,{action:'order',paymentId:paidVacancy.order});
   await restrict(admin,'app.work_publications',vacancy);
   assert.deepEqual(await checkout(first,{action:'order',paymentId:paidVacancy.order}),delivered);
   assert.equal((await admin.query('select intent_id from app_response.deliveries where intent_id=$1',[paidVacancy.order])).rowCount,1);
   assert.deepEqual(await compensation.claim(paidVacancy.order),{state:'ineligible',reason:'selected-self'});
   for(const scope of ['vacancy','workRequest','specialist']){
    const kind=scope==='vacancy'?'vacancy':'workRequest',targetId=await work(kind);
    const response=await draft(second,kind,targetId);
    await settle(second,response,'succeeded',async(worker,intentId)=>{
     if(scope==='specialist')return restrict(admin,'app.service_publications',second.specialist);
     if(scope==='vacancy')return restrict(admin,'app.work_publications',targetId);
     const reviewer=await actor('Стендовый модератор');
     await admin.query("update app.users set role='admin' where id=$1",[reviewer.id]);
     await admin.query('update app.payment_reconciliation_jobs set attempts=11 where intent_id=$1',[intentId]);
     const moderator=await admin.connect();
     try{
      await moderator.query('begin');
      await moderator.query('select id from app.work_publications where id=$1 for update',[targetId]);
      await restrict(moderator,'app.work_publications',targetId);
      assert.deepEqual(await worker.tick(),{state:'blocked',code:'attempts_exhausted'});
      await moderator.query('commit');
     }catch(error){
      await moderator.query('rollback');
      throw error;
     }finally{moderator.release();}
     const recovery=await admin.connect();
     try{
      await recovery.query('begin');
      await recovery.query('set local role blizhniy_reconciliation_operator');
      const args=[hashSessionToken(reviewer.token),reviewer.id,randomUUID(),intentId,merchant.shopId,'Синтетическая сверка после ограничения публикации',true];
      const {rows:[result]}=await recovery.query('select app.recover_payment_reconciliation($1,$2,$3,$4,$5,$6,$7) as result',args);
      assert.equal(result.result.state,'scheduled');
      await recovery.query('commit');
     }catch(error){
      await recovery.query('rollback');
      throw error;
     }finally{recovery.release();}
    });
   }
  }finally{await admin.query(original.sql);}
 }finally{
  await db.close();
  for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
}
