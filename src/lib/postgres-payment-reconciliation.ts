import {randomUUID} from 'node:crypto';
import {parseListingDraftId} from './listing-draft-contract.ts';
import type {PostgresDatabase} from './postgres';

export type ReconciliationClaim={intentId:string;claimId:string;attempts:number};
type Scope={shopId:string;isTest:boolean};
type Code='provider_pending'|'capture_required'|'processing_unavailable'|'publication_blocked'|'attempts_exhausted';
const scoped=`i.merchant_shop_id=$1 and i.is_test=$2 and i.target_type='listing'`;
/** Already-known payment IDs only. No payment data, provider POST or financial writes. */
export class PostgresPaymentReconciliationQueue{
 private readonly merchant:Scope;
 private readonly db:Pick<PostgresDatabase,'transaction'>;
 constructor(db:Pick<PostgresDatabase,'transaction'>,scope:Scope){
  if(typeof window!=='undefined'||!scope||typeof scope.shopId!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(scope.shopId)||typeof scope.isTest!=='boolean')throw new Error('Invalid reconciliation scope');
  this.db=db;this.merchant={...scope};
 }
 private scope(){return[this.merchant.shopId,this.merchant.isTest];}
 async enqueue(providerId:string):Promise<boolean>{
  const id=parseListingDraftId(providerId);return this.db.transaction(async tx=>{
   const found=(await tx.query<{id:string}>(`select i.id from app.payment_checkout_intents i join app.payment_provider_links p on p.intent_id=i.id
    where ${scoped} and p.provider_payment_id=$3`,[...this.scope(),id])).rows[0];
   if(!found)return false;
   await tx.query('insert into app.payment_reconciliation_jobs(intent_id) values($1) on conflict(intent_id) do nothing',[found.id]);
   return true;
  });
 }
 async claim():Promise<ReconciliationClaim|{exhausted:true}|null>{
  return this.db.transaction(async tx=>{
   const row=(await tx.query<{intentId:string;claimId:string|null;attempts:number}>(`with candidate as (
    select q.intent_id from app.payment_reconciliation_jobs q join app.payment_checkout_intents i on i.id=q.intent_id
    where ${scoped} and ((q.state='queued' and q.next_attempt_at<=clock_timestamp()) or (q.state='processing' and q.lease_until<=clock_timestamp()))
    order by case when q.state='processing' then q.lease_until else q.next_attempt_at end,q.intent_id limit 1 for update of q skip locked)
    update app.payment_reconciliation_jobs q set state=case when attempts>=12 then 'blocked' else 'processing' end,
     claim_id=case when attempts>=12 then null else $3::uuid end,
     lease_until=case when attempts>=12 then null else clock_timestamp()+interval '120 seconds' end,
     last_code=case when attempts>=12 then 'attempts_exhausted' else last_code end,attempts=least(12,attempts+1)
    from candidate c where q.intent_id=c.intent_id returning q.intent_id as "intentId",q.claim_id as "claimId",q.attempts`,[...this.scope(),randomUUID()])).rows[0];
   return !row?null:row.claimId?{intentId:row.intentId,claimId:row.claimId,attempts:row.attempts}:{exhausted:true};
  });
 }
 async owns(claim:ReconciliationClaim):Promise<boolean>{
  const id=parseListingDraftId(claim.intentId),token=parseListingDraftId(claim.claimId);
  return this.db.transaction(async tx=>(await tx.query(`select q.intent_id from app.payment_reconciliation_jobs q join app.payment_checkout_intents i on i.id=q.intent_id
   where ${scoped} and q.intent_id=$3 and q.claim_id=$4 and q.state='processing' and q.lease_until>clock_timestamp()`,[...this.scope(),id,token])).rowCount===1);
 }
 async finish(claim:ReconciliationClaim,state:'completed'|'retry'|'blocked',code:Code|null=null):Promise<boolean>{
  const id=parseListingDraftId(claim.intentId),token=parseListingDraftId(claim.claimId);
  if(!['completed','retry','blocked'].includes(state)||(state==='completed'?code!==null:!['provider_pending','capture_required','processing_unavailable','publication_blocked','attempts_exhausted'].includes(code??'')))throw new Error('Invalid reconciliation outcome');
  return this.db.transaction(async tx=>(await tx.query(`update app.payment_reconciliation_jobs q set
   state=case when $5='retry' then case when attempts>=12 then 'blocked' else 'queued' end else $5 end,
   last_code=case when $5='retry' and attempts>=12 then 'attempts_exhausted' else $6 end,claim_id=null,lease_until=null,
   next_attempt_at=clock_timestamp()+make_interval(secs=>least(3600,30*power(2,attempts-1))::integer)
   where q.intent_id=$3 and q.claim_id=$4 and q.state='processing' and q.lease_until>clock_timestamp()
    and exists(select 1 from app.payment_checkout_intents i where i.id=q.intent_id and ${scoped})`,[...this.scope(),id,token,state,code])).rowCount===1);
 }
}
