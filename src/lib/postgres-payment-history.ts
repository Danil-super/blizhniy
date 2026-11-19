import {withAppSessionTransaction,AppSessionAccessError} from './app-session-transaction';
import {parseListingDraftId} from './listing-draft-contract.ts';
import {parseWorkPaymentReceipt,type WorkPaymentReceipt,parsePaymentHistoryCursor,parsePaymentHistoryPage,paymentHistoryPageSize,type PaymentHistoryItem,type PaymentHistoryCursor} from './payment-history-contract.ts';
import type {PostgresDatabase} from './postgres';

/** History reads never dispatch, verify or refund a payment. */
export class PostgresPaymentHistoryStore{
 constructor(private readonly db:Pick<PostgresDatabase,'transaction'>){}
 async readSpecialistOrder(token:string,expectedOwnerId:string,paymentId:string){
  const owner=parseListingDraftId(expectedOwnerId),id=parseListingDraftId(paymentId);
  return withAppSessionTransaction(this.db,token,async(tx,user)=>{
   if(user.id!==owner)throw new AppSessionAccessError();
   const {readPlacementOrder}=await import('./postgres-listing-checkout');
   return readPlacementOrder(tx,user.id,id,'specialist',{includeTestFlag:true});
  });
 }
 async list(token:string,expectedOwnerId:string,selection:PaymentHistoryCursor|WorkPaymentReceipt|null){
  const owner=parseListingDraftId(expectedOwnerId);
  const receipt=selection&&'targetType' in selection?parseWorkPaymentReceipt(selection):null;
  const before=receipt?null:parsePaymentHistoryCursor(selection);
  return withAppSessionTransaction(this.db,token,async(tx,user)=>{
   if(user.id!==owner)throw new AppSessionAccessError();
   const filter=receipt?'and o.id=$2 and o.target_type=$3':before?'and (o.created_at,o.id)<($2::timestamptz,$3::uuid)':'';
   const args=receipt?[user.id,receipt.id,receipt.targetType]:before?[user.id,before.createdAt,before.id]:[user.id];
   const rows=(await tx.query<PaymentHistoryItem>(`select o.id,o.target_type as "targetType",i.amount::text,o.status,i.is_test as "isTest",
    to_char(o.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt"
    from app.payment_orders o join app.payment_checkout_intents i on i.id=o.id and i.owner_id=o.owner_id
     and i.target_type=o.target_type and i.target_id=o.target_id and i.target_revision=o.target_revision
    where o.owner_id=$1 ${filter}
    order by o.created_at desc,o.id desc limit 51`,args)).rows;
   const items=rows.slice(0,paymentHistoryPageSize),last=items.at(-1);
   return parsePaymentHistoryPage({items,nextCursor:rows.length>paymentHistoryPageSize&&last?{id:last.id,createdAt:last.createdAt}:null},before);
  });
 }
}
