import {PostgresPaymentIntentStore} from './postgres-payment-intents.ts';
import {PostgresServicePublicationStore,ServicePublicationAccessError,ServicePublicationConflictError} from './postgres-service-publications';
import {ServicePublicationInputError} from './service-publication-contract.ts';
import {parseListingDraftId} from './listing-draft-contract.ts';
import {PaymentPublicationError,type PaymentPublicationPeriod} from './payment-publication-period.ts';
import type {PostgresDatabase} from './postgres';
type Result={state:'fulfilled';period:PaymentPublicationPeriod}|{state:'queued'|'not_ready'|'blocked';reason:string};
const columns=`to_char(published_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "publishedAt",to_char(expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expiresAt"`;
/** Trusted local TEST worker. SQL owns exact event dates, advertising capacity and once-only publication. */
export class PostgresServicePaymentFulfillmentStore{
 private readonly intents:PostgresPaymentIntentStore;
 private readonly forms:PostgresServicePublicationStore;
 private readonly merchant:{shopId:string;isTest:boolean};
 constructor(private readonly db:Pick<PostgresDatabase,'transaction'>,merchant:{shopId:string;isTest:boolean}){
  if(typeof window!=='undefined'||!merchant||merchant.isTest!==true||!/^[a-zA-Z0-9_-]{1,64}$/.test(merchant.shopId))throw new PaymentPublicationError();
  this.merchant={...merchant};this.intents=new PostgresPaymentIntentStore(db);this.forms=new PostgresServicePublicationStore(db);
 }
 async fulfill(value:unknown):Promise<Result>{
  const id=parseListingDraftId(value);
  try{return await this.db.transaction(async tx=>{
   await tx.query('select id from app.users where id=(select owner_id from app.payment_checkout_intents where id=$1) for update',[id]);
   const purchase=await this.intents.lockKnownInTransaction(tx,id);
   if(!['fair_application','ad_marquee'].includes(purchase.targetType)||!purchase.isTest||purchase.shopId!==this.merchant.shopId)throw new PaymentPublicationError();
   const order=(await tx.query<{status:string}>('select status from app.payment_orders where id=$1 for update',[id])).rows[0];if(!order)throw new PaymentPublicationError();
   const previous=(await tx.query<PaymentPublicationPeriod>(`select ${columns} from app.payment_fulfillments where intent_id=$1`,[id])).rows[0];if(previous)return{state:'fulfilled',period:previous};
   if(order.status!=='succeeded')return{state:'not_ready',reason:'capture_required'};
   try{
    const inspected=await this.forms.inspectInTransaction(tx,purchase.ownerId,purchase.targetType==='fair_application'?'fair':'marquee',purchase.targetId,purchase.targetRevision);
    if(inspected.issues.length)return{state:'blocked',reason:'content_unavailable'};
   }catch(error){
    if(error instanceof ServicePublicationAccessError||error instanceof ServicePublicationConflictError)return{state:'blocked',reason:'target_changed'};
    if(error instanceof ServicePublicationInputError)return{state:'blocked',reason:'content_unavailable'};throw error;
   }
   const period=(await tx.query<PaymentPublicationPeriod>(`insert into app.payment_fulfillments(intent_id) values($1) returning ${columns}`,[id])).rows[0];
   if(!period)throw new PaymentPublicationError();return{state:'fulfilled',period};
  });}catch(error){
   if(error&&typeof error==='object'&&'code'in error){if(error.code==='PSQ01')return{state:'queued',reason:'advertising_slot_required'};if(error.code==='PSV01')return{state:'blocked',reason:'service_unavailable'};}
   throw error;
  }
 }
 async discover(limit=50):Promise<string[]>{
  if(!Number.isInteger(limit)||limit<1||limit>100)throw new PaymentPublicationError();
  return this.db.transaction(async tx=>(await tx.query<{id:string}>(`select i.id from app.payment_checkout_intents i join app.payment_verifications v on v.intent_id=i.id
   where i.merchant_shop_id=$1 and i.is_test and i.target_type in ('fair_application','ad_marquee') and app.service_payment_eligible(i.id)
   order by (left(v.captured_at,19)||'.'||rpad(coalesce(substring(v.captured_at from '[.]([0-9]+)Z$'),''),9,'0')||'Z') collate "C",i.id limit $2`,[this.merchant.shopId,limit])).rows.map(row=>row.id));
 }
}
