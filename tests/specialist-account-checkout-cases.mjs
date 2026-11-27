// Uses the real route handler, HTTP client and a disposable role. Only the provider and ingress are fixtures.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {formModule} from './listing-form-module.mjs';

export async function checkSpecialistAccountCheckout({load,db,worker,admin,owner,peer,reviewer,enroll,remove,outcome='succeeded'}){
 const shopId='900000001',origin='https://xn----9sbphbgks4a4a.xn--p1ai',providerId=randomUUID();
 const merchant={shopId,isTest:true,secretKey:'test_synthetic_only'};
 const flags={BLIZHNIY_SPECIALIST_PAYMENT:'account-publication-test',BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_ORIGIN:origin,BLIZHNIY_LISTING_CHECKOUT:'prepare-only',
  BLIZHNIY_LISTING_PAYMENT:'account-publication-test',BLIZHNIY_PAYMENT_MODE:'test',BLIZHNIY_PAYMENT_SHOP_ID:shopId,BLIZHNIY_PAYMENT_RECEIPT_VAT:'1',
  BLIZHNIY_PAYMENT_TEST_USER_ID:owner.owner,YOOKASSA_SHOP_ID:shopId,YOOKASSA_SECRET_KEY:'test_synthetic_only'};
 const local=['BLIZHNIY_SPECIALIST_CHECKOUT','BLIZHNIY_LOCAL_PRIMARY','BLIZHNIY_LOCAL_PRIMARY_ORIGIN'];
 const before=Object.fromEntries([...local,...Object.keys(flags)].map(k=>[k,process.env[k]]));
 let reads=0,writes=0,requestBody,actor=owner,status='pending',capturedAt;
 try{
  local.forEach(k=>delete process.env[k]);Object.assign(process.env,flags);
  const {canShowSpecialistTest}=load('specialist-checkout-config');
  assert.equal(canShowSpecialistTest(owner.owner),true);assert.equal(canShowSpecialistTest(peer.owner),false);
  const fetcher=async(url,init)=>{
   if(init.method==='POST'){
    assert.equal(String(url),'https://api.yookassa.ru/v3/payments');writes++;
    requestBody=JSON.parse(init.body);
    assert.equal(init.headers['Idempotence-Key'],requestBody.metadata.localPaymentId);
    assert.equal(requestBody.metadata.publicationMode,'specialist-account-test-v1');
    assert.equal(requestBody.metadata.targetId,owner.id);assert.equal(requestBody.receipt.customer.email,owner.owner+'@specialist.invalid');
    assert.equal(requestBody.confirmation.return_url,origin+'/oplata/'+requestBody.metadata.localPaymentId+'?type=specialist');
   }else{assert.equal(init.method,'GET');assert.equal(String(url),'https://api.yookassa.ru/v3/payments/'+providerId);reads++;}
   return Response.json({id:providerId,status,paid:status==='succeeded',test:true,recipient:{account_id:shopId},amount:requestBody.amount,
    metadata:requestBody.metadata,...(status==='pending'?{confirmation:{type:'redirect',confirmation_url:'https://yoomoney.ru/checkout'}}:{}),
    ...(status==='succeeded'?{captured_at:capturedAt}:{})});
  };
  const {createAccountTestListingPayment}=load('account-test-listing-payment');
  const {handleSpecialistCheckoutRequest}=formModule('listing-checkout-runtime',{
   './auth-http':load('auth-http'),'./listing-checkout-config.ts':load('listing-checkout-config'),
   './account-test-payment-config.ts':load('account-test-payment-config'),'./postgres-listing-checkout':load('postgres-listing-checkout'),
   './production-auth-config':{readProductionAuthConfig:()=>({origin})},
   './production-auth-runtime':{getProductionAccountDatabase:async()=>({db,limiter:{allowProduction:async()=>true}})},
   './listing-checkout-http':load('listing-checkout-http'),
   './account-test-listing-payment':{createAccountTestListingPayment:(db,store,config)=>createAccountTestListingPayment(db,store,config,fetcher)},
  });
  const request=(path,init)=>{
   const headers=new Headers(init.headers);headers.set('origin',origin);headers.set('host',new URL(origin).host);
   headers.set('x-real-ip','192.0.2.4');if(actor)headers.set('cookie','__Host-blizhniy_session='+actor.token);
   return new Request(origin+path,{...init,headers});
  };
  const {createAccountTestPaymentClient}=load('client-account-test-payment');
  const checkoutRequest=(_url,init)=>handleSpecialistCheckoutRequest(request('/api/account/specialist-checkout',init));
  const client=createAccountTestPaymentClient(checkoutRequest);
  const json=(method,body)=>({method,headers:{'content-type':'application/json','x-blizhniy-request':'1','x-blizhniy-profession-refs':'1'},body:JSON.stringify(body)});
  const publish=load('production-service-publication-http').createProductionServicePublicationHandler({origin},
   ()=>({store:owner.forms,limiter:{allowProduction:async()=>true}}),()=>{});
  const publication=(action,fields,method='POST')=>publish(request('/api/account/service-publications',
   json(method,{action,kind:'specialist',expectedOwnerId:actor?.owner??owner.owner,...fields})));
  const fields={publicationId:owner.id};
  const initial=await publication('read',fields);
  assert.equal(initial.status,200);
  const draft=await initial.json(),description='Ремонт сантехники с предварительным согласованием работ и стоимости.';
  assert.equal(draft.status,'draft');assert.equal(draft.paid,false);
  const updated=await publication('update',{...fields,expectedRevision:draft.revision,form:{...draft.form,description}},'PUT');
  assert.equal(updated.status,200);
  const edited=await updated.json();
  assert.notEqual(edited.revision,draft.revision);
  assert.equal((await publication('update',{...fields,expectedRevision:draft.revision,form:draft.form},'PUT')).status,409);
  const saved=await publication('read',fields);
  assert.equal(saved.status,200);
  const reloaded=await saved.json();
  assert.equal(reloaded.form.description,description);
  assert.deepEqual(reloaded.photos,[]);
  owner.revision=reloaded.revision;
  actor=null;assert.equal((await publication('read',fields)).status,401);
  actor=peer;assert.equal((await publication('read',fields)).status,404);
  actor=owner;
  const publicProfiles=new(load('postgres-public-service').PostgresPublicServiceStore)(db,{specialistProfileIdentity:true,testPublicationLabels:true});
  assert.equal(await publicProfiles.read('specialist',owner.id),undefined);
  const avatar='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
  await admin.query("update app.cabinet_profiles set profile=jsonb_set(profile,'{avatarDataUrl}',to_jsonb($2::text)) where user_id=$1",[owner.owner,avatar]);
  await enroll(owner);
  await assert.rejects(client.preview(owner.owner,owner.id,owner.revision),{code:'CHECKOUT_NOT_READY'});
  const moderation=load('production-service-moderation-http').createProductionServiceModerationHandler;
  const store=new(load('postgres-service-moderation').PostgresServiceModerationStore)(db);
  const runtime=()=>({store,limiter:{allowProduction:async()=>true}});
  const submit=moderation({origin},'owner',runtime,()=>{});
  const review=moderation({origin},'admin',runtime,()=>{});
  const submission=await submit(request('/api/account/service-moderation',json('PUT',
   {expectedOwnerId:owner.owner,kind:'specialist',publicationId:owner.id,expectedRevision:owner.revision})));
  assert.equal(submission.status,200);
  const reviewRequest=await submission.json();
  assert.equal(reviewRequest.state,'pending');
  await assert.rejects(client.preview(owner.owner,owner.id,owner.revision),{code:'CHECKOUT_NOT_READY'});
  const approve=()=>review(request('/api/admin/service-moderation',json('PUT',
   {expectedAdminId:actor.owner,kind:'specialist',requestId:reviewRequest.id,state:'approved',note:null})));
  assert.equal((await approve()).status,403);
  actor=reviewer;
  const approved=await approve();
  assert.equal(approved.status,200);
  assert.equal((await approved.json()).state,'approved');
  actor=owner;
  await assert.rejects(client.preview(owner.owner,owner.id,draft.revision),{code:'DRAFT_CHANGED'});
  const quote=await client.preview(owner.owner,owner.id,owner.revision);
  assert.equal(quote.activePayment,null);
  const input={listingId:owner.id,expectedRevision:owner.revision,creationKey:randomUUID(),expectedTariffId:quote.tariff.id,expectedAmount:quote.tariff.amount,expectedDurationDays:quote.tariff.durationDays};
  await remove();
  await assert.rejects(client.prepare(owner.owner,input),{code:'CHECKOUT_NOT_READY'});
  assert.equal(await client.recover(owner.owner,input.creationKey),null);
  await enroll(owner);
  await admin.query('update app.tariffs set price=price+1 where id=$1',[quote.tariff.id]);
  try{
   await assert.rejects(client.prepare(owner.owner,input),{code:'CHECKOUT_CHANGED'});
   assert.equal(await client.recover(owner.owner,input.creationKey),null);
   assert.equal(writes,0);
  }finally{await admin.query('update app.tariffs set price=$2 where id=$1',[quote.tariff.id,quote.tariff.amount]);}
  let committed;
  const lostClient=createAccountTestPaymentClient(async(...args)=>{
   const response=await checkoutRequest(...args);
   committed=response.status;
   throw new TypeError('Synthetic lost checkout response');
  });
  await assert.rejects(lostClient.prepare(owner.owner,input),{code:'UNKNOWN'});
  assert.equal(committed,200);
  const [first,again]=await Promise.all([client.prepare(owner.owner,input),client.prepare(owner.owner,input)]);
  assert.deepEqual(first,again);
  assert.equal((await client.recover(owner.owner,input.creationKey)).id,first.id);
  assert.equal((await client.preview(owner.owner,owner.id,owner.revision)).activePayment.id,first.id);
  const histories=new(load('postgres-payment-history').PostgresPaymentHistoryStore)(db);
  const ownedOrder=()=>histories.readSpecialistOrder(owner.token,owner.owner,first.id);
  assert.equal((await ownedOrder()).canResumeSpecialist,true);
  process.env.YOOKASSA_SHOP_ID=process.env.BLIZHNIY_PAYMENT_SHOP_ID='900000002';
  const archived=await ownedOrder();assert.equal(archived.order.id,first.id);assert.equal(archived.canResumeSpecialist,undefined);
  process.env.YOOKASSA_SHOP_ID=process.env.BLIZHNIY_PAYMENT_SHOP_ID=shopId;
  actor=peer;
  await assert.rejects(client.prepare(peer.owner,{...input,creationKey:randomUUID()}),{code:'CHECKOUT_NOT_READY'});
  await assert.rejects(client.dispatch(owner.owner,first.id),{code:'UNAUTHENTICATED'});
  actor=owner;assert.equal(writes,0);
  const link=await client.dispatch(owner.owner,first.id);assert.equal(link.confirmationUrl,'https://yoomoney.ru/checkout');
  assert.deepEqual(requestBody.amount,{value:first.amount,currency:'RUB'});
  assert.deepEqual(requestBody.receipt.items[0].amount,requestBody.amount);
  await remove();assert.deepEqual(await client.dispatch(owner.owner,first.id),link);assert.equal(writes,1);assert.equal(reads,1);
  process.env.BLIZHNIY_SPECIALIST_PAYMENT='disabled';
  assert.equal(canShowSpecialistTest(owner.owner),false);
  await assert.rejects(client.dispatch(owner.owner,first.id),{code:'CHECKOUT_DISABLED'});
  const history=await new(load('postgres-payment-history').PostgresPaymentHistoryStore)(db).readSpecialistOrder(owner.token,owner.owner,first.id);
  assert.equal(history.order.id,first.id);assert.equal(history.testPublication,true);assert.equal(history.fulfillment,null);
  assert.equal((await admin.query('select count(*)::int n from app.payment_orders where owner_id=$1',[owner.owner])).rows[0].n,1);
  assert.equal(writes,1);assert.equal(reads,1);
  const verify=new(load('postgres-payment-verification').PostgresPaymentVerificationStore)(worker,merchant,fetcher);
  const fulfill=new(load('postgres-listing-payment-fulfillment').PostgresListingPaymentFulfillmentStore)(worker,merchant,
   {postmoderation:true,targetType:'specialist',publicationTestOwner:owner.owner,specialistAccountTest:true});
  const readHistory=load('payment-history-http').createPaymentHistoryHandler({origin},
   ()=>({store:histories,limiter:{allowProduction:async()=>true}}),()=>{});
  const viewer=load('client-listing-payment').createListingPaymentClient((_url,init)=>readHistory(request('/api/account/payments',init)),'specialistOrder');
  const original=()=>viewer.read(owner.owner,first.id);
  assert.equal((await original()).fulfillment,null);
  assert.equal((await verify.reconcile(first.id)).orderStatus,'pending');
  assert.equal((await fulfill.fulfill(first.id)).state,'not_ready');
  assert.equal(await publicProfiles.read('specialist',owner.id),undefined);
  status=outcome;capturedAt=new Date().toISOString();
  const terminal=outcome==='succeeded'?'succeeded':'failed';
  assert.equal((await verify.reconcile(first.id)).orderStatus,terminal);
  assert.equal(await publicProfiles.read('specialist',owner.id),undefined,'verification alone is not publication');
  if(outcome==='succeeded'){
   const phone=(await admin.query('delete from app.telegram_phone_bindings where user_id=$1 returning phone,telegram_subject',[owner.owner])).rows[0];
   assert.ok(phone);
   await assert.rejects(fulfill.fulfill(first.id),{code:'P7601'});
   assert.equal((await original()).fulfillment,null);
   await admin.query('insert into app.telegram_phone_bindings(user_id,phone,telegram_subject) values($1,$2,$3)',[owner.owner,phone.phone,phone.telegram_subject]);
  }
  const receipt=await fulfill.fulfill(first.id);
  assert.deepEqual(await fulfill.fulfill(first.id),receipt);
  assert.equal((await verify.reconcile(first.id)).orderStatus,terminal);
  const completed=await original();
  assert.equal(completed.order.status,terminal);
  assert.equal(completed.order.amount,quote.tariff.amount);
  assert.equal(completed.order.durationDays,quote.tariff.durationDays);
  if(outcome==='succeeded'){
   assert.equal(receipt.state,'fulfilled');assert.deepEqual(completed.fulfillment,receipt.period);
   assert.equal(Date.parse(receipt.period.expiresAt)-Date.parse(receipt.period.publishedAt),first.durationDays*86400000);
   const card=await publicProfiles.read('specialist',owner.id);
   assert.equal(card.testPublication,true);assert.equal(card.name,'ТЕСТ · Тестовый специалист');
   assert.equal(card.description,description);assert.deepEqual(card.images,[avatar]);
   assert.equal((await admin.query('select count(*)::int as n from app.payment_fulfillments where intent_id=$1',[first.id])).rows[0].n,1);
  }else{
   assert.equal(receipt.state,'not_ready');assert.equal(completed.fulfillment,null);
   assert.equal(await publicProfiles.read('specialist',owner.id),undefined);
   const editable=await publication('update',{...fields,expectedRevision:owner.revision,form:reloaded.form},'PUT');
   assert.equal(editable.status,200);assert.equal((await editable.json()).status,'draft');
  }
  assert.equal((await publicProfiles.sitemapPage()).entries.some(entry=>entry.id===owner.id),false);
  actor=null;await assert.rejects(original(),{code:'UNAUTHENTICATED'});
  actor=peer;assert.equal(await viewer.read(peer.owner,first.id),null);
  actor=owner;await admin.query('update app.users set auth_version=auth_version+1 where id=$1',[owner.owner]);
  await assert.rejects(original(),{code:'UNAUTHENTICATED'});
  assert.equal(writes,1);assert.equal(reads,4);
 }finally{
  await remove();for(const [k,v] of Object.entries(before)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
 }
}
