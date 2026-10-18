import {withAppSessionTransaction,AppSessionAccessError} from './app-session-transaction';
import {parseApplicationCreate,parseApplicationEdit,parseApplicationKind,ApplicationInputError,type ApplicationKind} from './application-contract.ts';
import {parseListingDraftId,parseListingDraftRevision,parseListingDraftCursor,type ListingDraftCursor} from './listing-draft-contract.ts';
import {parseServicePublicationForm} from './service-publication-contract.ts';
import {PostgresPublicWorkStore} from './postgres-public-work';import {PostgresPublicServiceStore} from './postgres-public-service';
import {enqueueNotificationInTransaction} from './postgres-notification-inbox';import type {PostgresDatabase,PostgresQueries} from './postgres';
export class ApplicationAccessError extends Error{constructor(){super('Application unavailable');this.name='ApplicationAccessError';}}
export class ApplicationConflictError extends Error{constructor(){super('Application changed');this.name='ApplicationConflictError';}}
export class ApplicationEligibilityError extends Error{constructor(){super('Active specialist required');this.name='ApplicationEligibilityError';}}
export class ApplicationBusyError extends Error{constructor(){super('Application participant is busy');this.name='ApplicationBusyError';}}
type Status='pending_payment'|'paid'|'sent'|'viewed'|'selected'|'rejected';
export type ApplicationProfileSnapshot={name:string;profession:string;price:string;skills:string;phone:string|null;email:string|null;messengerUrl:string|null};
type Target={id:string;kind:ApplicationKind;title:string;revision:string};
export type ApplicationSnapshot={id:string;revision:string;view:'applicant'|'recipient';target:Omit<Target,'revision'>;specialistId:string|null;
 snapshot:ApplicationProfileSnapshot;message:string;status:Status;paid:boolean;sentAt:string|null;createdAt:string;updatedAt:string};
export type ApplicationSummary=Pick<ApplicationSnapshot,'id'|'revision'|'view'|'status'|'paid'|'createdAt'>&{targetId:string;kind:ApplicationKind;targetTitle:string;specialistName:string};
export type ApplicationPage={items:ApplicationSummary[];nextCursor:ListingDraftCursor|null};
type Row={id:string;applicant:string;targetOwner:string;targetId:string;kind:ApplicationKind;targetTitle:string;creationKey:string;targetRevision:string;specialistId:string|null;specialistRevision:string;
 revision:string;snapshot:ApplicationProfileSnapshot;message:string;status:Status;paid:boolean;sentAt:string|null;createdAt:string;updatedAt:string};
const delivered="a.is_paid and a.sent_at is not null and a.status in ('sent','viewed','selected','rejected')";
const membership=`(a.applicant_id=$2 or (w.author_id=$2 and ${delivered}))`;
const stamp=(column:string)=>`to_char(${column} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const source='from app.applications a join app.work_publications w on w.id=a.work_publication_id';
const columns=`a.id,a.applicant_id as applicant,w.author_id as "targetOwner",w.id as "targetId",w.kind,w.title as "targetTitle",a.creation_key as "creationKey",
 a.target_revision::text as "targetRevision",a.specialist_publication_id as "specialistId",a.specialist_revision::text as "specialistRevision",a.revision::text as revision,
 a.snapshot,a.message,a.status,a.is_paid as paid,${stamp('a.sent_at')} as "sentAt",${stamp('a.created_at')} as "createdAt",${stamp('a.updated_at')} as "updatedAt"`;
function display(row:Row,actor:string):ApplicationSnapshot{return{id:row.id,revision:row.revision,view:row.applicant===actor?'applicant':'recipient',target:{id:row.targetId,kind:row.kind,title:row.targetTitle},
 specialistId:row.specialistId,snapshot:row.snapshot,message:row.message,status:row.status,paid:row.paid,sentAt:row.sentAt,createdAt:row.createdAt,updatedAt:row.updatedAt};}

/** No financial authority. Peer locks are nonblocking so existing actor-user locks cannot form a cross-user cycle. */
export class PostgresApplicationStore{
 constructor(private readonly db:Pick<PostgresDatabase,'transaction'>){}
 private owner<T>(token:string,owner:string,work:(tx:PostgresQueries,actor:string)=>Promise<T>){
  const expected=parseListingDraftId(owner);return withAppSessionTransaction(this.db,token,(tx,user)=>{if(user.id!==expected)throw new AppSessionAccessError();return work(tx,user.id);});
 }
 private async peer(tx:PostgresQueries,id:string,live=false){
  try{const row=await tx.query(`select id from app.users where id=$1 ${live?'and not is_blocked and email_verified_at is not null':''} for share nowait`,[id]);if(row.rowCount!==1)throw new ApplicationAccessError();}
  catch(error){if(error&&typeof error==='object'&&'code'in error&&error.code==='55P03')throw new ApplicationBusyError();throw error;}
 }
 private async window(tx:PostgresQueries,target:string,specialist:string){
  const result=await tx.query(`select w.id from app.work_publications w join app.service_publications s on s.id=$2
   where w.id=$1 and w.status='published' and w.is_paid and w.deleted_at is null and w.published_at<=clock_timestamp() and w.expires_at>clock_timestamp()
   and s.status='published' and s.is_paid and s.deleted_at is null and s.published_at<=clock_timestamp() and s.expires_at>clock_timestamp()`,[target,specialist]);
  if(result.rowCount!==1)throw new ApplicationAccessError();
 }
 private async current(tx:PostgresQueries,actor:string,kind:ApplicationKind,id:string){
  const initial=(await tx.query<{author:string}>('select author_id as author from app.work_publications where id=$1 and kind=$2',[id,kind])).rows[0];
  if(!initial||initial.author===actor)throw new ApplicationAccessError();await this.peer(tx,initial.author,true);
  const target=(await tx.query<{author:string;revision:string}>('select author_id as author,revision::text as revision from app.work_publications where id=$1 and kind=$2 for update',[id,kind])).rows[0];
  if(!target||target.author!==initial.author)throw new ApplicationAccessError();
  const specialist=(await tx.query<{id:string;revision:string;form:unknown}>("select id,revision::text as revision,form from app.service_publications where author_id=$1 and kind='specialist' and deleted_at is null for update",[actor])).rows[0];
  // Re-read eligibility in separate statements after all potentially waiting resource locks.
  const work=await new PostgresPublicWorkStore(tx).read(kind,id);if(!work)throw new ApplicationAccessError();
  if(!specialist||!await new PostgresPublicServiceStore(tx).read('specialist',specialist.id))throw new ApplicationEligibilityError();
  const form=parseServicePublicationForm('specialist',specialist.form);if(form.kind!=='specialist')throw new ApplicationEligibilityError();
  const snapshot:ApplicationProfileSnapshot={name:form.title,profession:form.professionName!,price:form.price!,skills:form.skills!,phone:form.contactPhone,email:form.email,messengerUrl:form.messengerUrl};
  return{target:{id,kind,title:work.title,revision:target.revision},specialist:{id:specialist.id,revision:specialist.revision,snapshot}};
 }
 private async row(tx:PostgresQueries,actor:string,id:string,lock=true){
  const row=(await tx.query<Row>(`select ${columns} ${source} where a.id=$1 and ${membership} ${lock?'for update of a':''}`,[id,actor])).rows[0];
  if(!row)throw new ApplicationAccessError();return row;
 }
 private async locate(tx:PostgresQueries,actor:string,id:string){
  const initial=await this.row(tx,actor,id,false);
  await tx.query('select id from app.work_publications where id=$1 for update',[initial.targetId]);return this.row(tx,actor,id);
 }
 preview(token:string,owner:string,kindValue:unknown,targetId:unknown){const kind=parseApplicationKind(kindValue),id=parseListingDraftId(targetId);
  return this.owner(token,owner,async(tx,actor)=>{
   const current=await this.current(tx,actor,kind,id),found=(await tx.query<{id:string}>('select id from app.applications where applicant_id=$1 and work_publication_id=$2',[actor,id])).rows[0];
   const existing=found?display(await this.row(tx,actor,found.id),actor):null;await this.window(tx,id,current.specialist.id);return{...current,existing};
  });
 }
 create(token:string,owner:string,value:unknown){const input=parseApplicationCreate(value);return this.owner(token,owner,async(tx,actor)=>{
  const existing=(await tx.query<{id:string}>('select id from app.applications where applicant_id=$1 and creation_key=$2',[actor,input.creationKey])).rows[0];
  if(existing){const row=await this.locate(tx,actor,existing.id);
   if(row.targetId!==input.targetId||row.kind!==input.kind||row.targetRevision!==input.expectedTargetRevision||row.specialistId!==input.specialistId||row.specialistRevision!==input.expectedSpecialistRevision||row.message!==input.message)throw new ApplicationConflictError();
   return display(row,actor);
  }
  const current=await this.current(tx,actor,input.kind,input.targetId);
  if(current.target.revision!==input.expectedTargetRevision||current.specialist.id!==input.specialistId||current.specialist.revision!==input.expectedSpecialistRevision)throw new ApplicationConflictError();
  if((await tx.query('select id from app.applications where applicant_id=$1 and work_publication_id=$2',[actor,input.targetId])).rowCount)throw new ApplicationConflictError();
  const {id}=(await tx.query<{id:string}>(`insert into app.applications(applicant_id,work_publication_id,specialist_publication_id,creation_key,target_revision,specialist_revision,snapshot,message)
   values($1,$2,$3,$4,$5::bigint,$6::bigint,$7::jsonb,$8) returning id`,[actor,input.targetId,input.specialistId,input.creationKey,input.expectedTargetRevision,input.expectedSpecialistRevision,JSON.stringify(current.specialist.snapshot),input.message])).rows[0];
  const saved=display(await this.row(tx,actor,id),actor);await this.window(tx,input.targetId,input.specialistId);return saved;
 });}
 read(token:string,owner:string,value:unknown){const id=parseListingDraftId(value);return this.owner(token,owner,async(tx,actor)=>display(await this.locate(tx,actor,id),actor));}
 readIntent(token:string,owner:string,value:unknown){const key=parseListingDraftId(value);return this.owner(token,owner,async(tx,actor)=>{
  const row=(await tx.query<{id:string}>('select id from app.applications where applicant_id=$1 and creation_key=$2',[actor,key])).rows[0];return row?display(await this.locate(tx,actor,row.id),actor):null;
 });}
 update(token:string,owner:string,value:unknown){const input=parseApplicationEdit(value);return this.owner(token,owner,async(tx,actor)=>{
  const initial=await this.row(tx,actor,input.applicationId,false);if(initial.applicant!==actor)throw new ApplicationAccessError();
  if(!['pending_payment','paid'].includes(initial.status))throw new ApplicationConflictError();
  const current=await this.current(tx,actor,initial.kind,initial.targetId),row=await this.row(tx,actor,input.applicationId);
  if(row.revision!==input.expectedRevision||!['pending_payment','paid'].includes(row.status)||current.target.revision!==input.expectedTargetRevision||current.specialist.id!==input.specialistId||current.specialist.revision!==input.expectedSpecialistRevision)throw new ApplicationConflictError();
  const result=await tx.query(`update app.applications set message=$2,snapshot=$3::jsonb,specialist_publication_id=$4,target_revision=$5::bigint,specialist_revision=$6::bigint,revision=revision+1,updated_at=clock_timestamp()
   where id=$1 and revision=$7::bigint and revision<9223372036854775807`,[row.id,input.message,JSON.stringify(current.specialist.snapshot),input.specialistId,input.expectedTargetRevision,input.expectedSpecialistRevision,input.expectedRevision]);
  if(result.rowCount!==1)throw new ApplicationConflictError();const saved=display(await this.row(tx,actor,row.id),actor);await this.window(tx,row.targetId,input.specialistId);return saved;
 });}
 decide(token:string,owner:string,value:unknown,expected:unknown,state:unknown){
  const id=parseListingDraftId(value),revision=parseListingDraftRevision(expected);if(state!=='viewed'&&state!=='selected'&&state!=='rejected')throw new ApplicationInputError();
  return this.owner(token,owner,async(tx,actor)=>{
   const initial=await this.row(tx,actor,id,false);if(initial.applicant===actor||initial.targetOwner!==actor)throw new ApplicationAccessError();
   await this.peer(tx,initial.applicant);const row=await this.locate(tx,actor,id);
   if(row.status===state&&BigInt(row.revision)===BigInt(revision)+BigInt(1))return display(row,actor);
   if(row.revision!==revision||!['sent','viewed'].includes(row.status))throw new ApplicationConflictError();
   if(row.status===state)return display(row,actor);
   const changed=await tx.query('update app.applications set status=$2,revision=revision+1,updated_at=clock_timestamp() where id=$1 and revision=$3::bigint and revision<9223372036854775807',[id,state,revision]);
   if(changed.rowCount!==1)throw new ApplicationConflictError();
   if(state!=='viewed')await enqueueNotificationInTransaction(tx,row.applicant,{eventKey:`application_decision:${id}:${state}`,category:'message',tone:state==='selected'?'success':'warning',title:state==='selected'?'Ваш отклик выбран':'По отклику получен отказ',body:`По отклику на ${row.kind==='vacancy'?'вакансию':'заказ'} получено решение. Подробности доступны в кабинете.`,actionHref:'/cabinet/otkliki',bookingRequestId:null});
   return display(await this.row(tx,actor,id),actor);
  });
 }
 list(token:string,owner:string,mode:unknown,after:unknown):Promise<ApplicationPage>{
  if(mode!=='applicant'&&mode!=='recipient')throw new ApplicationInputError();const cursor=parseListingDraftCursor(after);
  return this.owner(token,owner,async(tx,actor)=>{
   const rows=(await tx.query<Omit<ApplicationSummary,'view'>>(`select a.id,a.revision::text as revision,w.id as "targetId",w.kind,w.title as "targetTitle",a.snapshot->>'name' as "specialistName",a.status,a.is_paid as paid,${stamp('a.created_at')} as "createdAt"
    ${source} where ${mode==='applicant'?'a.applicant_id=$1':`w.author_id=$1 and a.applicant_id<>$1 and ${delivered}`}
    ${cursor?'and (a.created_at,a.id)<($2::timestamptz,$3::uuid)':''} order by a.created_at desc,a.id desc limit 21`,cursor?[actor,cursor.updatedAt,cursor.id]:[actor])).rows;
   const items=rows.slice(0,20).map<ApplicationSummary>(row=>({...row,view:mode})),last=items.at(-1);return{items,nextCursor:rows.length>20&&last?{id:last.id,updatedAt:last.createdAt}:null};
  });
 }
}
