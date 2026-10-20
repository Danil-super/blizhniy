import {createPrimaryPaymentDispatcher} from './primary-payment-dispatch.ts';
import {PostgresPaymentVerificationStore} from './postgres-payment-verification.ts';
import {parsePaymentIntent,type PaymentIntent,type PaymentIntentBinding} from './postgres-payment-intents.ts';
import type {PostgresDatabase} from './postgres.ts';

export type TestPaymentFixture={orderId:string;ownerId:string;listingId:string;creationKey:string};
type Merchant={shopId:string;secretKey:string;isTest:boolean;siteOrigin:string};
type ProbeRow=PaymentIntent&{
 syntheticEmail:string;blocked:boolean;sessionCount:number;listingStatus:string;paid:boolean;
 publishedAt:unknown;expiresAt:unknown;listingRevision:string;approvedRevision:string;moderationState:string;
 creationKey:string;orderStatus:string;fulfillmentCount:number;linked:boolean;
};
const uuid=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const refuse=():never=>{throw new Error('Closed synthetic TEST fixture required');};

/** Explicit trusted operator tool. NEVER expose this as HTTP or use it for a customer checkout.
 * Uses existing immutable dispatch/GET verification; never fulfills, enqueues or publishes a target.
 * A blocked synthetic owner without sessions is intentional isolation, not a user admission bypass.
 */
export function createPrimaryTestPaymentProbe(db:Pick<PostgresDatabase,'transaction'>,config:Merchant,fetcher:typeof fetch=globalThis.fetch){
 const merchant={...config};
 let origin:URL;
 try{origin=new URL(merchant.siteOrigin);}catch{return refuse();}
 if(merchant.isTest!==true||typeof merchant.secretKey!=='string'||!merchant.secretKey.startsWith('test_')||
  !/^[0-9]{1,64}$/.test(merchant.shopId)||origin.protocol!=='https:'||origin.origin!==merchant.siteOrigin)return refuse();
 const dispatcher=createPrimaryPaymentDispatcher(db,merchant,fetcher),verification=new PostgresPaymentVerificationStore(db,merchant,fetcher);
 async function inspect(fixture:TestPaymentFixture):Promise<PaymentIntentBinding>{
  if(!fixture||![fixture.orderId,fixture.ownerId,fixture.listingId,fixture.creationKey].every(uuid))return refuse();
  return db.transaction(async tx=>{
   const rows=(await tx.query<ProbeRow>(`select i.id,i.owner_id as "ownerId",i.target_type as "targetType",i.target_id as "targetId",
    i.target_revision::text as "targetRevision",i.tariff_id as "tariffId",i.amount::text,i.duration_days as "durationDays",
    i.merchant_shop_id as "shopId",i.is_test as "isTest",i.request_body as "requestBody",
    u.email as "syntheticEmail",u.is_blocked as blocked,
    (select count(*)::int from app.sessions s where s.user_id=u.id) as "sessionCount",
    l.status as "listingStatus",l.is_paid as paid,l.published_at as "publishedAt",l.expires_at as "expiresAt",
    l.revision::text as "listingRevision",m.revision::text as "approvedRevision",m.state as "moderationState",
    o.creation_key as "creationKey",o.status as "orderStatus",
    (select count(*)::int from app.payment_fulfillments f where f.intent_id=i.id) as "fulfillmentCount",
    exists(select 1 from app.payment_provider_links p where p.intent_id=i.id) as linked
    from app.payment_orders o join app.payment_checkout_intents i on i.id=o.id and i.owner_id=o.owner_id
     and i.target_id=o.target_id and i.target_type=o.target_type and i.target_revision=o.target_revision
    join app.users u on u.id=o.owner_id join app.listings l on l.id=o.target_id and l.author_id=u.id
    join app.listing_moderation m on m.listing_id=l.id
    where o.id=$1 and o.owner_id=$2 and o.target_id=$3 and o.creation_key=$4 and o.target_type='listing'`,
   [fixture.orderId,fixture.ownerId,fixture.listingId,fixture.creationKey])).rows;
   if(rows.length!==1)return refuse();
   const row=rows[0];
   if(row.id!==fixture.orderId||row.ownerId!==fixture.ownerId||row.targetId!==fixture.listingId||row.targetType!=='listing'||row.creationKey!==fixture.creationKey||
    row.syntheticEmail!==`checkout-${fixture.ownerId}@example.com`||row.blocked!==true||row.sessionCount!==0||
    row.listingStatus!=='draft'||row.paid!==false||row.publishedAt!==null||row.expiresAt!==null||row.fulfillmentCount!==0||
    row.listingRevision!==row.targetRevision||row.approvedRevision!==row.targetRevision||row.moderationState!=='approved'||
    row.isTest!==true||row.shopId!==merchant.shopId||(!row.linked&&row.orderStatus!=='created'))return refuse();
   const intent=parsePaymentIntent({id:row.id,ownerId:row.ownerId,targetType:row.targetType,targetId:row.targetId,targetRevision:row.targetRevision,
    tariffId:row.tariffId,amount:row.amount,durationDays:row.durationDays,shopId:row.shopId,isTest:row.isTest,requestBody:row.requestBody});
   const body=JSON.parse(intent.requestBody);
   if(!body.receipt||body.receipt.customer.email!==row.syntheticEmail||body.receipt.items[0].vat_code!==1||
    body.receipt.items[0].description!=='Размещение объявления'||body.description!=='Размещение объявления'||
    body.confirmation.return_url!==`${merchant.siteOrigin}/oplata/${intent.id}`)return refuse();
   const {requestBody:original,...binding}=intent;
   // The dispatcher checks the immutable bytes/hash again before every POST attempt.
   if(!original)return refuse();
   return binding;
  },{readOnly:true});
 }
 return{
  inspect,
  async dispatch(fixture:TestPaymentFixture){
   const binding=await inspect(fixture),linked=await dispatcher.dispatch(binding);
   await inspect(fixture);
   const state=await verification.reconcile(binding.id);
   await inspect(fixture);
   return{...linked,status:state.status,orderStatus:state.orderStatus};
  },
  async reconcile(fixture:TestPaymentFixture){
   const binding=await inspect(fixture),state=await verification.reconcile(binding.id);
   await inspect(fixture);
   return{status:state.status,orderStatus:state.orderStatus};
  },
 };
}
