import {PostgresPlacementRefundQueue,PlacementRefundLeaseError,type PlacementRefundJobCode} from './postgres-placement-refund-queue.ts';
import {createApprovedPlacementRefundProcessor} from './primary-approved-placement-refund.ts';
import {PostgresRefundJournalStore} from './postgres-refund-journal.ts';
import type {PostgresDatabase} from './postgres.ts';

type Result={state:'idle'|'lost'|'completed'}|{state:'deferred'|'blocked';code:PlacementRefundJobCode};
/** One explicit TEST tick. No startup, ambient credentials, replacement keys or SQL retry. */
export function createPlacementRefundWorker(
 db:Pick<PostgresDatabase,'transaction'>,
 config:Parameters<typeof createApprovedPlacementRefundProcessor>[1],
 fetcher:typeof fetch=globalThis.fetch,
){
 const merchant={...config},queue=new PostgresPlacementRefundQueue(db,merchant);
 new PostgresRefundJournalStore(db,merchant,fetcher);
 return{async tick():Promise<Result>{
  await queue.enqueueBatch();const claim=await queue.claim();
  if(!claim)return{state:'idle'};if('state'in claim)return claim;
  let deadline=-Infinity;
  // A delayed COMMIT acknowledgement must not authorize HTTP after this lease expired.
  const leasedFetch:typeof fetch=(url,init)=>{
   if(init?.method==='POST'&&performance.now()>=deadline)throw new PlacementRefundLeaseError();
   return fetcher(url,init);
  };
  const processor=createApprovedPlacementRefundProcessor(db,merchant,leasedFetch);
  let state:'completed'|'retry'|'blocked'='retry',code:PlacementRefundJobCode|null='processing_unavailable';
  try{
   const result=await processor.process(claim.approvalId,async tx=>{
    const started=performance.now(),remaining=await queue.assertActive(claim,tx);
    deadline=started+remaining;
   });
   if(result.state==='applied'){state='completed';code=null;}
   else if(result.state==='pending')code='provider_pending';
   else if(result.state==='canceled'){state='blocked';code='provider_canceled';}
   else{state='blocked';code='source_unavailable';}
  }catch(error){
   if(error&&typeof error==='object'&&'code'in error&&error.code==='PRQ01')return{state:'lost'};
   if(!await queue.owns(claim))return{state:'lost'};
  }
  if(!await queue.finish(claim,state,code))return{state:'lost'};
  return state==='completed'?{state:'completed'}:{state:state==='retry'?'deferred':'blocked',code:code!};
 }};
}
