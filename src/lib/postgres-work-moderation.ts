import {withAppSessionTransaction} from './app-session-transaction';
import {AdminAccessError} from './admin-authorization';
import {PostgresWorkPublicationStore,WorkPublicationAccessError,WorkPublicationConflictError} from './postgres-work-publications';
import {parseListingDraftId,parseListingDraftRevision,parseListingDraftCursor} from './listing-draft-contract.ts';
import {parseWorkReviewDecision,WorkModerationInputError} from './work-moderation-contract';
import type {WorkPublicationKind} from './work-publication-contract';
import type {PostgresDatabase,PostgresQueries} from './postgres';
import type {MediaFileRecord} from './media-files';
type Row={id:string;publicationId:string;kind:WorkPublicationKind;revision:string;state:'pending'|'approved'|'rejected';note:string|null};
export type WorkModerationState={id:string|null;revision:string|null;state:Row['state']|'not_submitted'|'outdated';note:string|null};
const columns='m.id,m.publication_id as "publicationId",m.revision::text as revision,m.state,m.decision_note as note';
const state=({id,revision,state,note}:Row):WorkModerationState=>({id,revision,state,note});

/** Revision-bound moderation only; never grants payment, publication or ownership authority. */
export class PostgresWorkModerationStore{
 private readonly forms:PostgresWorkPublicationStore;
 constructor(private readonly db:Pick<PostgresDatabase,'transaction'>,private readonly files?:{read(record:MediaFileRecord):Promise<Buffer>}){this.forms=new PostgresWorkPublicationStore(db);}
 private owner<T>(token:string,owner:string,work:(tx:PostgresQueries)=>Promise<T>){return withAppSessionTransaction(this.db,token,(tx,user)=>{
  if(user.id!==owner)throw new WorkPublicationAccessError();return work(tx);
 });}
 private admin<T>(token:string,expectedAdminId:string,work:(tx:PostgresQueries,actor:string)=>Promise<T>){return withAppSessionTransaction(this.db,token,(tx,user)=>{
  if(user.id!==expectedAdminId)throw new AdminAccessError();return work(tx,user.id);
 },{requireAdmin:true,denied:()=>new AdminAccessError()});}
 submit(token:string,owner:string,kind:WorkPublicationKind,id:unknown,revision:unknown){return this.owner(token,owner,async tx=>{
  const {snapshot,issues}=await this.forms.inspectInTransaction(tx,owner,kind,id,revision);if(issues.length)throw new WorkModerationInputError();
  await tx.query('insert into app.work_moderation(publication_id,revision) values($1,$2::bigint) on conflict(publication_id,revision) do nothing',[snapshot.id,snapshot.revision]);
  return state((await tx.query<Row>(`select ${columns} from app.work_moderation m where publication_id=$1 and revision=$2::bigint`,[snapshot.id,snapshot.revision])).rows[0]);
 });}
 read(token:string,owner:string,kind:WorkPublicationKind,publicationId:unknown,expectedRevision:unknown){return this.owner(token,owner,async tx=>{
  const id=parseListingDraftId(publicationId),revision=parseListingDraftRevision(expectedRevision);
  const row=(await tx.query<{revision:string}>('select revision::text as revision from app.work_publications where id=$1 and author_id=$2 and kind=$3 and deleted_at is null for update',[id,owner,kind])).rows[0];
  if(!row)throw new WorkPublicationAccessError();if(row.revision!==revision)throw new WorkPublicationConflictError();
  const review=(await tx.query<Row>(`select ${columns} from app.work_moderation m where publication_id=$1 order by revision desc limit 1`,[id])).rows[0];
  return review?{...state(review),state:review.revision===revision?review.state:'outdated' as const}:{id:null,revision:null,state:'not_submitted' as const,note:null};
 });}
 private async review(tx:PostgresQueries,requestId:unknown,actor:string){
  const id=parseListingDraftId(requestId);
  const row=(await tx.query<Row&{owner:string}>(`select ${columns},w.kind,w.author_id as owner from app.work_moderation m
   join app.work_publications w on w.id=m.publication_id join app.users u on u.id=w.author_id
   where m.id=$1 and w.deleted_at is null and not u.is_blocked and u.email_verified_at is not null`,[id])).rows[0];
  if(!row)throw new WorkPublicationAccessError();if(row.owner===actor)throw new AdminAccessError();
  const inspected=await this.forms.inspectInTransaction(tx,row.owner,row.kind,row.publicationId,row.revision);
  const request=(await tx.query<Row>(`select ${columns} from app.work_moderation m where id=$1 for update`,[id])).rows[0];
  return{request,...inspected};
 }
 inspect(token:string,id:unknown,expectedAdminId:string){return this.admin(token,expectedAdminId,async(tx,actor)=>{
  const {request,...inspected}=await this.review(tx,id,actor);return{request:state(request),...inspected};
 });}
 decide(token:string,id:unknown,decision:unknown,note:unknown,expectedAdminId:string){
  const parsed=parseWorkReviewDecision(decision,note);
  return this.admin(token,expectedAdminId,async(tx,actor)=>{
   const {request,issues}=await this.review(tx,id,actor);if(parsed.state==='approved'&&issues.length)throw new WorkModerationInputError();
   if(request.state!=='pending'){if(request.state===parsed.state&&request.note===parsed.note)return state(request);throw new WorkPublicationConflictError();}
   const result=await tx.query<Row>(`update app.work_moderation m set state=$2,decision_note=$3,decided_by=$4,decided_at=clock_timestamp()
    where id=$1 and state='pending' returning ${columns}`,[request.id,parsed.state,parsed.note,actor]);
   if(result.rowCount!==1)throw new WorkPublicationConflictError();return state(result.rows[0]);
  });
 }
 readPhoto(token:string,requestId:unknown,fileId:unknown,expectedAdminId:string){return this.admin(token,expectedAdminId,async(tx,actor)=>{
  const {snapshot}=await this.review(tx,requestId,actor),id=parseListingDraftId(fileId);if(!snapshot.form.photoIds.includes(id))throw new WorkPublicationAccessError();
  const record=(await tx.query<MediaFileRecord>(`select id,mime_type as "mimeType",width,height,size,sha256 from app.media_objects
   where id=$1 and state='ready' and owner_id=(select author_id from app.work_publications where id=$2)`,[id,snapshot.id])).rows[0];
  if(!record)throw new WorkPublicationAccessError();if(!this.files)throw Error('Private image reader unavailable');return{record,bytes:await this.files.read(record)};
 });}
 list(token:string,after:unknown,expectedAdminId:string){
  const cursor=parseListingDraftCursor(after);
  return this.admin(token,expectedAdminId,async(tx,actor)=>{
   const rows=(await tx.query<{id:string;publicationId:string;kind:WorkPublicationKind;revision:string;title:string;updatedAt:string}>(`select m.id,m.publication_id as "publicationId",w.kind,m.revision::text as revision,w.title,
    to_char(m.submitted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "updatedAt"
    from app.work_moderation m join app.work_publications w on w.id=m.publication_id and w.revision=m.revision
    join app.users u on u.id=w.author_id and not u.is_blocked and u.email_verified_at is not null
    where m.state='pending' and w.deleted_at is null and w.author_id<>$1 ${cursor?'and (m.submitted_at,m.id)>($2::timestamptz,$3::uuid)':''}
    order by m.submitted_at,m.id limit 21`,cursor?[actor,cursor.updatedAt,cursor.id]:[actor])).rows;
   const items=rows.slice(0,20),last=items.at(-1);return{items,nextCursor:rows.length>20&&last?{id:last.id,updatedAt:last.updatedAt}:null};
  });
 }
}
