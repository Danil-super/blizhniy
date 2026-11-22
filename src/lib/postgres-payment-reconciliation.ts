import {randomUUID} from 'node:crypto';
import {parseListingDraftId} from './listing-draft-contract.ts';
import type {PostgresDatabase} from './postgres';

export type ReconciliationClaim={intentId:string;claimId:string;attempts:number;targetType?:'listing'|'vacancy'|'workRequest'|'specialist'|'application'};
export type QueueAdmission = 'queued' | 'already_present';
type Scope={shopId:string;isTest:boolean;publicationTestOwner?:string;specialistAccountTest?:true;applicationAccountTest?:true};
type Code='provider_pending'|'capture_required'|'processing_unavailable'|'publication_blocked'|'attempts_exhausted'|'phone_required';
/** Already-known payment IDs only. No payment data, provider POST or financial writes. */
export class PostgresPaymentReconciliationQueue{
 private readonly merchant:Scope;
 private readonly db:Pick<PostgresDatabase,'transaction'>;
 constructor(db:Pick<PostgresDatabase,'transaction'>,scope:Scope){
  if(typeof window!=='undefined'||!scope||typeof scope.shopId!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(scope.shopId)||typeof scope.isTest!=='boolean')throw new Error('Invalid reconciliation scope');
  if(scope.publicationTestOwner!==undefined&&(!scope.isTest||parseListingDraftId(scope.publicationTestOwner)!==scope.publicationTestOwner))throw new Error('Invalid publication TEST scope');
  if(scope.specialistAccountTest!==undefined&&(scope.specialistAccountTest!==true||!scope.publicationTestOwner||!/^[1-9][0-9]{0,63}$/.test(scope.shopId)))throw new Error('Invalid specialist TEST scope');
  if(scope.applicationAccountTest!==undefined&&(scope.applicationAccountTest!==true||!scope.publicationTestOwner||!/^[1-9][0-9]{0,63}$/.test(scope.shopId)))throw new Error('Invalid response TEST scope');
  this.db=db;this.merchant={...scope};
 }
 private scope(){return[this.merchant.shopId,this.merchant.isTest];}
 private scoped(ownerParameter:number){
  const merchant='i.merchant_shop_id=$1 and i.is_test=$2';
  if(!this.merchant.publicationTestOwner)return merchant+" and i.target_type='listing'";
  const standard="i.target_type in ('listing','vacancy','workRequest') and i.request_body::jsonb->'metadata'->>'publicationMode'='account-test-v1'";
  const specialist=this.merchant.specialistAccountTest?` or (i.target_type='specialist' and i.request_body::jsonb->'metadata'->>'publicationMode'='specialist-account-test-v1'
   and exists(select 1 from app.specialist_checkout_terms t where t.intent_id=i.id))`:'';
  const application=this.merchant.applicationAccountTest?` or (i.target_type='application' and i.tariff_id='job-response' and i.duration_days is null
   and exists(select 1 from app_response.admissions a where a.intent_id=i.id and a.applicant_id=i.owner_id and a.shop_id=i.merchant_shop_id))`:'';
  return `${merchant} and i.owner_id=$${ownerParameter} and ((${standard})${specialist}${application})`;
 }
 private values(...tail:unknown[]){return [...this.scope(),...tail,...(this.merchant.publicationTestOwner?[this.merchant.publicationTestOwner]:[])];}
 async discover():Promise<void>{
  if(!this.merchant.publicationTestOwner)throw new Error('Publication TEST scope required');
  await this.db.transaction(async tx=>{await tx.query(`insert into app.payment_reconciliation_jobs(intent_id)
   select i.id from app.payment_checkout_intents i join app.payment_provider_links p on p.intent_id=i.id
    join app.payment_orders o on o.id=i.id where ${this.scoped(3)} and o.status in ('created','pending','succeeded')
    and not exists(select 1 from app.payment_reconciliation_jobs q where q.intent_id=i.id)
    and not exists(select 1 from app.payment_fulfillments f where f.intent_id=i.id)
   order by i.id limit 5 on conflict(intent_id) do nothing`,this.values());});
 }
 async enqueue(providerId:string, onCommit?: (outcome: QueueAdmission) => void):Promise<boolean>{
  const id=parseListingDraftId(providerId);
  const outcome = await this.db.transaction(async tx=>{
   const found=(await tx.query<{id:string}>(`select i.id from app.payment_checkout_intents i join app.payment_provider_links p on p.intent_id=i.id
    where ${this.scoped(4)} and p.provider_payment_id=$3`,this.values(id))).rows[0];
   if(!found)return null;
   const inserted = await tx.query('insert into app.payment_reconciliation_jobs(intent_id) values($1) on conflict(intent_id) do nothing',[found.id]);
   return inserted.rowCount === 1 ? 'queued' : 'already_present';
  });
  if(outcome === null)return false;
  onCommit?.(outcome);
  return true;
 }
 async claim():Promise<ReconciliationClaim|{exhausted:true}|null>{
  return this.db.transaction(async tx=>{
   const row=(await tx.query<{intentId:string;claimId:string|null;attempts:number;targetType?:ReconciliationClaim['targetType']}>(`with candidate as (
    select q.intent_id${this.merchant.publicationTestOwner?',i.target_type':''} from app.payment_reconciliation_jobs q join app.payment_checkout_intents i on i.id=q.intent_id
    where ${this.scoped(4)} and ((q.state='queued' and q.next_attempt_at<=clock_timestamp()) or (q.state='processing' and q.lease_until<=clock_timestamp()))
    order by case when q.state='processing' then q.lease_until else q.next_attempt_at end,q.intent_id limit 1 for update of q skip locked)
    update app.payment_reconciliation_jobs q set state=case when attempts>=12 then 'blocked' else 'processing' end,
     claim_id=case when attempts>=12 then null else $3::uuid end,
     lease_until=case when attempts>=12 then null else clock_timestamp()+interval '120 seconds' end,
     last_code=case when attempts>=12 then 'attempts_exhausted' else last_code end,attempts=least(12,attempts+1)
    from candidate c where q.intent_id=c.intent_id returning q.intent_id as "intentId",q.claim_id as "claimId",q.attempts${this.merchant.publicationTestOwner?',c.target_type as "targetType"':''}`,this.values(randomUUID()))).rows[0];
   if(row?.claimId&&this.merchant.publicationTestOwner&&!(row.targetType==='application'&&this.merchant.applicationAccountTest)&&!(row.targetType==='specialist'&&this.merchant.specialistAccountTest)&&!['listing','vacancy','workRequest'].includes(row.targetType??''))throw new Error('Invalid publication TEST target');
   return !row?null:row.claimId?{intentId:row.intentId,claimId:row.claimId,attempts:row.attempts,...(this.merchant.publicationTestOwner?{targetType:row.targetType}:{})}:{exhausted:true};
  });
 }
 async owns(claim:ReconciliationClaim):Promise<boolean>{
  const id=parseListingDraftId(claim.intentId),token=parseListingDraftId(claim.claimId);
  return this.db.transaction(async tx=>(await tx.query(`select q.intent_id from app.payment_reconciliation_jobs q join app.payment_checkout_intents i on i.id=q.intent_id
   where ${this.scoped(5)} and q.intent_id=$3 and q.claim_id=$4 and q.state='processing' and q.lease_until>clock_timestamp()`,this.values(id,token))).rowCount===1);
 }
 async finish(claim:ReconciliationClaim,state:'completed'|'retry'|'blocked'|'waiting_phone',code:Code|null=null):Promise<boolean>{
  const id=parseListingDraftId(claim.intentId),token=parseListingDraftId(claim.claimId);
  if(!['completed','retry','blocked','waiting_phone'].includes(state)||(state==='completed'?code!==null:!['provider_pending','capture_required','processing_unavailable','publication_blocked','attempts_exhausted','phone_required'].includes(code??'')))throw new Error('Invalid reconciliation outcome');
  return this.db.transaction(async tx=>{
   // Same user -> queue order as phone confirmation. The SQL trigger closes the
   // confirmation/acknowledgement race without reopening terminal jobs.
   if(state==='waiting_phone')await tx.query('select u.id from app.users u where u.id=(select owner_id from app.payment_checkout_intents where id=$1) for update of u',[id]);
   return (await tx.query(`update app.payment_reconciliation_jobs q set
   state=case when $5='retry' then case when attempts>=12 then 'blocked' else 'queued' end else $5 end,
   last_code=case when $5='retry' and attempts>=12 then 'attempts_exhausted' else $6 end,claim_id=null,lease_until=null,
   next_attempt_at=clock_timestamp()+make_interval(secs=>least(3600,30*power(2,attempts-1))::integer)
   where q.intent_id=$3 and q.claim_id=$4 and q.state='processing' and q.lease_until>clock_timestamp()
    and exists(select 1 from app.payment_checkout_intents i where i.id=q.intent_id and ${this.scoped(7)})`,this.values(id,token,state,code))).rowCount===1;});
 }
}
