// Trusted LOCAL provider simulator. It never connects to YooKassa or loads a real merchant.
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {readPlacementRenewalsEnabled} from '../src/lib/placement-renewal-config.ts';
import {readServiceCheckoutEnabled} from '../src/lib/service-checkout-config.ts';
import {readSpecialistCheckoutEnabled} from '../src/lib/specialist-checkout-config.ts';
export const localPrimaryMerchant=Object.freeze({shopId:'local-fixture-shop',isTest:true,secretKey:'test_local-fixture-never-a-real-key'});
const canonical='https://xn----9sbphbgks4a4a.xn--p1ai',merchant=localPrimaryMerchant;
const instances=new WeakMap();
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// A browser's native no-cors form POST sends Origin:null with no-referrer.
// Same-origin retains the local CSRF origin and never leaks its URL cross-origin.
const html=(body,status=200)=>new Response(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Локальная оплата — БЛИЖНИЙ</title><style>body{font:16px system-ui;max-width:560px;margin:40px auto;padding:20px;color:#16304a}button,a{display:inline-block;margin:8px;padding:12px;border:1px solid #b8c9df;border-radius:8px}button{cursor:pointer}p{line-height:1.6}</style><h1>Локальная симуляция оплаты</h1>${body}</html>`,{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'same-origin','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"}});
// Fence each new simulator side effect, not only the earlier runtime admission.
// A fresh statement after the work lock observes a concurrent executor selection.
export async function lockLocalPaymentTarget(tx,id){
 const target=(await tx.query(`select w.id,w.kind from app.payment_checkout_intents i
  left join app.applications a on i.target_type='application' and a.id=i.target_id
  join app.work_publications w on w.id=case when i.target_type='application' then a.work_publication_id else i.target_id end
  where i.id=$1 and i.target_type in ('application','workRequest') and w.kind='workRequest' for update of w`,[id])).rows[0];
 if(target&&(await tx.query("select id from app.applications where work_publication_id=$1 and status='selected' and is_paid and sent_at is not null",[target.id])).rowCount)throw Error('Local work request already assigned');
}
async function create(context,targetType){
 const {state,ownerDb,runtimeDb,load}=context;
 if(process.env.NODE_ENV!=='test'||!load('listing-workflow-config').readPostmoderationEnabled()||state.origin!==process.env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN)throw Error('Local provider disabled');
 await ownerDb.query(await readFile(new URL('../database/local-primary-payment.sql',import.meta.url),'utf8'));
 const service=['fair','marquee'].includes(targetType);if(service&&!readServiceCheckoutEnabled())throw Error('Local service checkout disabled');
 if(targetType==='specialist'&&!readSpecialistCheckoutEnabled())throw Error('Local specialist checkout disabled');
 const policy={postmoderation:true,...(targetType!=='specialist'&&readPlacementRenewalsEnabled()?{renewals:true}:{}),...(targetType!=='listing'?{targetType}:{})};
 const store=service?new(load('postgres-service-checkout').PostgresServiceCheckoutStore)(runtimeDb,{...merchant,siteOrigin:canonical,receiptVatCode:1},targetType):targetType==='application'?new(load('postgres-application-checkout').PostgresApplicationCheckoutStore)(runtimeDb,async id=>(await ownerDb.query(`select to_char(sent_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as stamp from local_primary.application_deliveries where intent_id=$1`,[id])).rows[0]?.stamp??null,async(token,owner,id)=>{
  if(await recoverExistingProvider(token,owner,id))await verification.reconcile(id);
 }):new(load('postgres-listing-checkout').PostgresListingCheckoutStore)(runtimeDb,{...merchant,siteOrigin:canonical,receiptVatCode:1},policy);
 const identity=new(load('identity').IdentityStore)(runtimeDb),limiter=new(load('auth-http').AuthRateLimiter)(runtimeDb,state.rateSecret);
 async function response(row){
  const original=(await ownerDb.query('select amount::text,request_body from app.payment_checkout_intents where id=$1',[row.intent_id])).rows[0];
  const body=JSON.parse(original.request_body);
  return{id:row.provider_id,status:row.status,paid:row.status==='succeeded',test:true,amount:{value:original.amount,currency:'RUB'},recipient:{account_id:merchant.shopId},metadata:body.metadata,
   ...(row.status==='succeeded'?{captured_at:row.captured_at}:row.status==='pending'?{confirmation:{type:'redirect',confirmation_url:`https://yookassa.ru/local-fixture/${row.provider_id}`}}:{})};
 }
 const fakeFetch=async(input,init={})=>{
  if(targetType==='specialist'&&!readSpecialistCheckoutEnabled())throw Error('Local specialist checkout disabled');
  const url=new URL(String(input));
  if(url.origin!=='https://api.yookassa.ru'||!/^\/v3\/payments(?:\/[a-f0-9-]{36})?$/.test(url.pathname))throw Error('External provider disabled');
  const headers=new Headers(init.headers);
  if(headers.get('authorization')!==`Basic ${Buffer.from(`${merchant.shopId}:${merchant.secretKey}`).toString('base64')}`)throw Error('Local merchant mismatch');
  let row;
  if(init.method==='POST'&&url.pathname==='/v3/payments'){
   const intent=load('listing-draft-contract').parseListingDraftId(headers.get('idempotence-key'));
   const original=(await ownerDb.query('select request_body,merchant_shop_id,is_test from app.payment_checkout_intents where id=$1',[intent])).rows[0];
   if(!original||original.request_body!==init.body||original.merchant_shop_id!==merchant.shopId||original.is_test!==true)throw Error('Local intent mismatch');
   row=await ownerDb.transaction(async tx=>{
    if(targetType==='specialist'&&!readSpecialistCheckoutEnabled())throw Error('Local specialist checkout disabled');
    const existing=(await tx.query('select * from local_primary.provider_payments where intent_id=$1',[intent])).rows[0];if(existing)return existing;
    if(targetType==='specialist'){
     const purchase=(await tx.query('select owner_id as owner,target_id as target,target_revision::text as revision from app.payment_checkout_intents where id=$1',[intent])).rows[0];
     if(!purchase)throw Error('Local specialist purchase unavailable');
     await tx.query('select id from app.users where id=$1 for update',[purchase.owner]);
     const committed=(await tx.query('select * from local_primary.provider_payments where intent_id=$1',[intent])).rows[0];if(committed)return committed;
     if((await load('specialist-purchase-eligibility').inspectSpecialistPurchase(ownerDb,tx,purchase.owner,purchase.target,purchase.revision)).issues.length)throw Error('Local specialist purchase changed');
    }
    await lockLocalPaymentTarget(tx,intent);
    await tx.query("insert into local_primary.provider_payments(intent_id,provider_id,status) values($1,$2,'pending') on conflict(intent_id) do nothing",[intent,randomUUID()]);
    return(await tx.query('select * from local_primary.provider_payments where intent_id=$1',[intent])).rows[0];
   });
  }else if(init.method==='GET')row=(await ownerDb.query('select * from local_primary.provider_payments where provider_id=$1',[url.pathname.split('/').at(-1)])).rows[0];
  if(!row)throw Error('Unknown local provider payment');
  return Response.json(await response(row));
 };
 const dispatch=load('primary-payment-dispatch').createPrimaryPaymentDispatcher(runtimeDb,merchant,fakeFetch);
 const verification=new(load('postgres-payment-verification').PostgresPaymentVerificationStore)(ownerDb,merchant,fakeFetch);
 const fulfillment=service?new(load('postgres-service-payment-fulfillment').PostgresServicePaymentFulfillmentStore)(ownerDb,merchant):targetType==='application'?new(load('postgres-application-fulfillment').PostgresApplicationFulfillmentStore)(ownerDb):new(load('postgres-listing-payment-fulfillment').PostgresListingPaymentFulfillmentStore)(ownerDb,merchant,policy);
 async function recoverExistingProvider(token,owner,id){
  const binding=await store.authorizeDispatch(token,owner,id);
  // Recover a simulator commit whose response/link was lost, even after closure.
  // This reads the original provider identity; it cannot insert or capture money.
  const existing=(await ownerDb.query('select * from local_primary.provider_payments where intent_id=$1',[id])).rows[0];
  if(existing){
   const verified=load('yookassa-payment-contract').validatePrimaryYooKassaPayment(await response(existing),binding,Date.now());
   await new(load('postgres-payment-intents').PostgresPaymentIntentStore)(runtimeDb).bindProvider(binding,verified.id);
  }
  return existing?binding:null;
 }
 if(targetType==='application')return{store,identity,verification,fulfillment,handler:load('application-checkout-http').createApplicationCheckoutHandler(canonical,{store,limiter,dispatch:async(token,owner,id)=>{
  const binding=await recoverExistingProvider(token,owner,id)??await store.authorizeDispatch(token,owner,id);
  const result=await dispatch.dispatch(binding,()=>store.authorizeDispatch(token,owner,id,true));await store.authorizeDispatch(token,owner,id);return{confirmationUrl:result.confirmationUrl,isTest:true};
 }})};
 if(service)return{store,identity,verification,fulfillment,handler:load('service-checkout-http').createServiceCheckoutHandler({origin:canonical},targetType,{store,limiter,dispatch:async(token,owner,id)=>{
  const binding=await recoverExistingProvider(token,owner,id)??await store.authorizeDispatch(token,owner,id);const result=await dispatch.dispatch(binding,()=>store.authorizeDispatch(token,owner,id,true));await store.authorizeDispatch(token,owner,id);return{confirmationUrl:result.confirmationUrl,isTest:true};
 }})};
 const handler=load('listing-checkout-http').createListingCheckoutHandler({origin:canonical},()=>({store,limiter,payments:{
  preview:(...args)=>store.preview(...args),
  dispatch:async(token,owner,id)=>{const binding=(targetType==='specialist'?await recoverExistingProvider(token,owner,id):null)??await store.authorizeDispatch(token,owner,id);const result=await dispatch.dispatch(binding,()=>store.authorizeDispatch(token,owner,id,true));await store.authorizeDispatch(token,owner,id);return{confirmationUrl:result.confirmationUrl,isTest:true};},
 }}));
 return{handler,store,identity,verification,fulfillment};
}
export async function localPrimaryPaymentHandler(request,context){
 const url=new URL(request.url);
 if(!['/api/account/specialist-checkout','/api/account/fair-checkout','/api/account/marquee-checkout','/api/account/application-checkout','/api/account/listing-checkout','/api/account/vacancy-checkout','/api/account/work-request-checkout','/__local/payment'].includes(url.pathname))return null;
 if(url.pathname==='/__local/payment'&&url.searchParams.has('type')&&!['specialist','vacancy','workRequest','application','fair','marquee'].includes(url.searchParams.get('type')))return html('<p>Неизвестный тип заказа.</p>',422);
 const targetType=url.pathname==='/api/account/specialist-checkout'?'specialist':url.pathname==='/api/account/fair-checkout'?'fair':url.pathname==='/api/account/marquee-checkout'?'marquee':url.pathname==='/api/account/application-checkout'?'application':url.pathname==='/api/account/work-request-checkout'?'workRequest':url.pathname==='/api/account/vacancy-checkout'?'vacancy':url.pathname==='/__local/payment'?url.searchParams.get('type')??'listing':'listing';
 if(targetType==='specialist'&&!readSpecialistCheckoutEnabled()){
  if(process.env.NODE_ENV!=='test'||context.state.origin!==process.env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN||url.pathname==='/__local/payment'||request.method!=='POST')return html('<p>Оплата анкеты отключена.</p>',404);
  return context.load('listing-checkout-http').createListingCheckoutHandler({origin:canonical},()=>({
   store:new(context.load('postgres-listing-checkout').PostgresListingCheckoutStore)(context.runtimeDb,{...merchant,siteOrigin:canonical,receiptVatCode:1},{postmoderation:true,targetType:'specialist',testModeHistory:true}),
   limiter:new(context.load('auth-http').AuthRateLimiter)(context.runtimeDb,context.state.rateSecret),
  }),undefined,{readOnly:true})(request);
 }
 const service=['fair','marquee'].includes(targetType);if(service&&!readServiceCheckoutEnabled())return html('<p>Оплата услуги отключена.</p>',404);
 const paymentPath=service?'/oplata/uslugi':'/oplata';
 const returnQuery=targetType==='listing'?'':'?type='+targetType,formQuery=targetType==='listing'?'':'&amp;type='+targetType,cabinet=targetType==='specialist'?'/cabinet/specialist':targetType==='fair'?'/cabinet/fair-applications':targetType==='marquee'?'/reklama/begushchaya-stroka?view=list':targetType==='application'?'/cabinet/otkliki':targetType==='workRequest'?'/cabinet/zakazy':targetType==='vacancy'?'/cabinet/vakansii':'/cabinet/obyavleniya';
 let group=instances.get(context.ownerDb);if(!group){group=new Map();instances.set(context.ownerDb,group);}
 let instance=group.get(targetType);
 if(!instance){instance=create(context,targetType);group.set(targetType,instance);}
 const state=await instance;
 if(url.pathname!=='/__local/payment'){
  const retry=request.clone(),reply=await state.handler(request);
  if(targetType==='application'||reply.status!==200)return reply;
  const snapshot=await reply.clone().json();
  if(snapshot?.order?.status==='succeeded'&&snapshot.fulfillment===null){
   try{await state.fulfillment.fulfill(snapshot.order.id);}
   catch(error){if(error?.code==='P7601')return reply;throw error;}
   return state.handler(retry);
  }
  return reply;
 }
 try{
  const token=context.load('account-cookie').readAccountSessionToken(request);
  const user=token?await state.identity.resolveSession(token):null;
  if(!user)return html('<p>Войдите в свой локальный аккаунт.</p><a href="/auth">Войти</a>',401);
  const id=context.load('listing-draft-contract').parseListingDraftId(url.searchParams.get('intent'));
  const order=await state.store.readOrder(token,user.id,id);if(!order)return html('<p>Заказ недоступен.</p>',404);
  if(service&&order.order.status==='refunded')return html(`<p>Плата возвращена. История размещения сохранена.</p><a href="${paymentPath}/${id}${returnQuery}">Статус заказа</a>`);
  if(request.method==='POST'){
   if(request.headers.get('origin')!==canonical||request.headers.get('sec-fetch-site')!=='same-origin')return html('<p>Нужен запрос с локальной страницы оплаты.</p>',403);
   const data=await request.formData(),action=data.get('action');
   if([...data.keys()].join()!=='action'||!['succeed','cancel','pending'].includes(action))return html('<p>Неизвестное действие.</p>',422);
   await context.ownerDb.transaction(async tx=>{
    if(targetType==='specialist'&&!readSpecialistCheckoutEnabled())throw Error('Local specialist checkout disabled');
    const original=(await tx.query('select status from local_primary.provider_payments where intent_id=$1',[id])).rows[0];
    // Never capture a row inserted after this read by a concurrent first dispatch.
    if(original?.status!=='pending')return;
    if(action==='succeed')await lockLocalPaymentTarget(tx,id);
    if(targetType==='specialist'&&!readSpecialistCheckoutEnabled())throw Error('Local specialist checkout disabled');
    await tx.query(`update local_primary.provider_payments set status=$2,captured_at=case when $2='succeeded' then to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') else null end where intent_id=$1 and status='pending'`,[id,action==='succeed'?'succeeded':action==='cancel'?'canceled':'pending']);
   });
   await state.verification.reconcile(id);
   let result;
   try{result=await state.fulfillment.fulfill(id);}
   catch(error){if(error?.code==='P7601')return html(`<p>Оплата подтверждена. Для размещения подтвердите номер телефона. Повторно платить не нужно.</p><a href="${paymentPath}/${id}${returnQuery}">Подтвердить телефон и проверить размещение</a>`);throw error;}
   return html(`<p>${result.state==='fulfilled'?targetType==='application'?'Оплата подтверждена сервером, отклик доставлен.':'Оплата подтверждена сервером, размещение выполнено. Текущий статус смотрите в кабинете.':result.state==='queued'?'Оплата подтверждена. Реклама ожидает свободное место; оплаченный срок ещё не начался.':'Результат записан. Действие не выполнено: '+escape(result.reason)}</p><a href="${paymentPath}/${id}${returnQuery}">Статус заказа</a><a href="${cabinet}">Мои публикации</a>`);
  }
  if(request.method!=='GET')return html('<p>Метод недоступен.</p>',405);
  if(order.targetClosed&&!order.deliveredAt)return html(`<p>Заказчик уже выбрал исполнителя. Новая оплата отклика недоступна; история сохранена.</p><a href="${paymentPath}/${id}${returnQuery}">Статус заказа</a>`);
  return html(`<p>Заказ: ${escape(order.order.amount)} ₽${targetType==='application'?' за один отклик':targetType==='fair'?` до конца ярмарки ${escape(order.order.fairEvent.date)}`:` за ${order.order.durationDays} дн.`} Никаких банковских данных вводить не нужно. Это не ЮKassa и не реальная оплата.</p><form method="post" action="/__local/payment?intent=${id}${formQuery}"><button name="action" value="succeed">Подтвердить успешную оплату</button><button name="action" value="cancel">Отменить оплату</button><button name="action" value="pending">Оставить в ожидании</button></form><a href="${paymentPath}/${id}${returnQuery}">Назад к заказу</a>`);
 }catch{return html(`<p>Не удалось подтвердить результат. Не создавайте новый заказ; проверьте исходный в кабинете.</p><a href="${cabinet}">Мои публикации</a>`,503);}
}
