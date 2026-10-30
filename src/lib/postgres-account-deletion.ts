import type {PostgresDatabase,PostgresQueries} from './postgres';
import {withDataSubjectTransaction} from './data-subject-transaction';
import {withAppSessionTransaction} from './app-session-transaction';
import {DeletionAccessError,DeletionConflictError,DeletionInputError,deletionId,deletionRevision,deletionDecision} from './account-deletion-contract';
import type {DeletionPrincipal,DeletionCase,AdminDeletionCase} from './account-deletion-contract';

const columns=`r.id,r.revision::text,r.status,r.requested_at as "requestedAt",r.review_started_at as "reviewStartedAt",
 r.resolved_at as "resolvedAt",r.resolution`;
type Row=Omit<AdminDeletionCase,'requestedAt'|'reviewStartedAt'|'resolvedAt'>&{requestedAt:Date;reviewStartedAt:Date|null;resolvedAt:Date|null};
function ownerView(row:Row):DeletionCase{return {id:row.id,revision:row.revision,status:row.status,requestedAt:row.requestedAt.toISOString(),
 reviewStartedAt:row.reviewStartedAt?.toISOString()??null,resolvedAt:row.resolvedAt?.toISOString()??null,resolution:row.resolution};}
function adminView(row:Row):AdminDeletionCase{return {...ownerView(row),ownerId:row.ownerId,email:row.email,caseReference:row.caseReference};}
function expected(actual:string,id:string){if(actual!==deletionId(id))throw new DeletionAccessError();}
async function actor(tx:PostgresQueries,id:string){await tx.query("select set_config('blizhniy.deletion_actor',$1,true)",[id]);}

/** Request handling only. A manual decision records an executed protected case, not an erasure job. */
export class PostgresAccountDeletionStore{
 constructor(private readonly db:Pick<PostgresDatabase,'transaction'>){if(typeof window!=='undefined')throw new DeletionAccessError();}
 session(token:string):Promise<DeletionPrincipal>{return withDataSubjectTransaction(this.db,token,async(_tx,user)=>({id:user.id,email:user.email,isBlocked:user.isBlocked}));}
 read(token:string,expectedOwnerId:string){
  deletionId(expectedOwnerId);
  return withDataSubjectTransaction(this.db,token,async(tx,user)=>{
   expected(user.id,expectedOwnerId);
   const row=(await tx.query<Row>(`select ${columns} from app.account_deletion_requests r where r.user_id=$1 order by r.requested_at desc,r.id desc limit 1`,[user.id])).rows[0];
   return {request:row?ownerView(row):null};
  });
 }
 request(token:string,expectedOwnerId:string){
  deletionId(expectedOwnerId);
  return withDataSubjectTransaction(this.db,token,async(tx,user)=>{
   expected(user.id,expectedOwnerId);await actor(tx,user.id);
   // User lock serializes duplicate submits, including recovery after an unknown response.
   let row=(await tx.query<Row>(`select ${columns} from app.account_deletion_requests r where r.user_id=$1 and r.status in ('requested','in_review') limit 1`,[user.id])).rows[0];
   row??=(await tx.query<Row>(`insert into app.account_deletion_requests as r(user_id) values($1) returning ${columns}`,[user.id])).rows[0];
   return {request:ownerView(row)};
  });
 }
 list(token:string,expectedAdminId:string,page:number){
  deletionId(expectedAdminId);if(!Number.isInteger(page)||page<0||page>1000)throw new DeletionInputError();
  return withAppSessionTransaction(this.db,token,async(tx,user)=>{
   expected(user.id,expectedAdminId);
   const rows=(await tx.query<Row>(`select ${columns},r.user_id as "ownerId",u.email,r.case_reference as "caseReference"
    from app.account_deletion_requests r left join app.users u on u.id=r.user_id
    where r.status in ('requested','in_review') order by r.requested_at,r.id limit 51 offset $1`,[page*50])).rows;
   return {requests:rows.slice(0,50).map(adminView),hasMore:rows.length>50};
  },{requireAdmin:true});
 }
 begin(token:string,expectedAdminId:string,id:string,revision:string){return this.transition(token,expectedAdminId,id,revision,null);}
 resolve(token:string,expectedAdminId:string,id:string,revision:string,decision:unknown){return this.transition(token,expectedAdminId,id,revision,deletionDecision(decision));}
 private transition(token:string,expectedAdminId:string,id:string,revision:string,decision:ReturnType<typeof deletionDecision>|null){
  deletionId(expectedAdminId);deletionId(id);deletionRevision(revision);
  return withAppSessionTransaction(this.db,token,async(tx,user)=>{
   expected(user.id,expectedAdminId);await actor(tx,user.id);
   const result=await tx.query(`update app.account_deletion_requests set status=$3,resolution=$4,case_reference=$5
    where id=$1 and revision=$2 and status=$6 returning id`,[id,revision,decision?'resolved':'in_review',decision?.resolution??null,
    decision?.caseReference??null,decision?'in_review':'requested']);
   if(result.rowCount!==1)throw new DeletionConflictError();
   const row=(await tx.query<Row>(`select ${columns},r.user_id as "ownerId",u.email,r.case_reference as "caseReference"
    from app.account_deletion_requests r left join app.users u on u.id=r.user_id where r.id=$1`,[id])).rows[0];
   return {request:adminView(row)};
  },{requireAdmin:true});
 }
}
