import {withAppSessionTransaction} from './app-session-transaction';import {AdminAccessError} from './admin-authorization';
import {PostgresServicePublicationStore,ServicePublicationAccessError,ServicePublicationConflictError} from './postgres-service-publications';
import {parseListingDraftId,parseListingDraftRevision,parseListingDraftCursor} from './listing-draft-contract.ts';
import {parseWorkReviewDecision,WorkModerationInputError} from './work-moderation-contract';
import type {ServicePublicationKind} from './service-publication-contract';import type {PostgresDatabase,PostgresQueries} from './postgres';import type {MediaFileRecord} from './media-files';
type Row={id:string;publicationId:string;kind:ServicePublicationKind;revision:string;state:'pending'|'approved'|'rejected';note:string|null};
export type ServiceModerationState={id:string|null;revision:string|null;state:Row['state']|'not_submitted'|'outdated';note:string|null};
const columns='m.id,m.publication_id as "publicationId",m.revision::text as revision,m.state,m.decision_note as note';
const state=({id,revision,state,note}:Row):ServiceModerationState=>({id,revision,state,note});
/** Current-revision service moderation; cannot publish, pay, alter dates or confer identity authority. */
export class PostgresServiceModerationStore{
 private readonly forms:PostgresServicePublicationStore;
 constructor(private readonly db:Pick<PostgresDatabase,'transaction'>,private readonly files?:{read(record:MediaFileRecord):Promise<Buffer>}){this.forms=new PostgresServicePublicationStore(db);}
 private owner<T>(token:string,owner:string,work:(tx:PostgresQueries)=>Promise<T>){return withAppSessionTransaction(this.db,token,(tx,user)=>{
  if(user.id!==owner)throw new ServicePublicationAccessError();return work(tx);
 });}
 private admin<T>(token:string,actor:string,work:(tx:PostgresQueries)=>Promise<T>){return withAppSessionTransaction(this.db,token,(tx,user)=>{
  if(user.id!==actor)throw new AdminAccessError();return work(tx);
 },{requireAdmin:true,denied:()=>new AdminAccessError()});}
 submit(token:string,owner:string,kind:ServicePublicationKind,id:unknown,revision:unknown){return this.owner(token,owner,async tx=>{
  const {snapshot,issues}=await this.forms.inspectInTransaction(tx,owner,kind,id,revision);if(issues.length)throw new WorkModerationInputError();
  await tx.query('insert into app.service_moderation(publication_id,revision) values($1,$2::bigint) on conflict(publication_id,revision) do nothing',[snapshot.id,snapshot.revision]);
  return state((await tx.query<Row>(`select ${columns} from app.service_moderation m where publication_id=$1 and revision=$2::bigint`,[snapshot.id,snapshot.revision])).rows[0]);
 });}
 read(token:string,owner:string,kind:ServicePublicationKind,publicationId:unknown,expectedRevision:unknown){return this.owner(token,owner,async tx=>{
  const id=parseListingDraftId(publicationId),revision=parseListingDraftRevision(expectedRevision);
  const row=(await tx.query<{revision:string}>('select revision::text as revision from app.service_publications where id=$1 and author_id=$2 and kind=$3 and deleted_at is null for update',[id,owner,kind])).rows[0];
  if(!row)throw new ServicePublicationAccessError();if(row.revision!==revision)throw new ServicePublicationConflictError();
  const review=(await tx.query<Row>(`select ${columns} from app.service_moderation m where publication_id=$1 order by revision desc limit 1`,[id])).rows[0];
  return review?{...state(review),state:review.revision===revision?review.state:'outdated' as const}:{id:null,revision:null,state:'not_submitted' as const,note:null};
 });}
 private async review(tx:PostgresQueries,kind:ServicePublicationKind,requestId:unknown,actor:string){
  const id=parseListingDraftId(requestId),row=(await tx.query<Row&{owner:string}>(`select ${columns},s.kind,s.author_id as owner from app.service_moderation m
   join app.service_publications s on s.id=m.publication_id join app.users u on u.id=s.author_id
   where m.id=$1 and s.kind=$2 and s.deleted_at is null and not u.is_blocked and u.email_verified_at is not null`,[id,kind])).rows[0];
  if(!row)throw new ServicePublicationAccessError();if(row.owner===actor)throw new AdminAccessError();
  const inspected=await this.forms.inspectInTransaction(tx,row.owner,kind,row.publicationId,row.revision);
  const request=(await tx.query<Row>(`select ${columns} from app.service_moderation m where id=$1 for update`,[id])).rows[0];return{request,...inspected};
 }
 inspect(token:string,kind:ServicePublicationKind,id:unknown,actor:string){return this.admin(token,actor,async tx=>{
  const {request,...inspected}=await this.review(tx,kind,id,actor);return{request:state(request),...inspected};
 });}
 decide(token:string,kind:ServicePublicationKind,id:unknown,decision:unknown,note:unknown,actor:string){
  const parsed=parseWorkReviewDecision(decision,note);return this.admin(token,actor,async tx=>{
   const {request,issues}=await this.review(tx,kind,id,actor);if(parsed.state==='approved'&&issues.length)throw new WorkModerationInputError();
   if(request.state!=='pending'){if(request.state===parsed.state&&request.note===parsed.note)return state(request);throw new ServicePublicationConflictError();}
   const result=await tx.query<Row>(`update app.service_moderation m set state=$2,decision_note=$3,decided_by=$4,decided_at=clock_timestamp()
    where id=$1 and state='pending' returning ${columns}`,[request.id,parsed.state,parsed.note,actor]);
   if(result.rowCount!==1)throw new ServicePublicationConflictError();return state(result.rows[0]);
  });
 }
 readPhoto(token:string,kind:ServicePublicationKind,requestId:unknown,fileId:unknown,actor:string){return this.admin(token,actor,async tx=>{
  const {snapshot}=await this.review(tx,kind,requestId,actor),id=parseListingDraftId(fileId);
  if(snapshot.form.kind==='marquee'||!snapshot.form.photoIds.includes(id))throw new ServicePublicationAccessError();
  const record=(await tx.query<MediaFileRecord>(`select id,mime_type as "mimeType",width,height,size,sha256 from app.media_objects
   where id=$1 and state='ready' and owner_id=(select author_id from app.service_publications where id=$2)`,[id,snapshot.id])).rows[0];
  if(!record)throw new ServicePublicationAccessError();if(!this.files)throw Error('Private image reader unavailable');return{record,bytes:await this.files.read(record)};
 });}
 list(token:string,kind:ServicePublicationKind,after:unknown,actor:string){const cursor=parseListingDraftCursor(after);return this.admin(token,actor,async tx=>{
  const rows=(await tx.query<{id:string;publicationId:string;kind:ServicePublicationKind;revision:string;title:string;updatedAt:string}>(`select m.id,m.publication_id as "publicationId",s.kind,m.revision::text as revision,s.title,
   to_char(m.submitted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "updatedAt"
   from app.service_moderation m join app.service_publications s on s.id=m.publication_id and s.revision=m.revision
   join app.users u on u.id=s.author_id and not u.is_blocked and u.email_verified_at is not null
   where m.state='pending' and s.kind=$2 and s.deleted_at is null and s.author_id<>$1 ${cursor?'and (m.submitted_at,m.id)>($3::timestamptz,$4::uuid)':''}
   order by m.submitted_at,m.id limit 21`,cursor?[actor,kind,cursor.updatedAt,cursor.id]:[actor,kind])).rows;
  const items=rows.slice(0,20),last=items.at(-1);return{items,nextCursor:rows.length>20&&last?{id:last.id,updatedAt:last.updatedAt}:null};
 });}
}
