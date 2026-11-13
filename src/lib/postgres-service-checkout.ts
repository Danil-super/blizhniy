import {randomUUID} from 'node:crypto';
import {withAppSessionTransaction,AppSessionAccessError} from './app-session-transaction';
import {PostgresServicePublicationStore,ServicePublicationAccessError} from './postgres-service-publications';
import {PostgresPaymentIntentStore,parsePaymentIntent,type PaymentIntent,type PaymentIntentBinding} from './postgres-payment-intents';
import {parseListingDraftId,parseListingDraftRevision} from './listing-draft-contract.ts';
import {parseServiceCheckout,ServiceCheckoutConflictError,ServiceCheckoutUnavailableError,type PaidServiceKind,type ServiceCheckoutInput} from './service-checkout-contract.ts';
import type {ListingCheckoutConfig} from './postgres-listing-checkout';
import type {PostgresDatabase,PostgresQueries} from './postgres';
type Event={date:string;endsAt:string};
type Offer={id:string;name:string;amount:string;durationDays:number|null};
export type ServicePaymentOrder={id:string;creationKey:string;targetId:string;targetRevision:string;tariffId:string;amount:string;durationDays:number|null;status:'created'|'pending'|'succeeded'|'failed'|'refunded';createdAt:string;fairEvent:Event|null};
export type ServicePaymentSnapshot={order:ServicePaymentOrder;eventEnded:boolean;fulfillment:{publishedAt:string;expiresAt:string}|null};
type Row=Omit<ServicePaymentOrder,'fairEvent'>&{fairDate:string|null;fairEndsAt:string|null};
const columns=`o.id,o.creation_key as "creationKey",o.target_id as "targetId",o.target_revision::text as "targetRevision",o.status,
 i.tariff_id as "tariffId",i.amount::text,i.duration_days as "durationDays",to_char(o.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",
 terms.fair_date::text as "fairDate",to_char(terms.fair_ends_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "fairEndsAt"`;
const source='from app.payment_orders o join app.payment_checkout_intents i on i.id=o.id join app.service_payment_terms terms on terms.intent_id=i.id';
function display(row:Row):ServicePaymentOrder{
 const {fairDate,fairEndsAt,...order}=row;
 if((fairDate===null)!==(fairEndsAt===null))throw new ServiceCheckoutUnavailableError();
 return{...order,fairEvent:fairDate&&fairEndsAt?{date:fairDate,endsAt:fairEndsAt}:null};
}
function matches(row:Row,input:ServiceCheckoutInput){return row.targetId===input.publicationId&&row.targetRevision===input.expectedRevision&&row.creationKey===input.creationKey&&row.tariffId===input.expectedTariffId&&row.amount===input.expectedAmount&&row.durationDays===input.expectedDurationDays&&row.fairDate===input.expectedFairDate;}
/** Session-authorized preparation only. Importing/constructing never dispatches, settles or publishes. */
export class PostgresServiceCheckoutStore{
 private readonly forms:PostgresServicePublicationStore;
 private readonly intents:PostgresPaymentIntentStore;
 private readonly config:ListingCheckoutConfig;
 private readonly targetType:'fair_application'|'ad_marquee';
 constructor(private readonly db:Pick<PostgresDatabase,'transaction'>,config:ListingCheckoutConfig,private readonly kind:PaidServiceKind){
  if(typeof window!=='undefined'||!config||config.isTest!==true||!['fair','marquee'].includes(kind))throw new ServiceCheckoutUnavailableError();
  this.config={...config};this.targetType=kind==='fair'?'fair_application':'ad_marquee';this.forms=new PostgresServicePublicationStore(db);this.intents=new PostgresPaymentIntentStore(db);
 }
 private owner<T>(token:string,expectedOwner:string,work:(tx:PostgresQueries,owner:string)=>Promise<T>){
  const owner=parseListingDraftId(expectedOwner);return withAppSessionTransaction(this.db,token,(tx,user)=>{if(user.id!==owner)throw new AppSessionAccessError();return work(tx,user.id);});
 }
 private async inspected(tx:PostgresQueries,owner:string,id:string,revision:string):Promise<{tariff:Offer;fairEvent:Event|null}>{
  const {snapshot,issues}=await this.forms.inspectInTransaction(tx,owner,this.kind,id,revision);
  if(issues.length||snapshot.status!=='draft'||snapshot.paid||snapshot.publishedAt!==null||snapshot.expiresAt!==null)throw new ServiceCheckoutUnavailableError();
  const phone=(await tx.query<{ready:boolean}>('select app.phone_is_confirmed($1) ready',[owner])).rows[0];if(!phone?.ready)throw new ServiceCheckoutUnavailableError();
  if((await tx.query("select id from app.service_moderation where publication_id=$1 and revision=$2::bigint and state='approved' for share",[id,revision])).rowCount!==1)throw new ServiceCheckoutUnavailableError();
  const tariff=(await tx.query<Offer>(`select id,name,price::text amount,duration_days as "durationDays" from app.tariffs where id=$1 and action=$2 and active and price>0
   and ${this.kind==='fair'?'duration_days is null':'duration_days between 1 and 3650'}`,this.kind==='fair'?['fair-participation','fair_participation']:['ad-marquee','ad_marquee'])).rows[0];
  if(!tariff)throw new ServiceCheckoutUnavailableError();
  const fairEvent=this.kind==='fair'?(await tx.query<Event>(`select event_date::text date,to_char(ends_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "endsAt" from app.fair_event_at(clock_timestamp())`)).rows[0]:null;
  if(this.kind==='fair'&&!fairEvent)throw new ServiceCheckoutUnavailableError();return{tariff,fairEvent};
 }
 private async keyed(tx:PostgresQueries,owner:string,key:string){return(await tx.query<Row>(`select ${columns} ${source} where o.owner_id=$1 and o.creation_key=$2 and o.target_type=$3 and i.merchant_shop_id=$4 and i.is_test`,[owner,key,this.targetType,this.config.shopId])).rows[0];}
 async preview(token:string,owner:string,publicationId:unknown,expectedRevision:unknown){
  const id=parseListingDraftId(publicationId),revision=parseListingDraftRevision(expectedRevision);return this.owner(token,owner,async(tx,actor)=>{
   const offer=await this.inspected(tx,actor,id,revision),active=(await tx.query<Row>(`select ${columns} ${source} where o.owner_id=$1 and o.target_type=$2 and o.target_id=$3 and o.status in ('created','pending','succeeded') and i.merchant_shop_id=$4 and i.is_test`,[actor,this.targetType,id,this.config.shopId])).rows[0];
   return{publicationId:id,revision,...offer,activePayment:active?display(active):null};
  });
 }
 readIntent(token:string,owner:string,creationKey:unknown){const key=parseListingDraftId(creationKey);return this.owner(token,owner,async(tx,actor)=>{const row=await this.keyed(tx,actor,key);return row?display(row):null;});}
 readOrder(token:string,owner:string,paymentId:unknown):Promise<ServicePaymentSnapshot>{
  const id=parseListingDraftId(paymentId);return this.owner(token,owner,async(tx,actor)=>{
   const row=(await tx.query<Row&{publishedAt:string|null;expiresAt:string|null;eventEnded:boolean}>(`select ${columns},(i.target_type='fair_application' and terms.fair_ends_at<=clock_timestamp()) as "eventEnded",
    to_char(f.published_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "publishedAt",to_char(f.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expiresAt"
    ${source} left join app.payment_fulfillments f on f.intent_id=o.id where o.id=$1 and o.owner_id=$2 and o.target_type=$3 and i.merchant_shop_id=$4 and i.is_test`,[id,actor,this.targetType,this.config.shopId])).rows[0];
   if(!row)throw new ServicePublicationAccessError();const {publishedAt,expiresAt,eventEnded,...order}=row;
   return{order:display(order),eventEnded,fulfillment:publishedAt&&expiresAt?{publishedAt,expiresAt}:null};
  });
 }
 authorizeDispatch(token:string,owner:string,paymentId:unknown,requireCurrent=false):Promise<PaymentIntentBinding>{
  const id=parseListingDraftId(paymentId);return this.owner(token,owner,async(tx,actor)=>{
   const row=(await tx.query<PaymentIntent&{status:string;fairDate:string|null}>(`select i.id,i.owner_id as "ownerId",i.target_type as "targetType",i.target_id as "targetId",i.target_revision::text as "targetRevision",
    i.tariff_id as "tariffId",i.amount::text,i.duration_days as "durationDays",i.merchant_shop_id as "shopId",i.is_test as "isTest",i.request_body as "requestBody",o.status,terms.fair_date::text as "fairDate"
    ${source} where o.id=$1 and o.owner_id=$2 and o.target_type=$3 and i.merchant_shop_id=$4 and i.is_test`,[id,actor,this.targetType,this.config.shopId])).rows[0];
   if(!row)throw new ServicePublicationAccessError();const {status,fairDate,...value}=row,intent=parsePaymentIntent(value);
   if(requireCurrent&&(await tx.query('select intent_id from app.payment_provider_links where intent_id=$1',[id])).rowCount!==1){
    if(status!=='created'||!JSON.parse(intent.requestBody).receipt)throw new ServiceCheckoutUnavailableError();
    const offer=await this.inspected(tx,actor,intent.targetId,intent.targetRevision);
    if(offer.tariff.id!==intent.tariffId||offer.tariff.amount!==intent.amount||offer.tariff.durationDays!==intent.durationDays||(offer.fairEvent?.date??null)!==fairDate)throw new ServiceCheckoutConflictError();
   }
   const {requestBody,...binding}=intent;void requestBody;return binding;
  });
 }
 private async intent(tx:PostgresQueries,owner:string,id:string,input:ServiceCheckoutInput,offer:Offer):Promise<PaymentIntent>{
  const site=new URL(this.config.siteOrigin);
  if(site.protocol!=='https:'||site.username||site.password||site.port||site.pathname!=='/'||site.search||site.hash)throw new ServiceCheckoutUnavailableError();
  const amount={value:offer.amount,currency:'RUB'},description=this.kind==='fair'?'Участие в ярмарке мастеров':'Реклама в бегущей строке';let receipt:object|undefined;
  if(this.config.receiptVatCode!==null){
   const vat=this.config.receiptVatCode;if(!Number.isInteger(vat)||vat<1||vat>12)throw new ServiceCheckoutUnavailableError();
   const payer=(await tx.query<{email:string}>('select email from app.users where id=$1 and email_verified_at is not null and not is_blocked',[owner])).rows[0];if(!payer)throw new AppSessionAccessError();
   receipt={customer:{email:payer.email.trim().toLowerCase()},internet:true,items:[{amount,description,payment_mode:'full_payment',payment_subject:'service',quantity:1,vat_code:vat}]};
  }
  return parsePaymentIntent({id,ownerId:owner,targetType:this.targetType,targetId:input.publicationId,targetRevision:input.expectedRevision,tariffId:offer.id,amount:offer.amount,durationDays:offer.durationDays,shopId:this.config.shopId,isTest:true,
   requestBody:JSON.stringify({amount,capture:true,confirmation:{type:'redirect',return_url:`${site.origin}/oplata/uslugi/${id}?type=${this.kind}`},description,metadata:{localPaymentId:id,targetId:input.publicationId,targetType:this.targetType,tariffId:offer.id},...(receipt?{receipt}:{})})});
 }
 prepare(token:string,owner:string,value:unknown){
  const input=parseServiceCheckout(this.kind,value);return this.owner(token,owner,async(tx,actor)=>{
   const previous=await this.keyed(tx,actor,input.creationKey);if(previous){if(!matches(previous,input))throw new ServiceCheckoutConflictError();return display(previous);}
   const {tariff,fairEvent}=await this.inspected(tx,actor,input.publicationId,input.expectedRevision);
   if(tariff.id!==input.expectedTariffId||tariff.amount!==input.expectedAmount||tariff.durationDays!==input.expectedDurationDays||(fairEvent?.date??null)!==input.expectedFairDate)throw new ServiceCheckoutConflictError();
   if((await tx.query("select id from app.payment_orders where owner_id=$1 and target_type=$2 and target_id=$3 and status in ('created','pending','succeeded')",[actor,this.targetType,input.publicationId])).rowCount!==0)throw new ServiceCheckoutConflictError();
   const id=randomUUID();const inserted=await tx.query('insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,$4,$5,$6::bigint) on conflict do nothing returning id',[id,actor,input.creationKey,this.targetType,input.publicationId,input.expectedRevision]);
   if(inserted.rowCount!==1){const saved=await this.keyed(tx,actor,input.creationKey);if(!saved||!matches(saved,input))throw new ServiceCheckoutConflictError();return display(saved);}
   await this.intents.persistInTransaction(tx,await this.intent(tx,actor,id,input,tariff));
   await tx.query('insert into app.service_payment_terms(intent_id) values($1)',[id]);
   const saved=await this.keyed(tx,actor,input.creationKey);if(!saved||!matches(saved,input))throw new ServiceCheckoutConflictError();return display(saved);
  });
 }
}
