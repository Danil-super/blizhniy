import {PostgresPaymentReconciliationQueue} from './postgres-payment-reconciliation.ts';
import {PostgresPaymentVerificationStore} from './postgres-payment-verification.ts';
import {PostgresListingPaymentFulfillmentStore} from './postgres-listing-payment-fulfillment';
import type {PostgresDatabase} from './postgres';

type Merchant=ConstructorParameters<typeof PostgresPaymentVerificationStore>[1];
type Code='provider_pending'|'capture_required'|'processing_unavailable'|'publication_blocked'|'attempts_exhausted'|'phone_required';
type Result={state:'idle'|'lost'|'completed'}|{state:'deferred'|'blocked';code:Code};
/** Explicit one-job tick. No poller/startup hook, provider POST or caller-supplied financial snapshot. */
export function createPaymentReconciliationWorker(db:Pick<PostgresDatabase,'transaction'>,merchant:Merchant,fetcher:typeof fetch=globalThis.fetch){
 const mode=process.env.BLIZHNIY_LISTING_WORKFLOW;if(mode!==undefined&&!['pre-moderation','postmoderation'].includes(mode))throw Error('Invalid worker publication mode');
 const queue=new PostgresPaymentReconciliationQueue(db,merchant),verification=new PostgresPaymentVerificationStore(db,merchant,fetcher),fulfillment=new PostgresListingPaymentFulfillmentStore(db,merchant,{postmoderation:mode==='postmoderation'});
 return{async tick():Promise<Result>{
  // An unknown claim COMMIT is NOT retried: the persisted lease must expire first.
  const claim=await queue.claim();if(!claim)return{state:'idle'};if('exhausted' in claim)return{state:'blocked',code:'attempts_exhausted'};
  let state:'completed'|'retry'|'blocked'|'waiting_phone'='retry',code:Code|null='processing_unavailable';
  try{
   if(!await queue.owns(claim))return{state:'lost'};
   const verified=await verification.reconcile(claim.intentId);
   if(!await queue.owns(claim))return{state:'lost'};
   if(verified.orderStatus==='failed'||verified.orderStatus==='refunded'){state='completed';code=null;}
   else if(verified.orderStatus!=='succeeded')code='provider_pending';
   else if(!verified.capturedAt)code='capture_required';
   else{
    const result=await fulfillment.fulfill(claim.intentId);
    if(result.state==='fulfilled'){state='completed';code=null;}
    else if(result.state==='blocked'){state='blocked';code='publication_blocked';}
    else code='capture_required';
   }
  }catch(error){
   const sql=error&&typeof error==='object'&&'code'in error?error.code:null;
   if(sql==='P7601'){state='waiting_phone';code='phone_required';}
   else if(sql==='P7602'){state='blocked';code='publication_blocked';}
   else{state='retry';code='processing_unavailable';}
  }
  if(state==='retry'&&claim.attempts>=12){state='blocked';code='attempts_exhausted';}
  // Outside the catch: never replay acknowledgement after an unknown finish COMMIT.
  if(!await queue.finish(claim,state,code))return{state:'lost'};
  return state==='completed'?{state:'completed'}:{state:state==='retry'||state==='waiting_phone'?'deferred':'blocked',code:code!};
 }};
}
