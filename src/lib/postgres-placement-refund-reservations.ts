import {servicePlacementRefundTarget,type ServiceRefundScope} from './service-checkout-config.ts';
import {PostgresPaymentIntentStore,PaymentIntentError} from './postgres-payment-intents.ts';
import type {PostgresDatabase} from './postgres.ts';

export class PlacementRefundReservationError extends Error{
 constructor(){super('Placement refund reservation requires verification');this.name='PlacementRefundReservationError';}
}
export type PlacementRefundReservation={id:string;paymentIntentId:string;providerPaymentId:string;amount:string;shopId:string;isTest:boolean;createdAt:string};
type Merchant={shopId:string;isTest:boolean}&ServiceRefundScope;
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
function fail():never{throw new PlacementRefundReservationError();}
const columns=`id,payment_intent_id as "paymentIntentId",provider_payment_id as "providerPaymentId",amount::text,
 merchant_shop_id as "shopId",is_test as "isTest",to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt"`;

/** Trusted operator preparation only. No HTTP authority, eligibility decision, POST or service effects.
 * Schema36 is opt-in and grants no runtime access. One full TEST reservation per original purchase.
 */
export class PostgresPlacementRefundReservationStore{
 private readonly db:Pick<PostgresDatabase,'transaction'>;
 private readonly merchant:Merchant;
 private readonly intents:PostgresPaymentIntentStore;
 constructor(db:Pick<PostgresDatabase,'transaction'>,merchant:Merchant){
  if(typeof window!=='undefined'||!merchant||typeof merchant.shopId!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(merchant.shopId)||merchant.isTest!==true)fail();
  this.db=db;this.merchant={...merchant};this.intents=new PostgresPaymentIntentStore(db);
 }
 async reserve(paymentIntentId:unknown,proposedOperationId:unknown):Promise<PlacementRefundReservation>{
  if(!uuid(paymentIntentId)||!uuid(proposedOperationId))fail();
  return this.db.transaction(async tx=>{
   if((await tx.query<{mode:string}>("select current_setting('transaction_isolation') as mode")).rows[0]?.mode!=='read committed')fail();
   // Same order as fulfillment/session writers; immutable owner is not a request parameter.
   if((await tx.query('select id from app.users where id=(select owner_id from app.payment_checkout_intents where id=$1) for update',[paymentIntentId])).rowCount!==1)fail();
   const purchase=await this.intents.lockKnownInTransaction(tx,paymentIntentId).catch(error=>{if(error instanceof PaymentIntentError)fail();throw error;});
   if(!(['listing','vacancy','workRequest'].includes(purchase.targetType)&&purchase.durationDays!==null||servicePlacementRefundTarget(purchase,this.merchant))||!purchase.isTest||purchase.shopId!==this.merchant.shopId)fail();
   const order=(await tx.query<{status:string}>('select status from app.payment_orders where id=$1 for update',[paymentIntentId])).rows[0];
   if(!order)fail();
   // A caller cannot reuse another purchase's key, even on an otherwise idempotent replay.
   const key=(await tx.query<{paymentIntentId:string}>('select payment_intent_id as "paymentIntentId" from app.payment_refund_reservations where id=$1',[proposedOperationId])).rows[0];
   if(key&&key.paymentIntentId!==paymentIntentId)fail();
   const read=async()=>{
    const row=(await tx.query<PlacementRefundReservation>(`select ${columns} from app.payment_refund_reservations where payment_intent_id=$1`,[paymentIntentId])).rows[0];
    if(row&&(row.paymentIntentId!==purchase.id||row.providerPaymentId!==purchase.providerPaymentId||row.amount!==purchase.amount||row.shopId!==purchase.shopId||row.isTest!==purchase.isTest||!uuid(row.id)))fail();
    return row;
   };
   const existing=await read();
   // A durable reservation survives later order/service changes. Never generate a replacement key.
   if(existing)return existing;
   const verified=(await tx.query<{status:string;id:string;capturedAt:string|null}>('select status,provider_payment_id as id,captured_at as "capturedAt" from app.payment_verifications where intent_id=$1',[paymentIntentId])).rows[0];
   if(order.status!=='succeeded'||verified?.status!=='succeeded'||verified.id!==purchase.providerPaymentId||typeof verified.capturedAt!=='string')fail();
   await tx.query(`insert into app.payment_refund_reservations(id,payment_intent_id,provider_payment_id,merchant_shop_id,is_test,amount)
    values($1,$2,$3,$4,$5,$6) on conflict(payment_intent_id) do nothing`,[proposedOperationId,purchase.id,purchase.providerPaymentId,purchase.shopId,purchase.isTest,purchase.amount]);
   const saved=await read();if(!saved)fail();return saved;
  });
 }
}
