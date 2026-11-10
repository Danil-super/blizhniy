import {withAppSessionTransaction} from './app-session-transaction';
import {hashSessionToken} from './identity';
import {parseListingDraftId} from './listing-draft-contract.ts';
import {parseWorkOwnerAction} from './work-owner-actions-contract.ts';
import type {PostgresDatabase} from './postgres.ts';
export class WorkOwnerActionAccessError extends Error{constructor(){super('Work owner action unavailable');this.name='WorkOwnerActionAccessError';}}
export class WorkOwnerActionConflictError extends Error{constructor(){super('Work owner action changed');this.name='WorkOwnerActionConflictError';}}
export class WorkOwnerActionBusyError extends Error{constructor(){super('Work owner action participant busy');this.name='WorkOwnerActionBusyError';}}
export class WorkOwnerActionPaymentPendingError extends Error{constructor(){super('Response payment must be resolved');this.name='WorkOwnerActionPaymentPendingError';}}
export type WorkOwnerActionResult={operationId:string;publicationId:string;ownerId:string;kind:'vacancy'|'workRequest';expectedRevision:string;action:'withdraw'|'restore'|'remove';reason:string|null;resultingRevision:string;status:'archived'|'published';occurredAt:string};
const columns=`operation_id as "operationId",publication_id as "publicationId",owner_id as "ownerId",kind,expected_revision::text as "expectedRevision",action,reason,
 resulting_revision::text as "resultingRevision",status,to_char(occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "occurredAt"`;
export class PostgresWorkOwnerActions {
 constructor(private readonly db:Pick<PostgresDatabase,'transaction'>){}
 async change(token:string,owner:unknown,value:unknown):Promise<WorkOwnerActionResult>{
  const expected=parseListingDraftId(owner),input=parseWorkOwnerAction(value);
  try{return await withAppSessionTransaction(this.db,token,async(tx,user)=>{
   if(user.id!==expected)throw new WorkOwnerActionAccessError();
   const read=async()=>{const row=(await tx.query<WorkOwnerActionResult>(`select ${columns} from app.work_owner_actions where operation_id=$1`,[input.operationId])).rows[0];
    if(row&&(row.ownerId!==user.id||row.publicationId!==input.publicationId||row.kind!==input.kind||row.expectedRevision!==input.expectedRevision||row.action!==input.action||row.reason!==input.reason))throw new WorkOwnerActionConflictError();return row;};
   const prior=await read();if(prior)return prior;
   if((await tx.query('select id from app.work_publications where id=$1 and author_id=$2 and kind=$3',[input.publicationId,user.id,input.kind])).rowCount!==1)throw new WorkOwnerActionAccessError();
   await tx.query("select set_config('blizhniy.work_owner_session',$1,true)",[hashSessionToken(token)]);
   await tx.query('insert into app.work_owner_actions(operation_id,publication_id,expected_revision,action,reason) values($1,$2,$3::bigint,$4,$5)',[input.operationId,input.publicationId,input.expectedRevision,input.action,input.reason]);
   const saved=await read();if(!saved)throw new WorkOwnerActionAccessError();return saved;
  });}catch(error){if(error&&typeof error==='object'&&'code'in error){
   if(error.code==='55P03')throw new WorkOwnerActionBusyError();if(error.code==='PWA01')throw new WorkOwnerActionAccessError();
   if(error.code==='PWA02'||error.code==='PBL01'||error.code==='23505')throw new WorkOwnerActionConflictError();if(error.code==='PWA03')throw new WorkOwnerActionPaymentPendingError();
  }throw error;}
 }
}
