import {withAppSessionTransaction} from './app-session-transaction';
import {hashSessionToken} from './identity';
import {validPlainText} from './cabinet-field-validation.ts';
import {parseListingDraftId} from './listing-draft-contract.ts';
import {PostgresRefundDispatchStore} from './postgres-refund-dispatch.ts';
import {PostgresRefundJournalStore} from './postgres-refund-journal.ts';
import {PostgresPlacementRefundEffectStore} from './postgres-placement-refund-effect.ts';
import {PostgresApplicationCompensationRefundStore} from './postgres-application-compensation-refund.ts';
import type {PostgresDatabase,PostgresQueries} from './postgres.ts';

export class RefundRecoveryError extends Error {
 constructor(){super('Refund recovery unavailable');this.name='RefundRecoveryError';}
}
type RecoveryInput={id:string;operationId:string;providerRefundId:string;reason:string};
export function parseRefundRecovery(value:unknown):RecoveryInput {
 try{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error();
  const row=value as Record<string,unknown>;
  if(Reflect.ownKeys(row).length!==4||!['id','operationId','providerRefundId','reason'].every(key=>Object.hasOwn(row,key))||
   typeof row.reason!=='string'||!row.reason.trim()||row.reason.trim().length>500||!validPlainText(row.reason.trim()))throw Error();
  return{id:parseListingDraftId(row.id),operationId:parseListingDraftId(row.operationId),providerRefundId:parseListingDraftId(row.providerRefundId),reason:row.reason.trim()};
 }catch{throw new RefundRecoveryError();}
}
type Database=Pick<PostgresDatabase,'transaction'>;
type Merchant=ConstructorParameters<typeof PostgresRefundJournalStore>[1];
type Source={paymentIntentId:string;targetType:string;shopId:string};
type Audit=RecoveryInput&{operatorId:string;phase:'requested'|'pending'|'succeeded'|'canceled';recordedAt:string};
const columns=`action_id as id,operation_id as "operationId",provider_refund_id as "providerRefundId",reason,operator_id as "operatorId",phase,
 to_char(recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "recordedAt"`;
function fail():never {throw new RefundRecoveryError();}
/** Private TEST operator capability. Every remote call is GET; each mutation needs a fresh live administrator. */
export function createPrimaryRefundRecovery(db:Database,merchant:Merchant,fetcher:typeof fetch=globalThis.fetch) {
 // Validate the complete TEST provider configuration before any SQL or HTTP.
 new PostgresRefundJournalStore(db,merchant,fetcher);
 const scope={...merchant};
 async function authorized<T>(token:string,actor:string,input:RecoveryInput,request:boolean,work:(tx:PostgresQueries,source:Source)=>Promise<T>):Promise<T>{
  return withAppSessionTransaction(db,token,async(tx,user)=>{
   if(user.id!==actor)fail();
   await tx.query("select set_config('blizhniy.refund_recovery_session',$1,true)",[hashSessionToken(token)]);
   const source=(await tx.query<{source:Source}>('select app.lock_refund_recovery_source($1,$2) as source',[input.operationId,input.providerRefundId])).rows[0]?.source;
   if(!source||source.shopId!==scope.shopId)fail();
   // Reuse canonical source validation and reject a newly bound, contradictory candidate before every write.
   const loaded=await new PostgresRefundDispatchStore({transaction:task=>task(tx)},scope).load(input.operationId);
   if(!loaded.attempted||(loaded.candidateId&&loaded.candidateId!==input.providerRefundId))fail();
   if(request)await tx.query(`insert into app.payment_refund_recovery_actions(action_id,operation_id,provider_refund_id,reason,phase)
    values($1,$2,$3,$4,'requested') on conflict do nothing`,[input.id,input.operationId,input.providerRefundId,input.reason]);
   const saved=(await tx.query<Audit>(`select ${columns} from app.payment_refund_recovery_actions where action_id=$1 and phase='requested'`,[input.id])).rows[0];
   if(!saved||saved.operatorId!==actor||saved.operationId!==input.operationId||saved.providerRefundId!==input.providerRefundId||saved.reason!==input.reason)fail();
   return work(tx,source);
  },{requireAdmin:true,denied:()=>new RefundRecoveryError()});
 }
 async function prepare(token:string,actor:string,input:RecoveryInput){
  return authorized(token,actor,input,true,async tx=>{
   const audit=(await tx.query<Audit>(`select ${columns} from app.payment_refund_recovery_actions where action_id=$1 and phase in ('succeeded','canceled')`,[input.id])).rows[0];
   if(!audit)return null;
   const verification=await new PostgresRefundJournalStore({transaction:work=>work(tx)},scope,fetcher).read(input.operationId);
   if(!verification||verification.providerRefundId!==input.providerRefundId||verification.status!==audit.phase)fail();
   return{state:verification.status==='succeeded'?'applied' as const:verification.status,verification,audit};
  });
 }
 return{
  /** Durable administrator request and local terminal proof; never provider I/O or a new financial attempt. */
  prepare(token:string,expectedAdmin:unknown,value:unknown){return prepare(token,parseListingDraftId(expectedAdmin),parseRefundRecovery(value));},
  async recover(token:string,expectedAdmin:unknown,value:unknown){
  const input=parseRefundRecovery(value),actor=parseListingDraftId(expectedAdmin);
  const completed=await prepare(token,actor,input);
  if(completed)return completed;
  const guarded:Database={transaction:work=>authorized(token,actor,input,false,tx=>work(tx))};
  await new PostgresRefundJournalStore(guarded,scope,fetcher).reconcile(input.operationId,input.providerRefundId);
  return authorized(token,actor,input,false,async(tx,source)=>{
   const local:Database={transaction:work=>work(tx)};
   const verified=await new PostgresRefundJournalStore(local,scope,fetcher).read(input.operationId);
   if(!verified||verified.providerRefundId!==input.providerRefundId)fail();
   if(verified.status==='succeeded'){
    if(source.targetType==='application')await new PostgresApplicationCompensationRefundStore(local,scope).apply(source.paymentIntentId);
    else await new PostgresPlacementRefundEffectStore(local,scope).apply(input.operationId);
   }
   await tx.query(`insert into app.payment_refund_recovery_actions(action_id,operation_id,provider_refund_id,reason,phase)
    values($1,$2,$3,$4,'observe') on conflict do nothing`,[input.id,input.operationId,input.providerRefundId,input.reason]);
   const audit=(await tx.query<Audit>(`select ${columns} from app.payment_refund_recovery_actions where action_id=$1 and phase=$2`,[input.id,verified.status])).rows[0];
   if(!audit)fail();
   return{state:verified.status==='succeeded'?'applied' as const:verified.status,verification:verified,audit};
  });
 }};
}
