import {PostgresApplicationCompensationStore} from './postgres-application-compensation.ts';
import {parseListingDraftId} from './listing-draft-contract.ts';
import type {PostgresDatabase,PostgresQueries} from './postgres.ts';

export type ApplicationCompensationClaim={paymentIntentId:string;claimId:string;attempts:number};
export type ApplicationCompensationJobCode='provider_pending'|'provider_canceled'|'processing_unavailable'|'attempts_exhausted'|'source_unavailable';
export class ApplicationCompensationLeaseError extends Error {readonly code='PBQ01';constructor(){super('Compensation lease unavailable');this.name='ApplicationCompensationLeaseError';}}
const codes=['provider_pending','provider_canceled','processing_unavailable','attempts_exhausted','source_unavailable'];
function validateClaim(claim:ApplicationCompensationClaim){
 if(!claim||!Number.isInteger(claim.attempts)||claim.attempts<1||claim.attempts>12)throw Error('Invalid compensation claim');
 return[parseListingDraftId(claim.paymentIntentId),parseListingDraftId(claim.claimId)];
}
/** Private TEST operational queue. Only fixed definer functions can change jobs. */
export class PostgresApplicationCompensationQueue {
 private readonly db:Pick<PostgresDatabase,'transaction'>;
 private readonly shopId:string;
 constructor(db:Pick<PostgresDatabase,'transaction'>,merchant:{shopId:string;isTest:boolean}){
  new PostgresApplicationCompensationStore(db,merchant);this.db=db;this.shopId=merchant.shopId;
 }
 async enqueueBatch(limit=50):Promise<number>{
  if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('Invalid compensation batch');
  return this.db.transaction(async tx=>{
   const count=(await tx.query<{count:number}>('select app.enqueue_application_compensation_batch($1,$2) as count',[this.shopId,limit])).rows[0]?.count;
   if(typeof count!=='number'||!Number.isInteger(count)||count<0||count>limit)throw Error('Invalid compensation batch result');return count;
  });
 }
 async claim():Promise<ApplicationCompensationClaim|{state:'completed'}|{state:'blocked';code:'attempts_exhausted'}|null>{
  return this.db.transaction(async tx=>{
   const value=(await tx.query<{job:unknown}>('select app.claim_application_compensation_job($1) as job',[this.shopId])).rows[0]?.job;
   if(value===null)return null;
   if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid compensation job');
   if('state'in value){
    if(value.state==='completed'&&Object.keys(value).length===1)return{state:'completed'};
    if(value.state==='blocked'&&'code'in value&&value.code==='attempts_exhausted'&&Object.keys(value).length===2)return{state:'blocked',code:'attempts_exhausted'};
    throw Error('Invalid compensation job');
   }
   if(Object.keys(value).length!==3)throw Error('Invalid compensation claim');
   const claim=value as ApplicationCompensationClaim;validateClaim(claim);return claim;
  });
 }
 async owns(claim:ApplicationCompensationClaim):Promise<boolean>{
  const [id,token]=validateClaim(claim);
  return this.db.transaction(async tx=>{
   const owned=(await tx.query<{owned:boolean}>('select app.owns_application_compensation_job($1,$2,$3) as owned',[this.shopId,id,token])).rows[0]?.owned;
   if(typeof owned!=='boolean')throw Error('Invalid compensation ownership');return owned;
  });
 }
 async assertActive(claim:ApplicationCompensationClaim,tx:PostgresQueries):Promise<void>{
  const [id,token]=validateClaim(claim);
  await tx.query('select app.assert_application_compensation_job($1,$2,$3)',[this.shopId,id,token]);
 }
 async remaining(claim:ApplicationCompensationClaim,tx:PostgresQueries):Promise<number>{
  const [id,token]=validateClaim(claim);
  const remaining=(await tx.query<{remaining:number}>('select app.assert_application_compensation_job_remaining($1,$2,$3) as remaining',[this.shopId,id,token])).rows[0]?.remaining;
  if(!Number.isInteger(remaining)||remaining<1||remaining>300000)throw new ApplicationCompensationLeaseError();return remaining;
 }
 async finish(claim:ApplicationCompensationClaim,state:'completed'|'retry'|'blocked',code:ApplicationCompensationJobCode|null=null):Promise<boolean>{
  const [id,token]=validateClaim(claim);
  if(!['completed','retry','blocked'].includes(state)||(state==='completed'?code!==null:!codes.includes(code??'')))throw Error('Invalid compensation outcome');
  return this.db.transaction(async tx=>{
   const finished=(await tx.query<{finished:boolean}>('select app.finish_application_compensation_job($1,$2,$3,$4,$5) as finished',[this.shopId,id,token,state,code])).rows[0]?.finished;
   if(typeof finished!=='boolean')throw Error('Invalid compensation outcome result');return finished;
  });
 }
}
