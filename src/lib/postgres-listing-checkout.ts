import {randomUUID} from 'node:crypto';
import {withAppSessionTransaction,AppSessionAccessError} from './app-session-transaction';
import {PostgresListingFormStore} from './postgres-listing-form';
import {PostgresPaymentIntentStore,parsePaymentIntent,type PaymentIntent} from './postgres-payment-intents';
import {parseListingDraftId,parseListingDraftRevision} from './listing-draft-contract.ts';
import {parseListingCheckout,ListingCheckoutConflictError,ListingCheckoutUnavailableError,type ListingCheckoutInput} from './listing-checkout-contract.ts';
import type {PostgresDatabase,PostgresQueries} from './postgres';

export type ListingCheckoutConfig={shopId:string;isTest:boolean;siteOrigin:string;receiptVatCode:number|null};
export type ListingPaymentOrder={id:string;creationKey:string;targetId:string;targetRevision:string;tariffId:string;amount:string;durationDays:number;status:'created'|'pending'|'succeeded'|'failed'|'refunded';createdAt:string};
type OrderRow=ListingPaymentOrder&{targetType:string};
type Offer={id:string;name:string;amount:string;currency:'RUB';durationDays:number};
const columns=`o.id,o.creation_key as "creationKey",o.target_type as "targetType",o.target_id as "targetId",o.target_revision::text as "targetRevision",o.status,
 i.tariff_id as "tariffId",i.amount::text,i.duration_days as "durationDays",to_char(o.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt"`;
const source='from app.payment_orders o join app.payment_checkout_intents i on i.id=o.id';
function display(row:OrderRow):ListingPaymentOrder{
 if(row.targetType!=='listing'||row.durationDays===null)throw new ListingCheckoutUnavailableError();
 return{id:row.id,creationKey:row.creationKey,targetId:row.targetId,targetRevision:row.targetRevision,tariffId:row.tariffId,amount:row.amount,durationDays:row.durationDays,status:row.status,createdAt:row.createdAt};
}
function matches(row:OrderRow,input:ListingCheckoutInput){
 return row.targetType==='listing'&&row.targetId===input.listingId&&row.targetRevision===input.expectedRevision&&row.creationKey===input.creationKey&&
  row.tariffId===input.expectedTariffId&&row.amount===input.expectedAmount&&row.durationDays===input.expectedDurationDays;
}
/** Local-only session/target/offer authorization. No provider fetch, settlement or publication. */
export class PostgresListingCheckoutStore{
 private readonly forms:PostgresListingFormStore;
 private readonly intents:PostgresPaymentIntentStore;
 private readonly config:ListingCheckoutConfig;
 constructor(private readonly db:Pick<PostgresDatabase,'transaction'>,config:ListingCheckoutConfig){
  if(typeof window!=='undefined')throw new ListingCheckoutUnavailableError();
  this.forms=new PostgresListingFormStore(db);this.intents=new PostgresPaymentIntentStore(db);this.config={...config};
 }
 private owner<T>(token:string,expectedOwner:string,work:(tx:PostgresQueries,owner:string)=>Promise<T>){
  const owner=parseListingDraftId(expectedOwner);return withAppSessionTransaction(this.db,token,(tx,user)=>{
   if(user.id!==owner)throw new AppSessionAccessError();return work(tx,user.id);
  });
 }
 private async inspected(tx:PostgresQueries,owner:string,id:string,revision:string):Promise<Offer>{
  const {check}=await this.forms.inspectInTransaction(tx,owner,id,revision);
  if(!check.checksPassed||!check.tariff||check.tariff.amount==='0.00')throw new ListingCheckoutUnavailableError();
  const approval=await tx.query(`select id from app.listing_moderation where listing_id=$1 and revision=$2::bigint and state='approved' for share`,[id,revision]);
  if(approval.rowCount!==1)throw new ListingCheckoutUnavailableError();
  return check.tariff;
 }
 private async keyed(tx:PostgresQueries,owner:string,key:string){
  return(await tx.query<OrderRow>(`select ${columns} ${source} where o.owner_id=$1 and o.creation_key=$2`,[owner,key])).rows[0];
 }
 private async active(tx:PostgresQueries,owner:string,id:string){
  return(await tx.query<OrderRow>(`select ${columns} ${source} where o.owner_id=$1 and o.target_type='listing' and o.target_id=$2 and o.status in ('created','pending','succeeded')`,[owner,id])).rows[0];
 }
 async preview(token:string,owner:string,listingId:unknown,expectedRevision:unknown){
  const id=parseListingDraftId(listingId),revision=parseListingDraftRevision(expectedRevision);
  return this.owner(token,owner,async(tx,actor)=>{
   const tariff=await this.inspected(tx,actor,id,revision),active=await this.active(tx,actor,id);
   return{listingId:id,revision,tariff,activePayment:active?display(active):null};
  });
 }
 async readIntent(token:string,owner:string,creationKey:unknown){
  const key=parseListingDraftId(creationKey);return this.owner(token,owner,async(tx,actor)=>{
   const row=await this.keyed(tx,actor,key);return row?display(row):null;
  });
 }
 private async intent(tx:PostgresQueries,owner:string,id:string,input:ListingCheckoutInput,offer:Offer):Promise<PaymentIntent>{
  let origin:string;try{
   const site=new URL(this.config.siteOrigin);
   if(site.protocol!=='https:'||site.username||site.password||site.port||site.pathname!=='/'||site.search||site.hash||/[\s\\\u0000-\u001f\u007f]/.test(this.config.siteOrigin))throw new Error('Invalid checkout origin');
   origin=site.origin;
  }catch{throw new ListingCheckoutUnavailableError();}
  const amount={value:offer.amount,currency:'RUB'},description='Размещение объявления';
  let receipt:object|undefined;
  if(this.config.receiptVatCode!==null){
   const vat=this.config.receiptVatCode;
   if(!Number.isInteger(vat)||vat<1||vat>12)throw new ListingCheckoutUnavailableError();
   const payer=(await tx.query<{email:string}>('select email from app.users where id=$1 and email_verified_at is not null and not is_blocked',[owner])).rows[0];
   if(!payer)throw new AppSessionAccessError();
   receipt={customer:{email:payer.email.trim().toLowerCase()},internet:true,items:[{amount,description,payment_mode:'full_payment',payment_subject:'service',quantity:1,vat_code:vat}]};
  }
  return parsePaymentIntent({id,ownerId:owner,targetType:'listing',targetId:input.listingId,targetRevision:input.expectedRevision,
   tariffId:offer.id,amount:offer.amount,durationDays:offer.durationDays,shopId:this.config.shopId,isTest:this.config.isTest,
   requestBody:JSON.stringify({amount,capture:true,confirmation:{type:'redirect',return_url:`${origin}/oplata/${id}`},description,
    metadata:{localPaymentId:id,targetId:input.listingId,targetType:'listing',tariffId:offer.id},...(receipt?{receipt}:{})})});
 }
 async prepare(token:string,owner:string,value:unknown){
  const input=parseListingCheckout(value);return this.owner(token,owner,async(tx,actor)=>{
   // A readback never rebuilds old receipts or silently swaps the original expected offer.
   const prior=await this.keyed(tx,actor,input.creationKey);
   if(prior){if(!matches(prior,input))throw new ListingCheckoutConflictError();return display(prior);}
   const offer=await this.inspected(tx,actor,input.listingId,input.expectedRevision);
   if(offer.id!==input.expectedTariffId||offer.amount!==input.expectedAmount||offer.durationDays!==input.expectedDurationDays)throw new ListingCheckoutConflictError();
   if(await this.active(tx,actor,input.listingId))throw new ListingCheckoutConflictError();
   const id=randomUUID();
   const inserted=await tx.query(`insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision)
    values($1,$2,$3,'listing',$4,$5::bigint) on conflict do nothing returning id`,[id,actor,input.creationKey,input.listingId,input.expectedRevision]);
   if(inserted.rowCount!==1){
    const winner=await this.keyed(tx,actor,input.creationKey);if(!winner||!matches(winner,input))throw new ListingCheckoutConflictError();return display(winner);
   }
   const intent=await this.intent(tx,actor,id,input,offer);
   await this.intents.persistInTransaction(tx,intent);
   const saved=await this.keyed(tx,actor,input.creationKey);if(!saved)throw new ListingCheckoutUnavailableError();return display(saved);
  });
 }
}
