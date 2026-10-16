import {withAppSessionTransaction} from './app-session-transaction';
import {AdminAccessError} from './admin-authorization';
import {PostgresListingFormStore} from './postgres-listing-form';
import {ListingDraftAccessError,ListingDraftConflictError} from './postgres-listing-drafts';
import {parseListingDraftId,parseListingDraftRevision} from './listing-draft-contract.ts';
import type {PostgresDatabase,PostgresQueries} from './postgres';
import type {MediaFileRecord} from './media-files';
export class ListingModerationInputError extends Error{constructor(){super('Listing moderation input invalid');this.name='ListingModerationInputError';}}
export function parseModerationDecision(state:unknown,note:unknown):{state:'approved'|'rejected';note:string|null}{
 if((state!=='approved'&&state!=='rejected')||(state==='approved'?note!==null:typeof note!=='string'||!note.isWellFormed()||note!==note.trim()||note.length<1||note.length>1000||/[\x00-\x1f\x7f]/.test(note)))throw new ListingModerationInputError();
 return{state,note:note as string|null};
}
type Row={id:string;listingId:string;revision:string;state:'pending'|'approved'|'rejected';note:string|null};
export type ListingModerationState={id:string|null;revision:string|null;state:Row['state']|'not_submitted'|'outdated';note:string|null};
const columns='m.id,m.listing_id as "listingId",m.revision::text as revision,m.state,m.decision_note as note';
const publicState=({id,revision,state,note}:Row):ListingModerationState=>({id,revision,state,note});
/** No listing/billing writes. Approval is meaningful only while its exact listing revision remains current. */
export class PostgresListingModerationStore{
 private readonly forms:PostgresListingFormStore;
 constructor(private readonly db:Pick<PostgresDatabase,'transaction'>,private readonly files?:{read(record:MediaFileRecord):Promise<Buffer>}){this.forms=new PostgresListingFormStore(db);}
 private owner<T>(token:string,owner:string,work:(tx:PostgresQueries)=>Promise<T>){return withAppSessionTransaction(this.db,token,(tx,user)=>{
  if(user.id!==owner)throw new ListingDraftAccessError();return work(tx);
 });}
 private admin<T>(token:string,work:(tx:PostgresQueries,actor:string)=>Promise<T>,expectedAdminId?:string){return withAppSessionTransaction(this.db,token,(tx,user)=>{
  if(expectedAdminId!==undefined&&user.id!==expectedAdminId)throw new AdminAccessError();return work(tx,user.id);
 },{requireAdmin:true,denied:()=>new AdminAccessError()});}
 private async current(tx:PostgresQueries,owner:string,id:unknown,revision:unknown){
  const inspected=await this.forms.inspectInTransaction(tx,owner,id,revision);
  if(inspected.check.issues.some(issue=>issue.field!=='tariff'))throw new ListingModerationInputError();return inspected.snapshot;
 }
 submit(token:string,owner:string,id:unknown,revision:unknown){return this.owner(token,owner,async tx=>{
  const snapshot=await this.current(tx,owner,id,revision);
  await tx.query('insert into app.listing_moderation(listing_id,revision) values($1,$2::bigint) on conflict(listing_id,revision) do nothing',[snapshot.id,snapshot.revision]);
  const row=(await tx.query<Row>(`select ${columns} from app.listing_moderation m where listing_id=$1 and revision=$2::bigint`,[snapshot.id,snapshot.revision])).rows[0];
  return publicState(row);
 });}
 read(token:string,owner:string,listingId:unknown,expectedRevision:unknown){return this.owner(token,owner,async tx=>{
  const id=parseListingDraftId(listingId),revision=parseListingDraftRevision(expectedRevision);
  const row=(await tx.query<{revision:string}>("select revision::text as revision from app.listings where id=$1 and author_id=$2 and status='draft' for update",[id,owner])).rows[0];
  if(!row)throw new ListingDraftAccessError();if(row.revision!==revision)throw new ListingDraftConflictError();
  const request=(await tx.query<Row>(`select ${columns} from app.listing_moderation m where listing_id=$1 order by revision desc limit 1`,[id])).rows[0];
  if(!request)return{id:null,revision:null,state:'not_submitted' as const,note:null};
  return{...publicState(request),state:request.revision===revision?request.state:'outdated' as const};
 });}
 private async review(tx:PostgresQueries,requestId:unknown,actor:string){
  const id=parseListingDraftId(requestId);
  const row=(await tx.query<Row&{owner:string}>(`select ${columns},l.author_id as owner from app.listing_moderation m
   join app.listings l on l.id=m.listing_id join app.users u on u.id=l.author_id
   where m.id=$1 and not u.is_blocked and u.email_verified_at is not null`,[id])).rows[0];
  if(!row)throw new ListingDraftAccessError();if(row.owner===actor)throw new AdminAccessError();
  const {snapshot,check}=await this.forms.inspectInTransaction(tx,row.owner,row.listingId,row.revision);
  const request=(await tx.query<Row>(`select ${columns} from app.listing_moderation m where id=$1 for update`,[id])).rows[0];
  return{request,snapshot,check};
 }
 inspect(token:string,id:unknown,expectedAdminId?:string){return this.admin(token,async(tx,actor)=>{
  const {request,snapshot,check}=await this.review(tx,id,actor);return{request:publicState(request),snapshot,check};
 },expectedAdminId);}
 readPhoto(token:string,requestId:unknown,fileId:unknown,expectedAdminId:string){return this.admin(token,async(tx,actor)=>{
  const {snapshot}=await this.review(tx,requestId,actor),id=parseListingDraftId(fileId);
  if(!snapshot.form.photoIds.includes(id))throw new ListingDraftAccessError();
  const record=(await tx.query<MediaFileRecord>(`select id,mime_type as "mimeType",width,height,size,sha256 from app.media_objects
   where id=$1 and state='ready' and owner_id=(select author_id from app.listings where id=$2)`,[id,snapshot.id])).rows[0];
  if(!record)throw new ListingDraftAccessError();if(!this.files)throw new Error('Private media reader unavailable');
  return{record,bytes:await this.files.read(record)};
 },expectedAdminId);}
 async decide(token:string,id:unknown,state:unknown,note:unknown,expectedAdminId?:string){
  parseModerationDecision(state,note);
  return this.admin(token,async(tx,actor)=>{
   const {request,check}=await this.review(tx,id,actor);
   if(state==='approved'&&check.issues.some(issue=>issue.field!=='tariff'))throw new ListingModerationInputError();
   if(request.state!=='pending'){
    if(request.state===state&&request.note===note)return publicState(request);throw new ListingDraftConflictError();
   }
   const result=await tx.query<Row>(`update app.listing_moderation m set state=$2,decision_note=$3,decided_by=$4,decided_at=clock_timestamp()
    where id=$1 and state='pending' returning ${columns}`,[request.id,state,note,actor]);
   if(result.rowCount!==1)throw new ListingDraftConflictError();return publicState(result.rows[0]);
  },expectedAdminId);
 }
 list(token:string,after:unknown,expectedAdminId?:string){
  const cursor=after===null?null:parseListingDraftId(after);
  return this.admin(token,async(tx,actor)=>{
   const rows=(await tx.query<{id:string;listingId:string;revision:string;title:string}>(`select m.id,m.listing_id as "listingId",m.revision::text as revision,l.title
    from app.listing_moderation m join app.listings l on l.id=m.listing_id and l.revision=m.revision
    join app.users u on u.id=l.author_id and not u.is_blocked and u.email_verified_at is not null
    where m.state='pending' and l.status='draft' and l.author_id<>$1 ${cursor?'and (m.submitted_at,m.id)>(select submitted_at,id from app.listing_moderation where id=$2::uuid)':''}
    order by m.submitted_at,m.id limit 21`,cursor?[actor,cursor]:[actor])).rows;
   return{items:rows.slice(0,20),nextCursor:rows.length>20?rows[19].id:null};
  },expectedAdminId);
 }
}
