import {randomUUID} from 'node:crypto';
import {withAppSessionTransaction,AppSessionAccessError} from './app-session-transaction';
import {ListingDraftAccessError} from './postgres-listing-drafts';
import {PostgresListingFormStore} from './postgres-listing-form';
import {PostgresPaymentIntentStore,parsePaymentIntent,type PaymentIntent,type PaymentIntentBinding} from './postgres-payment-intents';
import {parseListingDraftId,parseListingDraftRevision} from './listing-draft-contract.ts';
import {parseListingCheckout,ListingCheckoutConflictError,ListingCheckoutUnavailableError,type ListingCheckoutInput} from './listing-checkout-contract.ts';
import type {PostgresDatabase,PostgresQueries} from './postgres';
import {inspectWorkPurchase} from './vacancy-purchase-eligibility';
import {readPostmoderationEnabled} from './listing-workflow-config';
import {inspectSpecialistPurchase} from './specialist-purchase-eligibility';
import {readSpecialistCheckoutEnabled} from './specialist-checkout-config';
import {hashSessionToken} from './identity';

export type ListingCheckoutConfig={shopId:string;isTest:boolean;siteOrigin:string;receiptVatCode:number|null};
export type ListingPaymentOrder={id:string;creationKey:string;targetId:string;targetRevision:string;tariffId:string;amount:string;durationDays:number;status:'created'|'pending'|'succeeded'|'failed'|'refunded';createdAt:string};
export type ListingPaymentSnapshot={order:ListingPaymentOrder;fulfillment:{publishedAt:string;expiresAt:string}|null;testPublication?:true;testOnly?:true};
type OrderRow=ListingPaymentOrder&{targetType:string};
type Offer={id:string;name:string;amount:string;currency:'RUB';durationDays:number};
const columns=`o.id,o.creation_key as "creationKey",o.target_type as "targetType",o.target_id as "targetId",o.target_revision::text as "targetRevision",o.status,
 i.tariff_id as "tariffId",i.amount::text,i.duration_days as "durationDays",to_char(o.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt"`;
const source='from app.payment_orders o join app.payment_checkout_intents i on i.id=o.id';
function display(row:OrderRow,targetType='listing'):ListingPaymentOrder{
 if(row.targetType!==targetType||row.durationDays===null)throw new ListingCheckoutUnavailableError();
 return{id:row.id,creationKey:row.creationKey,targetId:row.targetId,targetRevision:row.targetRevision,tariffId:row.tariffId,amount:row.amount,durationDays:row.durationDays,status:row.status,createdAt:row.createdAt};
}
function matches(row:OrderRow,input:ListingCheckoutInput,targetType='listing'){
 return row.targetType===targetType&&row.targetId===input.listingId&&row.targetRevision===input.expectedRevision&&row.creationKey===input.creationKey&&
  row.tariffId===input.expectedTariffId&&row.amount===input.expectedAmount&&row.durationDays===input.expectedDurationDays;
}
/** Local-only session/target/offer authorization. No provider fetch, settlement or publication. */
export class PostgresListingCheckoutStore{
 private readonly forms:PostgresListingFormStore;
 private readonly intents:PostgresPaymentIntentStore;
 private readonly config:ListingCheckoutConfig;
 private readonly targetType:'listing'|'vacancy'|'workRequest'|'specialist';
 constructor(private readonly db:Pick<PostgresDatabase,'transaction'>,config:ListingCheckoutConfig,private readonly policy:{postmoderation?:boolean;targetType?:'vacancy'|'workRequest'|'specialist';renewals?:boolean;publicationTestOwner?:string;testModeHistory?:boolean}={}){
  if(typeof window!=='undefined')throw new ListingCheckoutUnavailableError();
  if(policy.publicationTestOwner!==undefined&&(!config.isTest||parseListingDraftId(policy.publicationTestOwner)!==policy.publicationTestOwner||!policy.postmoderation||!readPostmoderationEnabled()))throw new ListingCheckoutUnavailableError();
  this.targetType=policy.targetType??'listing';
  if(this.targetType==='specialist'){
   readSpecialistCheckoutEnabled();
   if(process.env.BLIZHNIY_LOCAL_PRIMARY!=='enabled'||process.env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN!=='https://127.0.0.1:3045'||!readPostmoderationEnabled()||!config.isTest||config.shopId!=='local-fixture-shop'||policy.renewals||policy.publicationTestOwner)throw new ListingCheckoutUnavailableError();
  }else if(this.targetType!=='listing'&&(!['vacancy','workRequest'].includes(this.targetType)||!config.isTest||!readPostmoderationEnabled()))throw new ListingCheckoutUnavailableError();
  if(policy.renewals!==undefined&&typeof policy.renewals!=='boolean'||policy.renewals&&(!config.isTest||process.env.BLIZHNIY_LOCAL_PRIMARY!=='enabled'||!readPostmoderationEnabled()))throw new ListingCheckoutUnavailableError();
  this.forms=new PostgresListingFormStore(db,{postmoderation:policy.renewals===true,renewals:policy.renewals===true});this.intents=new PostgresPaymentIntentStore(db);this.config={...config};
 }
 private owner<T>(token:string,expectedOwner:string,work:(tx:PostgresQueries,owner:string)=>Promise<T>){
  const owner=parseListingDraftId(expectedOwner);
  if(this.policy.publicationTestOwner&&owner!==this.policy.publicationTestOwner)throw new ListingCheckoutUnavailableError();
  return withAppSessionTransaction(this.db,token,(tx,user)=>{
   if(user.id!==owner)throw new AppSessionAccessError();return work(tx,user.id);
  });
 }
 private async renewalBasis(tx:PostgresQueries,owner:string,id:string){
  if(!this.policy.renewals)return;
  const table=this.targetType==='listing'?'listings':'work_publications';
  const row=(await tx.query<{available:boolean}>(`select (not target.is_paid or
   (select count(*) from app.payment_checkout_intents i join app.payment_orders o on o.id=i.id and o.status='succeeded'
    join app.payment_fulfillments f on f.intent_id=i.id where i.owner_id=target.author_id and i.target_type=$3 and i.target_id=target.id
     and i.merchant_shop_id=$4 and i.is_test=$5 and f.published_at=target.published_at and f.expires_at=target.expires_at)=1) as available
   from app.${table} target where target.id=$1 and target.author_id=$2`,[id,owner,this.targetType,this.config.shopId,this.config.isTest])).rows[0];
  if(!row?.available)throw new ListingCheckoutUnavailableError();
 }
 private async inspected(tx:PostgresQueries,owner:string,id:string,revision:string):Promise<Offer>{
  if(this.targetType==='specialist'){
   if((await inspectSpecialistPurchase(this.db,tx,owner,id,revision,false)).issues.length)throw new ListingCheckoutUnavailableError();
   const offer=(await tx.query<Offer>(`select id,name,price::text as amount,'RUB' as currency,duration_days as "durationDays" from app.tariffs
    where id='specialist-publication' and action='specialist_publication' and active and price>0 and duration_days between 1 and 3650`)).rows[0];
   if(!offer)throw new ListingCheckoutUnavailableError();return offer;
  }
  if(this.targetType!=='listing'){
   const {issues}=await inspectWorkPurchase(this.db,tx,owner,id,revision,this.targetType,false,this.policy.renewals===true);
   if(issues.length)throw new ListingCheckoutUnavailableError();
   const offer=(await tx.query<Offer>(`select id,name,price::text as amount,'RUB' as currency,duration_days as "durationDays"
    from app.tariffs where id=$1 and action=$2 and active and price>0 and duration_days between 1 and 3650`,
    this.targetType==='vacancy'?['vacancy-publication','vacancy_publication']:['work-request-publication','work_request_publication'])).rows[0];
   if(!offer)throw new ListingCheckoutUnavailableError();await this.renewalBasis(tx,owner,id);return offer;
  }
  const {check}=await this.forms.inspectInTransaction(tx,owner,id,revision,this.policy.renewals===true);
  if(!check.checksPassed||!check.tariff||check.tariff.amount==='0.00')throw new ListingCheckoutUnavailableError();
  if(this.policy.postmoderation){
   const blocked=await tx.query('select listing_id from app.listing_blocks where listing_id=$1',[id]);
   if(blocked.rowCount!==0)throw new ListingCheckoutUnavailableError();
   if(this.policy.renewals){
    const current=(await tx.query<{available:boolean}>(`select (not is_paid and status='draft' and published_at is null and expires_at is null or
     is_paid and published_at is not null and expires_at is not null and
      (status='published' or status in ('archived','expired') and expires_at<=clock_timestamp())) and
     not exists(select 1 from app.listing_owner_removals r where r.listing_id=l.id) as available from app.listings l where id=$1`,[id])).rows[0];
    if(!current?.available)throw new ListingCheckoutUnavailableError();
   }
  }else{
   const approval=await tx.query(`select id from app.listing_moderation where listing_id=$1 and revision=$2::bigint and state='approved' for share`,[id,revision]);
   if(approval.rowCount!==1)throw new ListingCheckoutUnavailableError();
  }
  await this.renewalBasis(tx,owner,id);return check.tariff;
 }
 private async keyed(tx:PostgresQueries,owner:string,key:string){
  return(await tx.query<OrderRow>(`select ${columns} ${source} where o.owner_id=$1 and o.creation_key=$2`,[owner,key])).rows[0];
 }
 private async active(tx:PostgresQueries,owner:string,id:string){
  return(await tx.query<OrderRow>(`select ${columns} ${source} where o.owner_id=$1 and o.target_type='${this.targetType}' and o.target_id=$2 and
   ${this.policy.renewals?"(o.status in ('created','pending') or o.status='succeeded' and not exists(select 1 from app.payment_fulfillments f where f.intent_id=o.id))":"o.status in ('created','pending','succeeded')"}`,[owner,id])).rows[0];
 }
 async preview(token:string,owner:string,listingId:unknown,expectedRevision:unknown){
  if(this.targetType==='specialist'&&!readSpecialistCheckoutEnabled())throw new ListingCheckoutUnavailableError();
  const id=parseListingDraftId(listingId),revision=parseListingDraftRevision(expectedRevision);
  return this.owner(token,owner,async(tx,actor)=>{
   const tariff=await this.inspected(tx,actor,id,revision),active=await this.active(tx,actor,id);
   return{listingId:id,revision,tariff,activePayment:active?display(active,this.targetType):null};
  });
 }
 async readIntent(token:string,owner:string,creationKey:unknown){
  const key=parseListingDraftId(creationKey);return this.owner(token,owner,async(tx,actor)=>{
   const row=await this.keyed(tx,actor,key);return row?display(row,this.targetType):null;
  });
 }
 /** Fresh session/owner authority for a saved intent; only a new POST requires current purchase eligibility.
  * A known provider ID remains recoverable after edits or tariff changes, never a new purchase.
  */
 async authorizeDispatch(token:string,owner:string,paymentId:unknown,requireCurrent=false):Promise<PaymentIntentBinding>{
  if(this.targetType==='specialist'&&!readSpecialistCheckoutEnabled())throw new ListingCheckoutUnavailableError();
  const id=parseListingDraftId(paymentId);
  return this.owner(token,owner,async(tx,actor)=>{
   const row=(await tx.query<PaymentIntent&{status:string}>(`select i.id,i.owner_id as "ownerId",i.target_type as "targetType",i.target_id as "targetId",
    i.target_revision::text as "targetRevision",i.tariff_id as "tariffId",i.amount::text,i.duration_days as "durationDays",
    i.merchant_shop_id as "shopId",i.is_test as "isTest",i.request_body as "requestBody",o.status
    from app.payment_orders o join app.payment_checkout_intents i on i.id=o.id and i.owner_id=o.owner_id
     and i.target_type=o.target_type and i.target_id=o.target_id and i.target_revision=o.target_revision
    where o.id=$1 and o.owner_id=$2 and o.target_type='${this.targetType}' and i.merchant_shop_id=$3 and i.is_test=$4`,
   [id,actor,this.config.shopId,this.config.isTest])).rows[0];
   if(!row)throw new ListingDraftAccessError();
   if(this.targetType==='specialist'&&(await tx.query('select intent_id from app.specialist_checkout_terms where intent_id=$1',[id])).rowCount!==1)throw new ListingCheckoutUnavailableError();
   const {status,...input}=row,intent=parsePaymentIntent(input);
   if(this.policy.publicationTestOwner&&JSON.parse(intent.requestBody).metadata.publicationMode!=='account-test-v1')throw new ListingCheckoutUnavailableError();
   if(requireCurrent){
    const known=(await tx.query('select provider_payment_id from app.payment_provider_links where intent_id=$1',[id])).rowCount===1;
    if(!known){
     if(status!=='created'||!JSON.parse(intent.requestBody).receipt)throw new ListingCheckoutUnavailableError();
     const offer=await this.inspected(tx,actor,intent.targetId,intent.targetRevision);
     if(offer.id!==intent.tariffId||offer.amount!==intent.amount||offer.durationDays!==intent.durationDays)throw new ListingCheckoutConflictError();
    }
   }
   return{id:intent.id,ownerId:intent.ownerId,targetType:intent.targetType,targetId:intent.targetId,targetRevision:intent.targetRevision,
    tariffId:intent.tariffId,amount:intent.amount,durationDays:intent.durationDays,shopId:intent.shopId,isTest:intent.isTest};
  });
 }
 /** Historical purchased period (only its added interval for renewals), not current visibility. No provider I/O. */
 async readOrder(token:string,owner:string,paymentId:unknown):Promise<ListingPaymentSnapshot|null>{
  const id=parseListingDraftId(paymentId);return this.owner(token,owner,async(tx,actor)=>{
   const row=(await tx.query<OrderRow&{publishedAt:string|null;expiresAt:string|null;testPublication:boolean;testOnly:boolean}>(`select ${columns},i.is_test as "testOnly",
    coalesce(i.is_test and (i.request_body::jsonb->'metadata'->>'publicationMode'='account-test-v1'${this.targetType==='specialist'?' or exists(select 1 from app.specialist_checkout_terms admitted where admitted.intent_id=i.id)':''}),false) as "testPublication",
    to_char(${this.policy.renewals?"greatest(f.published_at,f.expires_at-i.duration_days*interval '24 hours')":'f.published_at'} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "publishedAt",
    to_char(f.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expiresAt"
    ${source} left join app.payment_fulfillments f on f.intent_id=o.id
    where o.id=$1 and o.owner_id=$2 and o.target_type='${this.targetType}' and i.merchant_shop_id=$3 and i.is_test=$4`,
    [id,actor,this.config.shopId,this.config.isTest])).rows[0];
   if(!row)return null;
   return{order:display(row,this.targetType),fulfillment:row.publishedAt&&row.expiresAt?{publishedAt:row.publishedAt,expiresAt:row.expiresAt}:null,...(row.testPublication?{testPublication:true as const}:{}),...(this.policy.testModeHistory&&row.testOnly?{testOnly:true as const}:{})};
  });
 }
 private async intent(tx:PostgresQueries,owner:string,id:string,input:ListingCheckoutInput,offer:Offer):Promise<PaymentIntent>{
  let origin:string;try{
   const site=new URL(this.config.siteOrigin);
   if(site.protocol!=='https:'||site.username||site.password||site.port||site.pathname!=='/'||site.search||site.hash||/[\s\\\u0000-\u001f\u007f]/.test(this.config.siteOrigin))throw new Error('Invalid checkout origin');
   origin=site.origin;
  }catch{throw new ListingCheckoutUnavailableError();}
  const amount={value:offer.amount,currency:'RUB'},description=this.targetType==='specialist'?'Размещение анкеты специалиста':this.targetType==='vacancy'?'Размещение вакансии':this.targetType==='workRequest'?'Размещение заказа':'Размещение объявления';
  let receipt:object|undefined;
  if(this.config.receiptVatCode!==null){
   const vat=this.config.receiptVatCode;
   if(!Number.isInteger(vat)||vat<1||vat>12)throw new ListingCheckoutUnavailableError();
   const payer=(await tx.query<{email:string}>('select email from app.users where id=$1 and email_verified_at is not null and not is_blocked',[owner])).rows[0];
   if(!payer)throw new AppSessionAccessError();
   receipt={customer:{email:payer.email.trim().toLowerCase()},internet:true,items:[{amount,description,payment_mode:'full_payment',payment_subject:'service',quantity:1,vat_code:vat}]};
  }
  return parsePaymentIntent({id,ownerId:owner,targetType:this.targetType,targetId:input.listingId,targetRevision:input.expectedRevision,
   tariffId:offer.id,amount:offer.amount,durationDays:offer.durationDays,shopId:this.config.shopId,isTest:this.config.isTest,
   requestBody:JSON.stringify({amount,capture:true,confirmation:{type:'redirect',return_url:`${origin}/oplata/${id}${this.targetType!=='listing'?'?type='+this.targetType:''}`},description,
    metadata:{localPaymentId:id,targetId:input.listingId,targetType:this.targetType,tariffId:offer.id,...(this.policy.publicationTestOwner?{publicationMode:'account-test-v1'}:{})},...(receipt?{receipt}:{})})});
 }
 async prepare(token:string,owner:string,value:unknown){
  if(this.targetType==='specialist'&&!readSpecialistCheckoutEnabled())throw new ListingCheckoutUnavailableError();
  const input=parseListingCheckout(value);return this.owner(token,owner,async(tx,actor)=>{
   // A readback never rebuilds old receipts or silently swaps the original expected offer.
   const prior=await this.keyed(tx,actor,input.creationKey);
   if(prior){if(!matches(prior,input,this.targetType))throw new ListingCheckoutConflictError();return display(prior,this.targetType);}
   const offer=await this.inspected(tx,actor,input.listingId,input.expectedRevision);
   if(offer.id!==input.expectedTariffId||offer.amount!==input.expectedAmount||offer.durationDays!==input.expectedDurationDays)throw new ListingCheckoutConflictError();
   if(await this.active(tx,actor,input.listingId))throw new ListingCheckoutConflictError();
   const id=randomUUID();
   const inserted=await tx.query(`insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision)
    values($1,$2,$3,'${this.targetType}',$4,$5::bigint) on conflict do nothing returning id`,[id,actor,input.creationKey,input.listingId,input.expectedRevision]);
   if(inserted.rowCount!==1){
    const winner=await this.keyed(tx,actor,input.creationKey);if(!winner||!matches(winner,input,this.targetType))throw new ListingCheckoutConflictError();return display(winner,this.targetType);
   }
   const intent=await this.intent(tx,actor,id,input,offer);
   await this.intents.persistInTransaction(tx,intent);
   if(this.targetType==='specialist'){
    await tx.query("select set_config('blizhniy.specialist_checkout_session',$1,true)",[hashSessionToken(token)]);
    await tx.query('insert into app.specialist_checkout_terms(intent_id) values($1)',[id]);
   }
   const saved=await this.keyed(tx,actor,input.creationKey);if(!saved)throw new ListingCheckoutUnavailableError();return display(saved,this.targetType);
  });
 }
}
