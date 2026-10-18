import {withAppSessionTransaction} from './app-session-transaction';
import {parseServicePublicationForm,checkServicePublicationForm,ServicePublicationInputError,type ServicePublicationKind,type ServicePublicationForm} from './service-publication-contract.ts';
import {parseListingDraftId,parseListingDraftRevision,parseListingDraftCursor} from './listing-draft-contract.ts';
import {maxListingMediaTotalSize} from './media-limits.ts';
import type {PostgresDatabase,PostgresQueries} from './postgres';import type {ListingDraftPhoto} from './listing-photo-contract';
export class ServicePublicationAccessError extends Error{constructor(){super('Service publication not found');}}
export class ServicePublicationConflictError extends Error{constructor(){super('Service publication changed');}}
export type ServicePublicationSnapshot={id:string;kind:ServicePublicationKind;form:ServicePublicationForm;photos:ListingDraftPhoto[];revision:string;status:string;paid:boolean;
 createdAt:string;updatedAt:string;publishedAt:string|null;expiresAt:string|null};
type Row=Omit<ServicePublicationSnapshot,'form'|'photos'>&{form:unknown};
const columns=`id,kind,form,revision::text as revision,status,is_paid as paid,
 to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",
 to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "updatedAt",
 to_char(published_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "publishedAt",
 to_char(expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expiresAt"`;
function kindOf(kind:ServicePublicationKind){if(!['specialist','fair','marquee'].includes(kind))throw new ServicePublicationInputError();return kind;}
const photoIds=(form:ServicePublicationForm)=>form.kind==='marquee'?[]:form.photoIds;
/** Private service forms only, sharing the existing session transaction and immutable media boundary. */
export class PostgresServicePublicationStore{
 constructor(private readonly db:Pick<PostgresDatabase,'transaction'>){if(typeof window!=='undefined')throw Error('Service storage is server-only');}
 private async snapshot(tx:PostgresQueries,owner:string,kind:ServicePublicationKind,id:string):Promise<ServicePublicationSnapshot>{
  const row=(await tx.query<Row>(`select ${columns} from app.service_publications where id=$1 and author_id=$2 and kind=$3 and deleted_at is null`,[id,owner,kind])).rows[0];
  if(!row)throw new ServicePublicationAccessError();const form=parseServicePublicationForm(kind,row.form);
  const photos=(await tx.query<ListingDraftPhoto&{permitted:boolean}>(`select m.id,m.mime_type as "mimeType",m.width,m.height,m.size,(m.owner_id=$2 and m.state='ready') as permitted
   from app.service_publication_photos p join app.media_objects m on m.id=p.media_id where p.publication_id=$1 order by p.position limit 13`,[id,owner])).rows;
  if(photos.some(item=>!item.permitted)||photos.reduce((sum,item)=>sum+item.size,0)>maxListingMediaTotalSize||JSON.stringify(photoIds(form))!==JSON.stringify(photos.map(item=>item.id)))throw new ServicePublicationAccessError();
  return{...row,form,photos:photos.map(({id,mimeType,width,height,size})=>({id,mimeType,width,height,size}))};
 }
 private async references(tx:PostgresQueries,form:ServicePublicationForm){
  const lookup=async(value:string|null,sql:string)=>{if(!value)return null;const rows=(await tx.query<{id:string}>(sql,[value])).rows;
   if(rows.length!==1)throw new ServicePublicationInputError();return rows[0].id;};
  return{city:form.kind==='marquee'?null:await lookup(form.cityName,'select id from app.cities where name=$1 limit 2'),
   profession:form.kind!=='specialist'?null:await lookup(form.professionName,'select id from app.specialist_categories where name=$1 limit 2')};
 }
 private async checkPhotos(tx:PostgresQueries,owner:string,ids:string[]){
  const rows=ids.length?(await tx.query<{size:number}>("select size from app.media_objects where owner_id=$1 and state='ready' and id=any($2::uuid[])",[owner,ids])).rows:[];
  if(rows.length!==ids.length)throw new ServicePublicationAccessError();if(rows.reduce((sum,item)=>sum+item.size,0)>maxListingMediaTotalSize)throw new ServicePublicationInputError();
 }
 private async photos(tx:PostgresQueries,id:string,ids:string[]){
  await tx.query('delete from app.service_publication_photos where publication_id=$1',[id]);
  if(ids.length)await tx.query(`insert into app.service_publication_photos(publication_id,media_id,position)
   select $1,item.id,(item.position-1)::integer from unnest($2::uuid[]) with ordinality as item(id,position)`,[id,ids]);
 }
 private async write<T>(work:()=>Promise<T>):Promise<T>{try{return await work();}catch(error){
  if(error&&typeof error==='object'&&'code'in error&&['23503','23514'].includes(String(error.code)))throw new ServicePublicationInputError();throw error;}}
 /** Trusted composition only; the caller authorizes the same transaction's owner or current administrator. */
 async inspectInTransaction(tx:PostgresQueries,owner:string,kind:ServicePublicationKind,publicationId:unknown,expectedRevision:unknown){
  kindOf(kind);const id=parseListingDraftId(publicationId),revision=parseListingDraftRevision(expectedRevision);
  const row=(await tx.query<{revision:string;referencesActive:boolean}>(`select s.revision::text as revision,
   (s.kind='marquee' or (c.id is not null and (s.kind<>'specialist' or p.active is true))) as "referencesActive"
   from app.service_publications s left join app.cities c on c.id=s.city_id left join app.specialist_categories p on p.id=s.profession_id
   where s.id=$1 and s.author_id=$2 and s.kind=$3 and s.deleted_at is null for update of s`,[id,owner,kind])).rows[0];
  if(!row)throw new ServicePublicationAccessError();if(row.revision!==revision)throw new ServicePublicationConflictError();
  const snapshot=await this.snapshot(tx,owner,kind,id),issues=checkServicePublicationForm(snapshot.form);
  if(!row.referencesActive)issues.push('Выберите действующие город и профессию.');return{snapshot,issues};
 }
 create(token:string,owner:string,kind:ServicePublicationKind,creationKey:unknown,input:unknown){return this.write(()=>withAppSessionTransaction(this.db,token,async(tx,user)=>{
  if(user.id!==owner)throw new ServicePublicationAccessError();kindOf(kind);const key=parseListingDraftId(creationKey),form=parseServicePublicationForm(kind,input),refs=await this.references(tx,form),ids=photoIds(form);
  await this.checkPhotos(tx,owner,ids);
  const inserted=(await tx.query<{id:string}>(`insert into app.service_publications(author_id,kind,creation_key,form,city_id,profession_id)
   values($1,$2,$3,$4::jsonb,$5,$6) on conflict do nothing returning id`,[owner,kind,key,JSON.stringify(form),refs.city,refs.profession])).rows[0];
  // Specialist has one durable profile per account, not another profile for each button press.
  const existing=inserted??(await tx.query<{id:string}>("select id from app.service_publications where author_id=$1 and kind=$2 and (creation_key=$3 or kind='specialist') and deleted_at is null",[owner,kind,key])).rows[0];
  if(!existing)throw new ServicePublicationAccessError();if(inserted)await this.photos(tx,inserted.id,ids);return this.snapshot(tx,owner,kind,existing.id);
 }));}
 read(token:string,owner:string,kind:ServicePublicationKind,publicationId:unknown){return withAppSessionTransaction(this.db,token,async(tx,user)=>{
  if(user.id!==owner)throw new ServicePublicationAccessError();return this.snapshot(tx,owner,kindOf(kind),parseListingDraftId(publicationId));
 });}
 readIntent(token:string,owner:string,kind:ServicePublicationKind,creationKey:unknown){return withAppSessionTransaction(this.db,token,async(tx,user)=>{
  if(user.id!==owner)throw new ServicePublicationAccessError();kindOf(kind);
  const row=(await tx.query<{id:string}>("select id from app.service_publications where author_id=$1 and kind=$2 and (creation_key=$3 or kind='specialist') and deleted_at is null",[owner,kind,parseListingDraftId(creationKey)])).rows[0];
  return row?this.snapshot(tx,owner,kind,row.id):null;
 });}
 list(token:string,owner:string,kind:ServicePublicationKind,after:unknown){return withAppSessionTransaction(this.db,token,async(tx,user)=>{
  if(user.id!==owner)throw new ServicePublicationAccessError();kindOf(kind);const cursor=parseListingDraftCursor(after);
  const rows=(await tx.query<{id:string;kind:ServicePublicationKind;title:string;revision:string;status:string;paid:boolean;updatedAt:string}>(`select id,kind,title,revision::text as revision,status,is_paid as paid,
   to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "updatedAt" from app.service_publications
   where author_id=$1 and kind=$2 and deleted_at is null ${cursor?'and (updated_at,id)<($3::timestamptz,$4::uuid)':''}
   order by updated_at desc,id desc limit 21`,cursor?[owner,kind,cursor.updatedAt,cursor.id]:[owner,kind])).rows;
  const items=rows.slice(0,20),last=items.at(-1);return{items,nextCursor:rows.length>20&&last?{id:last.id,updatedAt:last.updatedAt}:null};
 });}
 update(token:string,owner:string,kind:ServicePublicationKind,publicationId:unknown,expectedRevision:unknown,input:unknown){return this.write(()=>withAppSessionTransaction(this.db,token,async(tx,user)=>{
  if(user.id!==owner)throw new ServicePublicationAccessError();kindOf(kind);const id=parseListingDraftId(publicationId),revision=parseListingDraftRevision(expectedRevision),form=parseServicePublicationForm(kind,input);
  const row=(await tx.query<{revision:string}>('select revision::text as revision from app.service_publications where id=$1 and author_id=$2 and kind=$3 and deleted_at is null for update',[id,owner,kind])).rows[0];
  if(!row)throw new ServicePublicationAccessError();if(row.revision!==revision||revision==='9223372036854775807')throw new ServicePublicationConflictError();
  const refs=await this.references(tx,form),ids=photoIds(form);await this.checkPhotos(tx,owner,ids);
  const result=await tx.query(`update app.service_publications set form=$4::jsonb,city_id=$5,profession_id=$6,revision=revision+1,updated_at=clock_timestamp()
   where id=$1 and author_id=$2 and kind=$3 and revision=$7::bigint and deleted_at is null`,[id,owner,kind,JSON.stringify(form),refs.city,refs.profession,revision]);
  if(result.rowCount!==1)throw new ServicePublicationConflictError();await this.photos(tx,id,ids);return this.snapshot(tx,owner,kind,id);
 }));}
}
