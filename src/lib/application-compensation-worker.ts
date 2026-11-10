import {PostgresApplicationCompensationQueue,type ApplicationCompensationJobCode} from './postgres-application-compensation-queue.ts';
import {createApplicationCompensationRefundProcessor} from './primary-application-compensation-refund.ts';
import type {PostgresDatabase} from './postgres.ts';
import {PostgresApplicationCompensationDiscovery} from './postgres-application-compensation-discovery.ts';

type Result={state:'idle'|'lost'|'completed'}|{state:'deferred'|'blocked';code:ApplicationCompensationJobCode};
/** Explicit one-job TEST tick. No automatic startup, ambient credentials or SQL retry. */
export function createApplicationCompensationWorker(
 db:Pick<PostgresDatabase,'transaction'>,
 merchant:Parameters<typeof createApplicationCompensationRefundProcessor>[1],
 fetcher:typeof fetch=globalThis.fetch,
){
 const queue=new PostgresApplicationCompensationQueue(db,merchant),processor=createApplicationCompensationRefundProcessor(db,merchant,fetcher);
 const discovery=new PostgresApplicationCompensationDiscovery(db,merchant);
 const worker={async tick():Promise<Result>{
  // Unknown enqueue/claim COMMIT propagates; no provider request may start from it.
  await queue.enqueueBatch();const claim=await queue.claim();
  if(!claim)return{state:'idle'};if('state'in claim)return claim;
  let state:'completed'|'retry'|'blocked'='retry',code:ApplicationCompensationJobCode|null='processing_unavailable';
  try{
   const result=await processor.process(claim.paymentIntentId,tx=>queue.assertActive(claim,tx));
   if(result.state==='applied'){state='completed';code=null;}
   else if(result.state==='pending')code='provider_pending';
   else if(result.state==='canceled'){state='blocked';code='provider_canceled';}
   else{state='blocked';code='source_unavailable';}
  }catch(error){
   if(error&&typeof error==='object'&&'code'in error&&error.code==='PBQ01')return{state:'lost'};
   if(!await queue.owns(claim))return{state:'lost'};
  }
  // Finish uncertainty is not caught/replayed. Durable effects recover without HTTP.
  if(!await queue.finish(claim,state,code))return{state:'lost'};
  return state==='completed'?{state:'completed'}:{state:state==='retry'?'deferred':'blocked',code:code!};
 }};
 return{...worker,async sweep(){
  const discovered=await discovery.scan();
  return{discovery:discovered,processing:await worker.tick()};
 }};
}
