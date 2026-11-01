import {assertPrimaryYooKassaBinding,rublesToKopecks,YooKassaBoundaryError,type PrimaryYooKassaBinding} from './yookassa-payment-contract.ts';

export type KnownYooKassaRefund={
  payment:PrimaryYooKassaBinding&{providerPaymentId:string};
  providerRefundId:string;
  amount:string;
};
export type VerifiedYooKassaRefund={
  id:string;
  paymentId:string;
  amount:{value:string;currency:'RUB'};
  status:'pending'|'succeeded'|'canceled';
  createdAt:string;
};
const providerId=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function invalid():never{throw new YooKassaBoundaryError('YooKassa refund requires reconciliation');}
function object(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value);}

/** A known operation, not permission to create a refund or proof of eligibility. */
export function assertPrimaryYooKassaRefundBinding(expected:KnownYooKassaRefund,now:number):void{
  if(!object(expected)||!object(expected.payment))invalid();
  assertPrimaryYooKassaBinding(expected.payment,now);
  if(typeof expected.payment.providerPaymentId!=='string'||!providerId.test(expected.payment.providerPaymentId)||
     typeof expected.providerRefundId!=='string'||!providerId.test(expected.providerRefundId)||
     typeof expected.amount!=='string'||!/^(0|[1-9]\d{0,9})\.\d{2}$/.test(expected.amount)||
     rublesToKopecks(expected.amount)>rublesToKopecks(expected.payment.amount))invalid();
}

function timestampNanos(value:unknown):bigint{
  if(typeof value!=='string'||value.length>30)invalid();
  const parts=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(value),millis=Date.parse(value);
  if(!parts||!Number.isFinite(millis)||new Date(millis).toISOString()!==`${parts[1]}.${(parts[2]??'').padEnd(3,'0').slice(0,3)}Z`)invalid();
  return BigInt(millis)*BigInt(1_000_000)+BigInt((parts[2]??'').padEnd(9,'0').slice(3));
}

/** Consumed fields only; the Refund schema has no merchant/test fields.
 * Caller must independently verify the original payment with its bound merchant.
 * Source: https://yookassa.ru/developers/api/yookassa-openapi-specification.yaml
 */
export function validatePrimaryYooKassaRefund(payload:unknown,expected:KnownYooKassaRefund,now:number,capturedAt?:string):VerifiedYooKassaRefund{
  assertPrimaryYooKassaRefundBinding(expected,now);
  if(!Number.isSafeInteger(now)||!object(payload)||payload.id!==expected.providerRefundId||payload.payment_id!==expected.payment.providerPaymentId||
     !object(payload.amount)||payload.amount.value!==expected.amount||payload.amount.currency!=='RUB'||
     (payload.status!=='pending'&&payload.status!=='succeeded'&&payload.status!=='canceled'))invalid();
  const created=timestampNanos(payload.created_at);
  if(created>BigInt(now+5*60_000)*BigInt(1_000_000)||(capturedAt!==undefined&&created<timestampNanos(capturedAt)))invalid();
  return {id:expected.providerRefundId,paymentId:expected.payment.providerPaymentId,amount:{value:expected.amount,currency:'RUB'},status:payload.status,createdAt:payload.created_at as string};
}

/** Merge independently validated observations for ONE known refund. No totals or service effects. */
export function mergeRefundVerification(previous:VerifiedYooKassaRefund|null,next:VerifiedYooKassaRefund):VerifiedYooKassaRefund{
  let status=next.status;
  if(previous){
    if(previous.id!==next.id||previous.paymentId!==next.paymentId||previous.amount.value!==next.amount.value||
       previous.amount.currency!==next.amount.currency||timestampNanos(previous.createdAt)!==timestampNanos(next.createdAt))invalid();
    if(previous.status!=='pending'){
      if(next.status!=='pending'&&previous.status!==next.status)invalid();
      status=previous.status;
    }
  }
  return {id:next.id,paymentId:next.paymentId,amount:{...next.amount},status,createdAt:previous?.createdAt??next.createdAt};
}
