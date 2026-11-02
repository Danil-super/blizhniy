import {createHash} from 'node:crypto';
import {PostgresPaymentIntentStore,PaymentIntentError} from './postgres-payment-intents.ts';
import {buildPlacementRefundRequest,RefundRequestError} from './refund-request-contract.ts';
import type {PostgresDatabase,PostgresQueries} from './postgres.ts';
import type {PlacementRefundReservation} from './postgres-placement-refund-reservations.ts';
export {RefundRequestError} from './refund-request-contract.ts';

export type PreparedRefundRequest=Omit<PlacementRefundReservation,'id'>&{operationId:string;requestBody:string;idempotenceKey:string};
type RequestRow={requestBody:string;idempotenceKey:string;createdAt:string;sha256:string};
type Merchant={shopId:string;isTest:boolean};
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
function fail():never{throw new RefundRequestError();}
const requestColumns=`request_body as "requestBody",idempotence_key as "idempotenceKey",request_sha256 as sha256,
 to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt"`;

/** Private TEST preparation/window storage. A window is NOT admission to make a refund.
 * No network I/O, provider state, fiscal-policy decision, service writes or SQL retries.
 */
export class PostgresRefundRequestStore{
 private readonly db:Pick<PostgresDatabase,'transaction'>;
 private readonly merchant:Merchant;
 private readonly intents:PostgresPaymentIntentStore;
 constructor(db:Pick<PostgresDatabase,'transaction'>,merchant:Merchant){
  if(typeof window!=='undefined'||!merchant||typeof merchant.shopId!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(merchant.shopId)||merchant.isTest!==true)fail();
  this.db=db;this.merchant={...merchant};this.intents=new PostgresPaymentIntentStore(db);
 }
 private async locked(tx:PostgresQueries,operationId:string){
  if((await tx.query<{mode:string}>("select current_setting('transaction_isolation') as mode")).rows[0]?.mode!=='read committed')fail();
  const reservation=(await tx.query<PlacementRefundReservation>(`select id,payment_intent_id as "paymentIntentId",provider_payment_id as "providerPaymentId",
   merchant_shop_id as "shopId",is_test as "isTest",amount::text,created_at::text as "createdAt" from app.payment_refund_reservations where id=$1`,[operationId])).rows[0];
  if(!reservation)fail();
  if((await tx.query('select id from app.users where id=(select owner_id from app.payment_checkout_intents where id=$1) for update',[reservation.paymentIntentId])).rowCount!==1)fail();
  const purchase=await this.intents.lockKnownInTransaction(tx,reservation.paymentIntentId).catch(error=>{if(error instanceof PaymentIntentError)fail();throw error;});
  const order=(await tx.query<{status:string}>('select status from app.payment_orders where id=$1 for update',[reservation.paymentIntentId])).rows[0];
  if(!order||!['listing','vacancy','workRequest'].includes(purchase.targetType)||purchase.durationDays===null||!purchase.isTest||purchase.shopId!==this.merchant.shopId||
   reservation.id!==operationId||reservation.paymentIntentId!==purchase.id||reservation.providerPaymentId!==purchase.providerPaymentId||reservation.amount!==purchase.amount||
   reservation.shopId!==purchase.shopId||reservation.isTest!==purchase.isTest)fail();
  const expected=buildPlacementRefundRequest({operationId,paymentIntentId:purchase.id,providerPaymentId:purchase.providerPaymentId,amount:purchase.amount});
  const saved=(await tx.query<RequestRow>(`select ${requestColumns} from app.payment_refund_requests where operation_id=$1`,[operationId])).rows[0];
  if(saved&&(saved.requestBody!==expected.requestBody||saved.idempotenceKey!==expected.idempotenceKey||
   saved.sha256!==createHash('sha256').update(saved.requestBody,'utf8').digest('hex')))fail();
  const request=(row:RequestRow):PreparedRefundRequest=>({operationId,paymentIntentId:purchase.id,providerPaymentId:purchase.providerPaymentId,
   amount:purchase.amount,shopId:purchase.shopId,isTest:purchase.isTest,requestBody:row.requestBody,idempotenceKey:row.idempotenceKey,createdAt:row.createdAt});
  return {reservation,purchase,order,expected,saved,request};
 }
 private async captured(tx:PostgresQueries,paymentIntentId:string,providerPaymentId:string,status:string,history=false){
  const verified=(await tx.query<{status:string;id:string;capturedAt:string|null}>('select status,provider_payment_id as id,captured_at as "capturedAt" from app.payment_verifications where intent_id=$1',[paymentIntentId])).rows[0];
  if((status!=='succeeded'&&!(history&&status==='refunded'))||verified?.status!=='succeeded'||verified.id!==providerPaymentId||typeof verified.capturedAt!=='string')fail();
 }
 async prepare(value:unknown):Promise<PreparedRefundRequest>{
  if(!uuid(value))fail();
  return this.db.transaction(async tx=>{
   const state=await this.locked(tx,value);
   if(state.saved){await this.captured(tx,state.purchase.id,state.purchase.providerPaymentId,state.order.status,true);return state.request(state.saved);}
   await this.captured(tx,state.purchase.id,state.purchase.providerPaymentId,state.order.status);
   await tx.query(`insert into app.payment_refund_requests(operation_id,idempotence_key,request_body) values($1,$2,$3)
    on conflict(operation_id) do nothing`,[value,state.expected.idempotenceKey,state.expected.requestBody]);
   const saved=(await this.locked(tx,value));if(!saved.saved)fail();return saved.request(saved.saved);
  });
 }
 async openWindow(value:unknown):Promise<{request:PreparedRefundRequest;remainingMs:number}>{
  if(!uuid(value))fail();const started=performance.now();
  const result=await this.db.transaction(async tx=>{
   const state=await this.locked(tx,value);if(!state.saved)fail();
   await this.captured(tx,state.purchase.id,state.purchase.providerPaymentId,state.order.status);
   await tx.query('insert into app.payment_refund_dispatch_anchors(operation_id) values($1) on conflict(operation_id) do nothing',[value]);
   const clock=(await tx.query<{remaining:string}>(`select floor(extract(epoch from (authorized_at+interval '23 hours 55 minutes'-clock_timestamp()))*1000)::text as remaining
    from app.payment_refund_dispatch_anchors where operation_id=$1`,[value])).rows[0];
   if(!clock||!/^\d+$/.test(clock.remaining)||Number(clock.remaining)<=0||!Number.isSafeInteger(Number(clock.remaining)))fail();
   return {request:state.request(state.saved),remainingMs:Number(clock.remaining)};
  });
  const remainingMs=result.remainingMs-Math.max(0,performance.now()-started);
  if(!Number.isFinite(remainingMs)||remainingMs<=0)fail();return {...result,remainingMs};
 }
}
