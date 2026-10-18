import {withAppSessionTransaction} from './app-session-transaction';
import {parseWorkPublicationForm,checkWorkPublicationForm,WorkPublicationInputError,type WorkPublicationKind,type WorkPublicationForm} from './work-publication-contract.ts';
import {parseListingDraftId,parseListingDraftRevision,parseListingDraftCursor} from './listing-draft-contract.ts';
import {maxListingMediaTotalSize} from './media-limits.ts';
import type {PostgresDatabase,PostgresQueries} from './postgres';
import type {ListingDraftPhoto} from './listing-photo-contract';

export class WorkPublicationAccessError extends Error{constructor(){super('Work publication not found');}}
export class WorkPublicationConflictError extends Error{constructor(){super('Work publication changed');}}
export type WorkPublicationSnapshot={id:string;kind:WorkPublicationKind;revision:string;status:string;paid:boolean;form:WorkPublicationForm;
 photos:ListingDraftPhoto[];createdAt:string;updatedAt:string;publishedAt:string|null;expiresAt:string|null};
type Row=Omit<WorkPublicationSnapshot,'photos'|'form'>&{form:unknown};
const columns=`id,kind,revision::text as revision,status,is_paid as paid,form,
 to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",
 to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "updatedAt",
 to_char(published_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "publishedAt",
 to_char(expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expiresAt"`;
const validKind=(kind:WorkPublicationKind)=>{if(kind!=='vacancy'&&kind!=='workRequest')throw new WorkPublicationInputError();return kind;};

/** Cookie-owned forms only. No status, ownership, payment, date or automatic retry writes. */
export class PostgresWorkPublicationStore{
 constructor(private readonly db:Pick<PostgresDatabase,'transaction'>){if(typeof window!=='undefined')throw Error('Work publication storage is server-only');}
 private async snapshot(tx:PostgresQueries,owner:string,kind:WorkPublicationKind,id:string):Promise<WorkPublicationSnapshot>{
  const row=(await tx.query<Row>(`select ${columns} from app.work_publications where id=$1 and author_id=$2 and kind=$3 and deleted_at is null`,[id,owner,kind])).rows[0];
  if(!row)throw new WorkPublicationAccessError();
  const form=parseWorkPublicationForm(kind,row.form);
  const photos=(await tx.query<ListingDraftPhoto&{permitted:boolean}>(`select m.id,m.mime_type as "mimeType",m.width,m.height,m.size,
   (m.owner_id=$2 and m.state='ready') as permitted from app.work_publication_photos p join app.media_objects m on m.id=p.media_id
   where p.publication_id=$1 order by p.position limit 21`,[id,owner])).rows;
  if(photos.some(item=>!item.permitted)||photos.reduce((sum,item)=>sum+item.size,0)>maxListingMediaTotalSize||JSON.stringify(form.photoIds)!==JSON.stringify(photos.map(item=>item.id)))throw new WorkPublicationAccessError();
  return{...row,form,photos:photos.map(({id,mimeType,width,height,size})=>({id,mimeType,width,height,size}))};
 }
 private async references(tx:PostgresQueries,form:WorkPublicationForm){
  const reference=async(name:string|null,sql:string)=>{if(!name)return null;const rows=(await tx.query<{id:string}>(sql,[name])).rows;
   if(rows.length!==1)throw new WorkPublicationInputError();return rows[0].id;};
  const city=await reference(form.cityName,'select id from app.cities where name=$1 limit 2');
  const profession=await reference(form.professionName,'select id from app.specialist_categories where name=$1 limit 2');
  return{city,profession};
 }
 private async checkPhotos(tx:PostgresQueries,owner:string,ids:string[]){
  const available=ids.length?(await tx.query<{size:number}>("select size from app.media_objects where owner_id=$1 and state='ready' and id=any($2::uuid[])",[owner,ids])).rows:[];
  if(available.length!==ids.length)throw new WorkPublicationAccessError();
  if(available.reduce((sum,item)=>sum+item.size,0)>maxListingMediaTotalSize)throw new WorkPublicationInputError();
 }
 private async photos(tx:PostgresQueries,id:string,ids:string[]){
  await tx.query('delete from app.work_publication_photos where publication_id=$1',[id]);
  if(ids.length)await tx.query(`insert into app.work_publication_photos(publication_id,media_id,position)
   select $1,item.id,(item.position-1)::integer from unnest($2::uuid[]) with ordinality as item(id,position)`,[id,ids]);
 }
 private async write<T>(work:()=>Promise<T>):Promise<T>{
  try{return await work();}catch(error){if(error&&typeof error==='object'&&'code'in error&&['23503','23514'].includes(String(error.code)))throw new WorkPublicationInputError();throw error;}
 }
 /** Trusted server composition only: caller must authorize the owner/admin in this same transaction. */
 async inspectInTransaction(tx:PostgresQueries,owner:string,kind:WorkPublicationKind,publicationId:unknown,expectedRevision:unknown){
  const id=parseListingDraftId(publicationId),revision=parseListingDraftRevision(expectedRevision);validKind(kind);
  const row=(await tx.query<{revision:string;referencesActive:boolean}>(`select w.revision::text as revision,
   (c.id is not null and p.active is true) as "referencesActive" from app.work_publications w
   left join app.cities c on c.id=w.city_id left join app.specialist_categories p on p.id=w.profession_id
   where w.id=$1 and w.author_id=$2 and w.kind=$3 and w.deleted_at is null for update of w`,[id,owner,kind])).rows[0];
  if(!row)throw new WorkPublicationAccessError();if(row.revision!==revision)throw new WorkPublicationConflictError();
  const snapshot=await this.snapshot(tx,owner,kind,id),issues=checkWorkPublicationForm(snapshot.form);
  if(!row.referencesActive)issues.push('Выберите действующие город и профессию.');return{snapshot,issues};
 }
 create(token:string,owner:string,kind:WorkPublicationKind,creationKey:unknown,input:unknown){
  return this.write(()=>withAppSessionTransaction(this.db,token,async(tx,user)=>{
   if(user.id!==owner)throw new WorkPublicationAccessError();validKind(kind);
   const key=parseListingDraftId(creationKey),form=parseWorkPublicationForm(kind,input),refs=await this.references(tx,form);
   await this.checkPhotos(tx,owner,form.photoIds);
   const inserted=(await tx.query<{id:string}>(`insert into app.work_publications(author_id,kind,creation_key,form,city_id,profession_id)
    values($1,$2,$3,$4::jsonb,$5,$6) on conflict(author_id,kind,creation_key) do nothing returning id`,[owner,kind,key,JSON.stringify(form),refs.city,refs.profession])).rows[0];
   const existing=inserted??(await tx.query<{id:string}>('select id from app.work_publications where author_id=$1 and kind=$2 and creation_key=$3 and deleted_at is null',[owner,kind,key])).rows[0];
   if(!existing)throw new WorkPublicationAccessError();
   if(inserted)await this.photos(tx,inserted.id,form.photoIds);
   return this.snapshot(tx,owner,kind,existing.id);
  }));
 }
 read(token:string,owner:string,kind:WorkPublicationKind,publicationId:unknown){return withAppSessionTransaction(this.db,token,async(tx,user)=>{
  if(user.id!==owner)throw new WorkPublicationAccessError();return this.snapshot(tx,owner,validKind(kind),parseListingDraftId(publicationId));
 });}
 readIntent(token:string,owner:string,kind:WorkPublicationKind,creationKey:unknown){return withAppSessionTransaction(this.db,token,async(tx,user)=>{
  if(user.id!==owner)throw new WorkPublicationAccessError();validKind(kind);
  const row=(await tx.query<{id:string}>('select id from app.work_publications where author_id=$1 and kind=$2 and creation_key=$3 and deleted_at is null',[owner,kind,parseListingDraftId(creationKey)])).rows[0];
  return row?this.snapshot(tx,owner,kind,row.id):null;
 });}
 list(token:string,owner:string,kind:WorkPublicationKind,after:unknown){return withAppSessionTransaction(this.db,token,async(tx,user)=>{
  if(user.id!==owner)throw new WorkPublicationAccessError();validKind(kind);const cursor=parseListingDraftCursor(after);
  const rows=(await tx.query<{id:string;kind:WorkPublicationKind;title:string;revision:string;status:string;paid:boolean;updatedAt:string}>(`select id,kind,title,revision::text as revision,status,is_paid as paid,
   to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "updatedAt" from app.work_publications
   where author_id=$1 and kind=$2 and deleted_at is null ${cursor?'and (updated_at,id)<($3::timestamptz,$4::uuid)':''}
   order by updated_at desc,id desc limit 21`,cursor?[owner,kind,cursor.updatedAt,cursor.id]:[owner,kind])).rows;
  const items=rows.slice(0,20),last=items.at(-1);return{items,nextCursor:rows.length>20&&last?{id:last.id,updatedAt:last.updatedAt}:null};
 });}
 update(token:string,owner:string,kind:WorkPublicationKind,publicationId:unknown,expectedRevision:unknown,input:unknown){
  return this.write(()=>withAppSessionTransaction(this.db,token,async(tx,user)=>{
   if(user.id!==owner)throw new WorkPublicationAccessError();validKind(kind);
   const id=parseListingDraftId(publicationId),revision=parseListingDraftRevision(expectedRevision),form=parseWorkPublicationForm(kind,input);
   const row=(await tx.query<{revision:string}>('select revision::text as revision from app.work_publications where id=$1 and author_id=$2 and kind=$3 and deleted_at is null for update',[id,owner,kind])).rows[0];
   if(!row)throw new WorkPublicationAccessError();if(row.revision!==revision||revision==='9223372036854775807')throw new WorkPublicationConflictError();
   const refs=await this.references(tx,form);await this.checkPhotos(tx,owner,form.photoIds);
   const result=await tx.query(`update app.work_publications set form=$4::jsonb,city_id=$5,profession_id=$6,revision=revision+1,updated_at=clock_timestamp()
    where id=$1 and author_id=$2 and kind=$3 and revision=$7::bigint and deleted_at is null`,[id,owner,kind,JSON.stringify(form),refs.city,refs.profession,revision]);
   if(result.rowCount!==1)throw new WorkPublicationConflictError();await this.photos(tx,id,form.photoIds);return this.snapshot(tx,owner,kind,id);
  }));
 }
}
