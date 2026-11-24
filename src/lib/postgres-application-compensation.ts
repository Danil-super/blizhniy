import {parseListingDraftId} from './listing-draft-contract.ts';
import {assessApplicationCompensation,type ApplicationCompensationFacts,type ApplicationCompensationAssessment} from './application-compensation-policy.ts';
import type {PostgresDatabase,PostgresQueries} from './postgres.ts';
export class ApplicationCompensationAccessError extends Error {constructor(){super('Application compensation requires reconciliation');this.name='ApplicationCompensationAccessError';}}
export class ApplicationCompensationBusyError extends Error {constructor(){super('Application compensation participant is busy');this.name='ApplicationCompensationBusyError';}}
export type ApplicationCompensationCase={paymentIntentId:string;applicationId:string;shopId:string;amount:string;
 fiscalMode:'provider-automatic-full'|'test-without-receipt';eligibleAt:string;createdAt:string}
 & ({policyVersion:'paid-response-unread-v1';reason:'unread-five-days'|'other-selected-unread'|'customer-closed-unread';
     deliveredAt:string;contactViewAt:string|null;selectedApplicationId:string|null}
  | {policyVersion:'paid-response-undelivered-v1';reason:'delivery-blocked';
     deliveredAt:null;contactViewAt:null;selectedApplicationId:null});
type Source={facts:ApplicationCompensationFacts;observedAt:string};
const columns=`payment_intent_id as "paymentIntentId",application_id as "applicationId",merchant_shop_id as "shopId",policy_version as "policyVersion",amount::text,
 fiscal_mode as "fiscalMode",reason,to_char(eligible_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "eligibleAt",
 to_char(delivered_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "deliveredAt",to_char(contact_view_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "contactViewAt",
 selected_application_id as "selectedApplicationId",to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt"`;
/** Private TEST intake, not a browser capability. No provider, financial UPDATE or retries. */
export class PostgresApplicationCompensationStore {
 private readonly shopId:string;
 private readonly db:Pick<PostgresDatabase,'transaction'>;
 constructor(db:Pick<PostgresDatabase,'transaction'>,merchant:{shopId:string;isTest:boolean}){
  if(typeof window!=='undefined'||!merchant||merchant.isTest!==true||typeof merchant.shopId!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(merchant.shopId))throw new ApplicationCompensationAccessError();
  this.db=db;this.shopId=merchant.shopId;
 }
 private async saved(tx:PostgresQueries,id:string){
  return(await tx.query<ApplicationCompensationCase>(`select ${columns} from app.application_compensation_cases where payment_intent_id=$1 and merchant_shop_id=$2`,[id,this.shopId])).rows[0]??null;
 }
 read(value:unknown){const id=parseListingDraftId(value);return this.db.transaction(tx=>this.saved(tx,id));}
 async claim(value:unknown):Promise<{state:'claimed';case:ApplicationCompensationCase}|Exclude<ApplicationCompensationAssessment,{state:'eligible'}>>{
  const id=parseListingDraftId(value);
  try{return await this.db.transaction(async tx=>{
   // A committed case survives later viewing/refund. Lost COMMIT ACK never permits a replacement key.
   const prior=await this.saved(tx,id);if(prior)return{state:'claimed',case:prior};
   const source=(await tx.query<{source:Source}>('select app.lock_application_compensation_source($1,$2) as source',[id,this.shopId])).rows[0]?.source;
   if(!source)throw new ApplicationCompensationAccessError();
   const assessment=assessApplicationCompensation(source.facts,source.observedAt);
   if(assessment.state!=='eligible')return assessment;
   await tx.query('insert into app.application_compensation_cases(payment_intent_id,merchant_shop_id) values($1,$2) on conflict do nothing',[id,this.shopId]);
   const saved=await this.saved(tx,id);if(!saved)throw new ApplicationCompensationAccessError();
   return{state:'claimed',case:saved};
  });}catch(error){
   if(error&&typeof error==='object'&&'code'in error){if(error.code==='55P03')throw new ApplicationCompensationBusyError();if(error.code==='PBC01'||error.code==='PBC02')throw new ApplicationCompensationAccessError();}
   throw error;
  }
 }
}
