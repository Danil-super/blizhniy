import {withAppSessionTransaction} from './app-session-transaction';
import {hashSessionToken} from './identity';
import {parseListingDraftId} from './listing-draft-contract.ts';
import {PostgresPaymentIntentStore} from './postgres-payment-intents.ts';
import {describeFullPlacementRefund,parsePlacementRefundApproval,type PlacementRefundFiscalMode} from './placement-refund-approval.ts';
import {validateCaptureTime} from './yookassa-payment-contract.ts';
import type {PostgresDatabase,PostgresQueries} from './postgres.ts';
export class RefundApprovalAccessError extends Error{constructor(){super('Refund approval unavailable');this.name='RefundApprovalAccessError';}}
export class RefundApprovalConflictError extends Error{constructor(){super('Refund approval already exists');this.name='RefundApprovalConflictError';}}
export class RefundApprovalBusyError extends Error{constructor(){super('Refund approval participant busy');this.name='RefundApprovalBusyError';}}
export type PlacementRefundApproval={id:string;paymentIntentId:string;approvedBy:string;reason:string;policyVersion:'placement-full-admin-v1';fiscalMode:PlacementRefundFiscalMode;amount:string;approvedAt:string};
type Merchant={shopId:string;isTest:boolean};
const columns=`id,payment_intent_id as "paymentIntentId",approved_by as "approvedBy",reason,policy_version as "policyVersion",fiscal_mode as "fiscalMode",amount::text,
 to_char(approved_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "approvedAt"`;
const fail=():never=>{throw new RefundApprovalAccessError();};
/** Private operator/worker storage. No web grants, SQL retries, provider calls or service writes. */
export class PostgresRefundApprovalStore {
 private readonly merchant:Merchant;
 private readonly intents:PostgresPaymentIntentStore;
 constructor(private readonly db:Pick<PostgresDatabase,'transaction'>,merchant:Merchant){
  if(typeof window!=='undefined'||!merchant||merchant.isTest!==true||typeof merchant.shopId!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(merchant.shopId))fail();
  this.merchant={...merchant};this.intents=new PostgresPaymentIntentStore(db);
 }
 private async source(tx:PostgresQueries,paymentIntentId:string,history:boolean){
  if((await tx.query<{mode:string}>("select current_setting('transaction_isolation') as mode")).rows[0]?.mode!=='read committed')fail();
  try{if((await tx.query('select id from app.users where id=(select owner_id from app.payment_checkout_intents where id=$1) for update nowait',[paymentIntentId])).rowCount!==1)fail();}
  catch(error){if(error&&typeof error==='object'&&'code'in error&&error.code==='55P03')throw new RefundApprovalBusyError();throw error;}
  const purchase=await this.intents.lockKnownInTransaction(tx,paymentIntentId),{providerPaymentId,...intent}=purchase;
  const policy=describeFullPlacementRefund(intent,this.merchant);
  const order=(await tx.query<{status:string}>('select status from app.payment_orders where id=$1 for update',[paymentIntentId])).rows[0];
  const capture=(await tx.query<{id:string;status:string;capturedAt:string|null}>('select provider_payment_id as id,status,captured_at as "capturedAt" from app.payment_verifications where intent_id=$1',[paymentIntentId])).rows[0];
  if(!order||!['succeeded',...(history?['refunded']:[])].includes(order.status)||capture?.status!=='succeeded'||capture.id!==providerPaymentId||typeof capture.capturedAt!=='string')fail();
  validateCaptureTime(capture.capturedAt,'succeeded',Date.now());
  return{purchase,policy};
 }
 private async approval(tx:PostgresQueries,id:string){
  const saved=(await tx.query<PlacementRefundApproval>(`select ${columns} from app.payment_refund_approvals where id=$1`,[id])).rows[0];if(!saved)fail();
  const canonical=parsePlacementRefundApproval({id:saved.id,paymentIntentId:saved.paymentIntentId,reason:saved.reason});
  if(canonical.reason!==saved.reason)fail();parseListingDraftId(saved.approvedBy);
  const {purchase,policy}=await this.source(tx,saved.paymentIntentId,true);
  if(saved.policyVersion!==policy.policyVersion||saved.fiscalMode!==policy.fiscalMode||saved.amount!==policy.amount)fail();
  return{approval:saved,purchase};
 }
 approve(token:string,expectedAdmin:unknown,value:unknown){
  const owner=parseListingDraftId(expectedAdmin),input=parsePlacementRefundApproval(value);
  return withAppSessionTransaction(this.db,token,async(tx,user)=>{
   if(user.id!==owner)fail();
   // Existing approval comes before INSERT: its BEFORE guard correctly rejects
   // a new approval after refund, including INSERT ON CONFLICT DO NOTHING.
   const prior=(await tx.query<PlacementRefundApproval>(`select ${columns} from app.payment_refund_approvals where payment_intent_id=$1 or id=$2`,[input.paymentIntentId,input.id])).rows;
   if(prior.length){if(prior.length!==1)throw new RefundApprovalConflictError();const saved=prior[0];
    if(saved.id!==input.id||saved.paymentIntentId!==input.paymentIntentId||saved.approvedBy!==owner||saved.reason!==input.reason)throw new RefundApprovalConflictError();
    return(await this.approval(tx,saved.id)).approval;
   }
   await this.source(tx,input.paymentIntentId,false);
   await tx.query("select set_config('blizhniy.refund_approval_session',$1,true)",[hashSessionToken(token)]);
   try{await tx.query('insert into app.payment_refund_approvals(id,payment_intent_id,reason) values($1,$2,$3)',[input.id,input.paymentIntentId,input.reason]);}
   catch(error){if(error&&typeof error==='object'&&'code'in error&&error.code==='23505')throw new RefundApprovalConflictError();throw error;}
   return(await this.approval(tx,input.id)).approval;
  },{requireAdmin:true,denied:()=>new RefundApprovalAccessError()});
 }
 readForAdmin(token:string,expectedAdmin:unknown,value:unknown){
  const owner=parseListingDraftId(expectedAdmin),id=parseListingDraftId(value);
  return withAppSessionTransaction(this.db,token,async(tx,user)=>{if(user.id!==owner)fail();return(await this.approval(tx,id)).approval;},{requireAdmin:true,denied:()=>new RefundApprovalAccessError()});
 }
 /** Trusted worker only. Durable approval survives the approving browser session. */
 read(value:unknown){const id=parseListingDraftId(value);return this.db.transaction(tx=>this.approval(tx,id));}
 async assertDispatch(value:unknown){const id=parseListingDraftId(value);return this.db.transaction(async tx=>{
  const saved=await this.approval(tx,id);await this.source(tx,saved.approval.paymentIntentId,false);
  const reservation=(await tx.query<{id:string}>('select id from app.payment_refund_reservations where payment_intent_id=$1',[saved.approval.paymentIntentId])).rows[0];
  if(reservation?.id!==saved.approval.id)fail();
 });}
}
