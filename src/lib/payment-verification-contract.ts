import type {YooKassaPaymentStatus} from './yookassa-payment-contract.ts';

export type PaymentVerificationState = {status:YooKassaPaymentStatus;capturedAt:string|null};
export class PaymentVerificationError extends Error {
  constructor(){super('Payment verification requires reconciliation');this.name='PaymentVerificationError';}
}
function captureKey(value:string){
  const parts=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(value);
  if(!parts)throw new PaymentVerificationError();
  return `${parts[1]}.${(parts[2]??'').padEnd(9,'0')}Z`;
}
/** Merge only independently validated provider states, preserving all capture precision. */
export function mergePaymentVerification(previous:PaymentVerificationState|null,next:PaymentVerificationState):PaymentVerificationState{
  if(!previous)return {...next};
  if(previous.status==='succeeded'||previous.status==='canceled'){
    if(next.status!=='succeeded'&&next.status!=='canceled')return {...previous};
    if(previous.status!==next.status)throw new PaymentVerificationError();
  }else if(previous.status==='waiting_for_capture'&&next.status==='pending')return {...previous};
  if(previous.capturedAt&&next.capturedAt&&captureKey(previous.capturedAt)!==captureKey(next.capturedAt))throw new PaymentVerificationError();
  return {status:next.status,capturedAt:previous.capturedAt??next.capturedAt};
}
