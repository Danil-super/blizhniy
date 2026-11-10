import {PostgresPaymentIntentStore} from './postgres-payment-intents.ts';
import {PostgresRefundRequestStore,applicationRefundAdmitted} from './postgres-refund-requests.ts';
import {parseListingDraftId} from './listing-draft-contract.ts';
import {validateCaptureTime} from './yookassa-payment-contract.ts';
import type {PostgresDatabase,PostgresQueries} from './postgres.ts';

export class ApplicationCompensationRefundError extends Error {
 constructor(){super('Application compensation refund requires reconciliation');this.name='ApplicationCompensationRefundError';}
}
export type ApplicationCompensationRefundEffect={paymentIntentId:string;applicationId:string;providerRefundId:string;amount:string;appliedAt:string};
const columns=`payment_intent_id as "paymentIntentId",application_id as "applicationId",provider_refund_id as "providerRefundId",amount::text,
 to_char(applied_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "appliedAt"`;
/** Dormant TEST capability. Original case owns the key; delivery/contact history stays intact. */
export class PostgresApplicationCompensationRefundStore {
 private readonly db:Pick<PostgresDatabase,'transaction'>;
 private readonly merchant:{shopId:string;isTest:boolean};
 private readonly intents:PostgresPaymentIntentStore;
 constructor(db:Pick<PostgresDatabase,'transaction'>,merchant:{shopId:string;isTest:boolean}){
  new PostgresRefundRequestStore(db,merchant);
  this.db=db;
  this.merchant={...merchant};this.intents=new PostgresPaymentIntentStore(db);
 }
 private async source(tx:PostgresQueries,id:string,history:boolean){
  if((await tx.query<{mode:string}>("select current_setting('transaction_isolation') as mode")).rows[0]?.mode!=='read committed')throw new ApplicationCompensationRefundError();
  await tx.query('select id from app.users where id=(select owner_id from app.payment_checkout_intents where id=$1) for update',[id]);
  const purchase=await this.intents.lockKnownInTransaction(tx,id);
  const order=(await tx.query<{status:string}>('select status from app.payment_orders where id=$1 for update',[id])).rows[0];
  if(!order||!['succeeded',...(history?['refunded']:[])].includes(order.status)||purchase.targetType!=='application'||purchase.durationDays!==null||
   !purchase.isTest||purchase.shopId!==this.merchant.shopId||!await applicationRefundAdmitted(tx,id,id))throw new ApplicationCompensationRefundError();
  const capture=(await tx.query<{status:string;id:string;capturedAt:string|null}>('select status,provider_payment_id as id,captured_at as "capturedAt" from app.payment_verifications where intent_id=$1',[id])).rows[0];
  if(capture?.status!=='succeeded'||capture.id!==purchase.providerPaymentId||typeof capture.capturedAt!=='string')throw new ApplicationCompensationRefundError();
  validateCaptureTime(capture.capturedAt,'succeeded',Date.now());
  return{purchase,status:order.status};
 }
 async reserve(value:unknown){
  const id=parseListingDraftId(value);
  return this.db.transaction(async tx=>{
   const {purchase,status}=await this.source(tx,id,true);
   const saved=async()=>{
    const row=(await tx.query<{id:string;providerPaymentId:string;amount:string;shopId:string;isTest:boolean}>(`select id,provider_payment_id as "providerPaymentId",amount::text,
     merchant_shop_id as "shopId",is_test as "isTest" from app.payment_refund_reservations where payment_intent_id=$1`,[id])).rows[0];
    if(row&&(row.id!==id||row.providerPaymentId!==purchase.providerPaymentId||row.amount!==purchase.amount||row.shopId!==purchase.shopId||row.isTest!==true))throw new ApplicationCompensationRefundError();
    return row;
   };
   if(await saved())return id;
   if(status!=='succeeded')throw new ApplicationCompensationRefundError();
   await tx.query(`insert into app.payment_refund_reservations(id,payment_intent_id,provider_payment_id,merchant_shop_id,is_test,amount)
    values($1,$1,$2,$3,true,$4)`,[id,purchase.providerPaymentId,purchase.shopId,purchase.amount]);
   if(!await saved())throw new ApplicationCompensationRefundError();
   return id;
  });
 }
 async assertDispatch(value:unknown){
  const id=parseListingDraftId(value);
  await this.db.transaction(async tx=>{
   await this.source(tx,id,false);
   if((await tx.query('select id from app.payment_refund_reservations where id=$1 and payment_intent_id=$1 and merchant_shop_id=$2',[id,this.merchant.shopId])).rowCount!==1)throw new ApplicationCompensationRefundError();
  });
 }
 async apply(value:unknown):Promise<ApplicationCompensationRefundEffect>{
  const id=parseListingDraftId(value);
  return this.db.transaction(async tx=>{
   await tx.query('insert into app.application_compensation_refunds(payment_intent_id,merchant_shop_id) values($1,$2) on conflict do nothing',[id,this.merchant.shopId]);
   const row=(await tx.query<ApplicationCompensationRefundEffect>(`select ${columns} from app.application_compensation_refunds where payment_intent_id=$1 and merchant_shop_id=$2`,[id,this.merchant.shopId])).rows[0];
   if(!row)throw new ApplicationCompensationRefundError();return row;
  });
 }
}
