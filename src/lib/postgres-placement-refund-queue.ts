import {PostgresPlacementRefundReservationStore} from './postgres-placement-refund-reservations.ts';
import {parseListingDraftId} from './listing-draft-contract.ts';
import type {PostgresDatabase,PostgresQueries} from './postgres.ts';

export type PlacementRefundClaim={approvalId:string;claimId:string;attempts:number};
export type PlacementRefundJobCode='provider_pending'|'provider_canceled'|'processing_unavailable'|'attempts_exhausted'|'source_unavailable';
export class PlacementRefundLeaseError extends Error {readonly code='PRQ01';constructor(){super('Placement refund lease unavailable');this.name='PlacementRefundLeaseError';}}
const codes=['provider_pending','provider_canceled','processing_unavailable','attempts_exhausted','source_unavailable'];
function validateClaim(claim:PlacementRefundClaim){
 if(!claim||!Number.isInteger(claim.attempts)||claim.attempts<1||claim.attempts>12)throw Error('Invalid placement refund claim');
 return[parseListingDraftId(claim.approvalId),parseListingDraftId(claim.claimId)];
}
/** Private TEST operational queue. Only fixed definer functions can change jobs. */
export class PostgresPlacementRefundQueue {
 private readonly db:Pick<PostgresDatabase,'transaction'>;
 private readonly shopId:string;
 constructor(db:Pick<PostgresDatabase,'transaction'>,merchant:{shopId:string;isTest:boolean}){
  new PostgresPlacementRefundReservationStore(db,merchant);this.db=db;this.shopId=merchant.shopId;
 }
 async enqueueBatch(limit=50):Promise<number>{
  if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('Invalid placement refund batch');
  return this.db.transaction(async tx=>{
   const count=(await tx.query<{count:number}>('select app.enqueue_placement_refund_batch($1,$2) as count',[this.shopId,limit])).rows[0]?.count;
   if(typeof count!=='number'||!Number.isInteger(count)||count<0||count>limit)throw Error('Invalid placement refund batch result');return count;
  });
 }
 async claim():Promise<PlacementRefundClaim|{state:'completed'}|{state:'blocked';code:'attempts_exhausted'}|null>{
  return this.db.transaction(async tx=>{
   const value=(await tx.query<{job:unknown}>('select app.claim_placement_refund_job($1) as job',[this.shopId])).rows[0]?.job;
   if(value===null)return null;
   if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid placement refund job');
   if('state'in value){
    if(value.state==='completed'&&Object.keys(value).length===1)return{state:'completed'};
    if(value.state==='blocked'&&'code'in value&&value.code==='attempts_exhausted'&&Object.keys(value).length===2)return{state:'blocked',code:'attempts_exhausted'};
    throw Error('Invalid placement refund job');
   }
   if(Object.keys(value).length!==3)throw Error('Invalid placement refund claim');
   const claim=value as PlacementRefundClaim;validateClaim(claim);return claim;
  });
 }
 async owns(claim:PlacementRefundClaim):Promise<boolean>{
  const [id,token]=validateClaim(claim);
  return this.db.transaction(async tx=>{
   const owned=(await tx.query<{owned:boolean}>('select app.owns_placement_refund_job($1,$2,$3) as owned',[this.shopId,id,token])).rows[0]?.owned;
   if(typeof owned!=='boolean')throw Error('Invalid placement refund ownership');return owned;
  });
 }
 async assertActive(claim:PlacementRefundClaim,tx:PostgresQueries):Promise<number>{
  const [id,token]=validateClaim(claim);
  const remaining=(await tx.query<{remaining:number}>('select app.assert_placement_refund_job($1,$2,$3) as remaining',[this.shopId,id,token])).rows[0]?.remaining;
  if(!Number.isInteger(remaining)||remaining<=0)throw new PlacementRefundLeaseError();return remaining;
 }
 async finish(claim:PlacementRefundClaim,state:'completed'|'retry'|'blocked',code:PlacementRefundJobCode|null=null):Promise<boolean>{
  const [id,token]=validateClaim(claim);
  if(!['completed','retry','blocked'].includes(state)||(state==='completed'?code!==null:!codes.includes(code??'')))throw Error('Invalid placement refund outcome');
  return this.db.transaction(async tx=>{
   const finished=(await tx.query<{finished:boolean}>('select app.finish_placement_refund_job($1,$2,$3,$4,$5) as finished',[this.shopId,id,token,state,code])).rows[0]?.finished;
   if(typeof finished!=='boolean')throw Error('Invalid placement refund outcome result');return finished;
  });
 }
}
