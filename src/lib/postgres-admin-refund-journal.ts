import {withAppSessionTransaction} from './app-session-transaction';
import {parseListingDraftId} from './listing-draft-contract.ts';
import type {PostgresDatabase} from './postgres';
export type AdminRefundPayment={id:string;targetType:string;targetId:string;amount:string;createdAt:string;status:string;capturedAt:string|null;
 operationId:string|null;attempted:boolean;approvalId:string|null;reason:string|null;approvedAt:string|null;providerRefundId:string|null;refundStatus:string|null;appliedAt:string|null;canRefund?:boolean};
export type AdminRefundPage={items:AdminRefundPayment[];nextAfter:string|null};
/** Local operator read model. Receipt sources, session hashes and payer contacts never leave the process. */
export class PostgresAdminRefundJournal {
 private readonly shopId:string;
 constructor(private readonly db:Pick<PostgresDatabase,'transaction'>,merchant:{shopId:string;isTest:boolean}){
  if(typeof window!=='undefined'||merchant?.isTest!==true||!/^[a-zA-Z0-9_-]{1,64}$/.test(merchant.shopId))throw Error('Refund journal unavailable');
  this.shopId=merchant.shopId;
 }
 list(token:string,expectedAdmin:unknown,after:unknown):Promise<AdminRefundPage>{
  const actor=parseListingDraftId(expectedAdmin),cursor=after===null?null:parseListingDraftId(after);
  return withAppSessionTransaction(this.db,token,async(tx,user)=>{
   if(user.id!==actor)throw Error('Refund journal unavailable');
   const previous=cursor?(await tx.query<{createdAt:string}>(`select to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt" from app.payment_checkout_intents
    where id=$1 and merchant_shop_id=$2 and is_test`,[cursor,this.shopId])).rows[0]:null;
   if(cursor&&!previous)throw Error('Refund journal unavailable');
   const rows=(await tx.query<AdminRefundPayment>(`select i.id,i.target_type as "targetType",i.target_id as "targetId",i.amount::text,
    to_char(i.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",p.status,v.captured_at as "capturedAt",
    b.id as "operationId",exists(select 1 from app.payment_refund_send_attempts where operation_id=b.id) as attempted,
    app.refund_target_admitted(i.id,coalesce(b.id,i.id)) as "canRefund",
    a.id as "approvalId",a.reason,to_char(a.approved_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "approvedAt",
    coalesce(l.provider_refund_id,c.provider_refund_id) as "providerRefundId",o.status as "refundStatus",
    coalesce(to_char(e.applied_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),to_char(r.applied_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) as "appliedAt"
    from app.payment_checkout_intents i join app.payment_orders p on p.id=i.id
    left join app.payment_verifications v on v.intent_id=i.id
    left join app.payment_refund_approvals a on a.payment_intent_id=i.id
    left join app.payment_refund_reservations b on b.payment_intent_id=i.id and b.merchant_shop_id=i.merchant_shop_id and b.is_test
     and b.id=case when i.target_type='application' then i.id else a.id end
    left join app.payment_refund_candidates c on c.operation_id=b.id
    left join app.payment_refund_provider_links l on l.operation_id=b.id
    left join lateral (select status from app.payment_refund_observations where operation_id=b.id order by (status in ('succeeded','canceled')) desc,observed_at desc limit 1) o on true
    left join app.payment_refund_effects e on e.operation_id=a.id and e.payment_intent_id=i.id and e.merchant_shop_id=i.merchant_shop_id
    left join app.application_compensation_refunds r on r.payment_intent_id=i.id and r.merchant_shop_id=i.merchant_shop_id
    where i.merchant_shop_id=$1 and i.is_test and ($2::timestamptz is null or (i.created_at,i.id)<($2::timestamptz,$3::uuid))
    order by i.created_at desc,i.id desc limit 51`,[this.shopId,previous?.createdAt??null,cursor])).rows;
   const items=rows.slice(0,50);return{items,nextAfter:rows.length>50?items.at(-1)!.id:null};
  },{requireAdmin:true});
 }
}
