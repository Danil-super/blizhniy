// Uses the real route handler, HTTP client and a disposable role. Only the provider and ingress are fixtures.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {formModule} from './listing-form-module.mjs';

export async function checkSpecialistAccountCheckout({load,db,admin,owner,peer,enroll,remove}){
 const shopId='900000001',origin='https://xn----9sbphbgks4a4a.xn--p1ai',providerId=randomUUID();
 const flags={BLIZHNIY_SPECIALIST_PAYMENT:'account-publication-test',BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_ORIGIN:origin,BLIZHNIY_LISTING_CHECKOUT:'prepare-only',
  BLIZHNIY_LISTING_PAYMENT:'account-publication-test',BLIZHNIY_PAYMENT_MODE:'test',BLIZHNIY_PAYMENT_SHOP_ID:shopId,BLIZHNIY_PAYMENT_RECEIPT_VAT:'1',
  BLIZHNIY_PAYMENT_TEST_USER_ID:owner.owner,YOOKASSA_SHOP_ID:shopId,YOOKASSA_SECRET_KEY:'test_synthetic_only'};
 const local=['BLIZHNIY_SPECIALIST_CHECKOUT','BLIZHNIY_LOCAL_PRIMARY','BLIZHNIY_LOCAL_PRIMARY_ORIGIN'];
 const before=Object.fromEntries([...local,...Object.keys(flags)].map(k=>[k,process.env[k]]));
 let reads=0,writes=0,requestBody,actor=owner;
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
   return Response.json({id:providerId,status:'pending',paid:false,test:true,recipient:{account_id:shopId},amount:requestBody.amount,
    metadata:requestBody.metadata,confirmation:{type:'redirect',confirmation_url:'https://yoomoney.ru/checkout'}});
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
  const client=load('client-account-test-payment').createAccountTestPaymentClient(async(_url,init)=>{
   const headers=new Headers(init.headers);headers.set('origin',origin);headers.set('host',new URL(origin).host);
   headers.set('x-real-ip','192.0.2.4');headers.set('cookie','__Host-blizhniy_session='+actor.token);
   return handleSpecialistCheckoutRequest(new Request(origin+'/api/account/specialist-checkout',{...init,headers}));
  });
  await enroll(owner);
  const quote=await client.preview(owner.owner,owner.id,owner.revision);
  assert.equal(quote.activePayment,null);
  const input={listingId:owner.id,expectedRevision:owner.revision,creationKey:randomUUID(),expectedTariffId:quote.tariff.id,expectedAmount:quote.tariff.amount,expectedDurationDays:quote.tariff.durationDays};
  await remove();
  await assert.rejects(client.prepare(owner.owner,input),{code:'CHECKOUT_NOT_READY'});
  assert.equal(await client.recover(owner.owner,input.creationKey),null);
  await enroll(owner);
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
  await remove();assert.deepEqual(await client.dispatch(owner.owner,first.id),link);assert.equal(writes,1);assert.equal(reads,1);
  process.env.BLIZHNIY_SPECIALIST_PAYMENT='disabled';
  assert.equal(canShowSpecialistTest(owner.owner),false);
  await assert.rejects(client.dispatch(owner.owner,first.id),{code:'CHECKOUT_DISABLED'});
  const history=await new(load('postgres-payment-history').PostgresPaymentHistoryStore)(db).readSpecialistOrder(owner.token,owner.owner,first.id);
  assert.equal(history.order.id,first.id);assert.equal(history.testPublication,true);assert.equal(history.fulfillment,null);
  assert.equal((await admin.query('select count(*)::int n from app.payment_orders where owner_id=$1',[owner.owner])).rows[0].n,1);
  assert.equal(writes,1);assert.equal(reads,1);
 }finally{
  await remove();for(const [k,v] of Object.entries(before)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
 }
}
