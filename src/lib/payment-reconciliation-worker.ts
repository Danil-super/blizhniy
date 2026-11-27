import {PostgresPaymentReconciliationQueue} from './postgres-payment-reconciliation.ts';
import {PostgresPaymentVerificationStore,type VerificationStage} from './postgres-payment-verification.ts';
import {PostgresListingPaymentFulfillmentStore} from './postgres-listing-payment-fulfillment';
import {PostgresServicePaymentFulfillmentStore} from './postgres-service-payment-fulfillment';
import type {PostgresDatabase} from './postgres';

type Merchant=ConstructorParameters<typeof PostgresPaymentVerificationStore>[1];
type Code='provider_pending'|'capture_required'|'processing_unavailable'|'publication_blocked'|'attempts_exhausted'|'phone_required';
type ProcessingStage=VerificationStage|'claim_ownership'|'fulfillment';
type Result={state:'idle'|'lost'|'completed'}|{state:'deferred'|'blocked';code:Code};
/** Explicit one-job tick. No poller/startup hook, provider POST or caller-supplied financial snapshot. */
export function createPaymentReconciliationWorker(db:Pick<PostgresDatabase,'transaction'>,merchant:Merchant,fetcher:typeof fetch=globalThis.fetch,publicationTestOwner?:string,specialistAccountTest?:true,applicationAccountTest?:true,marqueeAccountTest?:true){
 const mode=process.env.BLIZHNIY_LISTING_WORKFLOW;if(mode!==undefined&&!['pre-moderation','postmoderation'].includes(mode))throw Error('Invalid worker publication mode');
 const publication=publicationTestOwner!==undefined;
 const queue=new PostgresPaymentReconciliationQueue(db,{shopId:merchant.shopId,isTest:merchant.isTest,publicationTestOwner,specialistAccountTest,applicationAccountTest,marqueeAccountTest}),verification=new PostgresPaymentVerificationStore(db,merchant,fetcher);
 const policy={postmoderation:mode==='postmoderation',...(publication?{publicationTestOwner}:{})};
 const fulfillments={listing:new PostgresListingPaymentFulfillmentStore(db,merchant,policy),...(publication?{
  ...(specialistAccountTest?{specialist:new PostgresListingPaymentFulfillmentStore(db,merchant,{...policy,targetType:'specialist',specialistAccountTest})}:{}),
  vacancy:new PostgresListingPaymentFulfillmentStore(db,merchant,{...policy,targetType:'vacancy'}),
  workRequest:new PostgresListingPaymentFulfillmentStore(db,merchant,{...policy,targetType:'workRequest'}),
 }:{})};
 const marquee=marqueeAccountTest?new PostgresServicePaymentFulfillmentStore(db,merchant,true):null;
 return{async tick(onProcessingFailure?:(stage:ProcessingStage)=>void):Promise<Result>{
  if(marquee){
   const [candidate]=await marquee.discover(1);
   if(candidate&&(await marquee.fulfill(candidate)).state==='fulfilled')return{state:'completed'};
  }
  if(publication)await queue.discover();
  // An unknown claim COMMIT is NOT retried: the persisted lease must expire first.
  const claim=await queue.claim();if(!claim)return{state:'idle'};if('exhausted' in claim)return{state:'blocked',code:'attempts_exhausted'};
  let state:'completed'|'retry'|'blocked'|'waiting_phone'='retry',code:Code|null='processing_unavailable';
  let stage:ProcessingStage='claim_ownership',failureStage:ProcessingStage|undefined;
  try{
   if(!await queue.owns(claim))return{state:'lost'};
   const verified=await verification.reconcile(claim.intentId,value=>{stage=value;});
   stage='claim_ownership';
   if(!await queue.owns(claim))return{state:'lost'};
   if(verified.orderStatus==='failed'||verified.orderStatus==='refunded'){state='completed';code=null;}
   else if(verified.orderStatus!=='succeeded')code='provider_pending';
   else if(!verified.capturedAt)code='capture_required';
   // Slot waiting is driven by persisted captures and has no provider retry budget.
   else if(claim.targetType==='ad_marquee'&&marquee){state='completed';code=null;}
   else if(claim.targetType==='application'&&applicationAccountTest){
    stage='fulfillment';
    const outcome=await db.transaction(async tx=>(await tx.query<{result:string}>(
      'select app_response.deliver($1,$2) as result',[claim.intentId,claim.claimId])).rows[0]?.result);
    if(outcome==='lost')return{state:'lost'};
    if(outcome==='delivered'||outcome==='already_delivered'){state='completed';code=null;}
    else if(outcome==='capture_required')code='capture_required';
    else if(['profile_changed','publication_changed','publication_closed','account_unavailable','reference_unavailable','application_changed','not_admitted'].includes(outcome??'')){state='blocked';code='publication_blocked';}
    else throw Error('Unknown application delivery outcome');
   }
   else{
    stage='fulfillment';
    const kind=publication?claim.targetType:'listing';
    if(!kind||kind==='application'||kind==='ad_marquee'||!Object.hasOwn(fulfillments,kind))throw Error('Invalid publication target');
    const result=await fulfillments[kind]!.fulfill(claim.intentId);
    if(result.state==='fulfilled'){state='completed';code=null;}
    else if(result.state==='blocked'){state='blocked';code='publication_blocked';}
    else code='capture_required';
   }
  }catch(error){
   const sql=error&&typeof error==='object'&&'code'in error?error.code:null;
   if(sql==='P7601'){state='waiting_phone';code='phone_required';}
   // A reserved refund is a durable publication fence, not a transient provider failure.
   else if(sql==='P7602'||sql==='PBR01'||(publication&&sql==='PRN01')||(claim.targetType==='specialist'&&sql==='PSP03')){state='blocked';code='publication_blocked';}
   else{state='retry';code='processing_unavailable';failureStage=stage;}
  }
  if(state==='retry'&&claim.attempts>=12){state='blocked';code='attempts_exhausted';}
  // Outside the catch: never replay acknowledgement after an unknown finish COMMIT.
  if(!await queue.finish(claim,state,code))return{state:'lost'};
  if(failureStage)onProcessingFailure?.(failureStage);
  return state==='completed'?{state:'completed'}:{state:state==='retry'||state==='waiting_phone'?'deferred':'blocked',code:code!};
 }};
}
