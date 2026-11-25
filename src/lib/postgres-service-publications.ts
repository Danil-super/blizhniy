import {withAppSessionTransaction} from './app-session-transaction';
import {parseServicePublicationForm,checkServicePublicationForm,ServicePublicationInputError,type ServicePublicationKind,type ServicePublicationForm,type servicePublicationStatuses} from './service-publication-contract.ts';
import {parseListingDraftId,parseListingDraftRevision,parseListingDraftCursor} from './listing-draft-contract.ts';
import {maxListingMediaTotalSize} from './media-limits.ts';
import type {PostgresDatabase,PostgresQueries} from './postgres';import type {ListingDraftPhoto} from './listing-photo-contract';
import {validProfileName} from './cabinet-field-validation.ts';
import {specialistAbout,checkSpecialistApplicationForm} from './specialist-application-profile.ts';
import {specialistTestShop} from './specialist-checkout-config';
import {effectivePublicationStatusSql} from './publication-effective-status';
import {resolveProfession,professionFormSql,ProfessionReferenceError} from './profession-reference';
export class ServicePublicationAccessError extends Error{constructor(){super('Service publication not found');}}
export class ServicePublicationConflictError extends Error{constructor(){super('Service publication changed');}}
export class ServicePublicationCheckoutActiveError extends Error{constructor(){super('Service publication checkout active');this.name='ServicePublicationCheckoutActiveError';}}
export class ServicePublicationProfileNameError extends ServicePublicationInputError{
 constructor(){super();this.name='ServicePublicationProfileNameError';}
}
export type ServicePublicationSnapshot={id:string;kind:ServicePublicationKind;form:ServicePublicationForm;photos:ListingDraftPhoto[];revision:string;status:typeof servicePublicationStatuses[number];paid:boolean;professionId?:string|null;canRepeat?:true;
 createdAt:string;updatedAt:string;publishedAt:string|null;expiresAt:string|null};
type Row=Omit<ServicePublicationSnapshot,'form'|'photos'>&{form:unknown};
const columns=`id,kind,${professionFormSql()} as form,profession_id as "professionId",revision::text as revision,${effectivePublicationStatusSql()} as status,is_paid as paid,
 to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",
 to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "updatedAt",
 to_char(published_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "publishedAt",
 to_char(expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expiresAt"`;
function kindOf(kind:ServicePublicationKind){if(!['specialist','fair','marquee'].includes(kind))throw new ServicePublicationInputError();return kind;}
const photoIds=(form:ServicePublicationForm)=>form.kind==='marquee'?[]:form.photoIds;
/** Private service forms only, sharing the existing session transaction and immutable media boundary. */
export class PostgresServicePublicationStore{
 constructor(private readonly db:Pick<PostgresDatabase,'transaction'>,private readonly options:{specialistProfileIdentity?:boolean}={}){if(typeof window!=='undefined')throw Error('Service storage is server-only');}
 private async profileBoundForm(tx:PostgresQueries,owner:string,form:ServicePublicationForm):Promise<ServicePublicationForm>{
  if(form.kind!=='specialist'||!this.options.specialistProfileIdentity)return form;
  const profile=(await tx.query<{name:string}>("select profile->>'name' as name from app.cabinet_profiles where user_id=$1",[owner])).rows[0];
  if(!validProfileName(profile?.name))throw new ServicePublicationProfileNameError();
  return parseServicePublicationForm('specialist',{...form,title:profile.name,description:specialistAbout(form),skills:null,experience:null,district:null,videoUrl:null,photoIds:[]});
 }
 private async snapshot(tx:PostgresQueries,owner:string,kind:ServicePublicationKind,id:string,includeRepeat=false):Promise<ServicePublicationSnapshot>{
  const row=(await tx.query<Row>(`select ${columns} from app.service_publications where id=$1 and author_id=$2 and kind=$3 and deleted_at is null`,[id,owner,kind])).rows[0];
  if(!row)throw new ServicePublicationAccessError();const form=parseServicePublicationForm(kind,row.form);
  if(form.kind==='specialist'&&form.professionId&&form.professionId!==row.professionId)throw new ServicePublicationAccessError();
  const photos=(await tx.query<ListingDraftPhoto&{permitted:boolean}>(`select m.id,m.mime_type as "mimeType",m.width,m.height,m.size,(m.owner_id=$2 and m.state='ready') as permitted
   from app.service_publication_photos p join app.media_objects m on m.id=p.media_id where p.publication_id=$1 order by p.position limit 13`,[id,owner])).rows;
  if(photos.some(item=>!item.permitted)||photos.reduce((sum,item)=>sum+item.size,0)>maxListingMediaTotalSize||JSON.stringify(photoIds(form))!==JSON.stringify(photos.map(item=>item.id)))throw new ServicePublicationAccessError();
  const shop=includeRepeat&&kind==='specialist'&&row.status==='expired'&&row.paid?specialistTestShop(owner):undefined;
  const repeatInstalled=shop&&(await tx.query<{installed:boolean}>(`select exists(
   select 1 from pg_trigger where tgrelid='app.payment_orders'::regclass and tgname='specialist_repeat_purchase_guard' and tgenabled='A'
    and tgfoid=to_regprocedure('app.guard_specialist_repeat_purchase()')) as installed`)).rows[0]?.installed;
  const canRepeat=repeatInstalled&&(await tx.query<{available:boolean}>(`select exists(select 1 from app.payment_orders o join app.payment_checkout_intents i on i.id=o.id
    join app.payment_fulfillments f on f.intent_id=i.id join app.specialist_checkout_terms terms on terms.intent_id=i.id
    where o.owner_id=$1 and o.target_type='specialist' and o.target_id=$2 and o.status='succeeded'
     and i.is_test and i.merchant_shop_id=$3 and i.tariff_id='specialist-publication'
     and i.request_body::jsonb#>>'{metadata,publicationMode}'='specialist-account-test-v1'
     and f.published_at=$4::timestamptz and f.expires_at=$5::timestamptz) as available`,
   [owner,id,shop,row.publishedAt,row.expiresAt])).rows[0]?.available;
  return{...row,form,...(canRepeat?{canRepeat:true as const}:{}),photos:photos.map(({id,mimeType,width,height,size})=>({id,mimeType,width,height,size}))};
 }
 private async references(tx:PostgresQueries,form:ServicePublicationForm,previous?:{id:string|null;name:string|null}){
  const lookup=async(value:string|null,sql:string)=>{if(!value)return null;const rows=(await tx.query<{id:string}>(sql,[value])).rows;
   if(rows.length!==1)throw new ServicePublicationInputError();return rows[0].id;};
  const city=form.kind==='marquee'?null:await lookup(form.cityName,'select id from app.cities where name=$1 limit 2');
  try{
   const profession=form.kind==='specialist'?await resolveProfession(tx,form.professionName,form.professionId,previous):null;
   return{city,profession:profession?.id??null,professionName:profession?.name??null};
  }catch(error){if(error instanceof ProfessionReferenceError)throw new ServicePublicationInputError();throw error;}
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
 async inspectInTransaction(tx:PostgresQueries,owner:string,kind:ServicePublicationKind,publicationId:unknown,expectedRevision:unknown,includeRepeat=false){
  kindOf(kind);const id=parseListingDraftId(publicationId),revision=parseListingDraftRevision(expectedRevision);
  const row=(await tx.query<{revision:string;referencesActive:boolean}>(`select s.revision::text as revision,
   (s.kind='marquee' or (c.id is not null and (s.kind<>'specialist' or p.active is true))) as "referencesActive"
   from app.service_publications s left join app.cities c on c.id=s.city_id left join app.specialist_categories p on p.id=s.profession_id
   where s.id=$1 and s.author_id=$2 and s.kind=$3 and s.deleted_at is null for update of s`,[id,owner,kind])).rows[0];
  if(!row)throw new ServicePublicationAccessError();if(row.revision!==revision)throw new ServicePublicationConflictError();
  const snapshot=await this.snapshot(tx,owner,kind,id,includeRepeat),issues=this.options.specialistProfileIdentity&&kind==='specialist'?checkSpecialistApplicationForm(snapshot.form):checkServicePublicationForm(snapshot.form);
  if(!row.referencesActive)issues.push('Выберите действующие город и профессию.');return{snapshot,issues};
 }
 create(token:string,owner:string,kind:ServicePublicationKind,creationKey:unknown,input:unknown){return this.write(()=>withAppSessionTransaction(this.db,token,async(tx,user)=>{
  if(user.id!==owner)throw new ServicePublicationAccessError();kindOf(kind);const key=parseListingDraftId(creationKey),inputForm=parseServicePublicationForm(kind,input);
  const prior=(await tx.query<{id:string}>("select id from app.service_publications where author_id=$1 and kind=$2 and (creation_key=$3 or kind='specialist') and deleted_at is null",[owner,kind,key])).rows[0];
  if(prior)return this.snapshot(tx,owner,kind,prior.id);
  const parsed=await this.profileBoundForm(tx,owner,inputForm),refs=await this.references(tx,parsed),form=parsed.kind==='specialist'?{...parsed,professionName:refs.professionName}:parsed,ids=photoIds(form);
  await this.checkPhotos(tx,owner,ids);
  const inserted=(await tx.query<{id:string}>(`insert into app.service_publications(author_id,kind,creation_key,form,city_id,profession_id)
   values($1,$2,$3,$4::jsonb,$5,$6) on conflict do nothing returning id`,[owner,kind,key,JSON.stringify(form),refs.city,refs.profession])).rows[0];
  // Specialist has one durable profile per account, not another profile for each button press.
  const existing=inserted??(await tx.query<{id:string}>("select id from app.service_publications where author_id=$1 and kind=$2 and (creation_key=$3 or kind='specialist') and deleted_at is null",[owner,kind,key])).rows[0];
  if(!existing)throw new ServicePublicationAccessError();if(inserted)await this.photos(tx,inserted.id,ids);return this.snapshot(tx,owner,kind,existing.id);
 }));}
 read(token:string,owner:string,kind:ServicePublicationKind,publicationId:unknown,includeRepeat=false){return withAppSessionTransaction(this.db,token,async(tx,user)=>{
  if(user.id!==owner)throw new ServicePublicationAccessError();return this.snapshot(tx,owner,kindOf(kind),parseListingDraftId(publicationId),includeRepeat);
 });}
 readIntent(token:string,owner:string,kind:ServicePublicationKind,creationKey:unknown){return withAppSessionTransaction(this.db,token,async(tx,user)=>{
  if(user.id!==owner)throw new ServicePublicationAccessError();kindOf(kind);
  const row=(await tx.query<{id:string}>("select id from app.service_publications where author_id=$1 and kind=$2 and (creation_key=$3 or kind='specialist') and deleted_at is null",[owner,kind,parseListingDraftId(creationKey)])).rows[0];
  return row?this.snapshot(tx,owner,kind,row.id):null;
 });}
 list(token:string,owner:string,kind:ServicePublicationKind,after:unknown){return withAppSessionTransaction(this.db,token,async(tx,user)=>{
  if(user.id!==owner)throw new ServicePublicationAccessError();kindOf(kind);const cursor=parseListingDraftCursor(after);
  const rows=(await tx.query<{id:string;kind:ServicePublicationKind;title:string;revision:string;status:typeof servicePublicationStatuses[number];paid:boolean;updatedAt:string}>(`select id,kind,title,revision::text as revision,${effectivePublicationStatusSql()} as status,is_paid as paid,
   to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "updatedAt" from app.service_publications
   where author_id=$1 and kind=$2 and deleted_at is null ${cursor?'and (updated_at,id)<($3::timestamptz,$4::uuid)':''}
   order by updated_at desc,id desc limit 21`,cursor?[owner,kind,cursor.updatedAt,cursor.id]:[owner,kind])).rows;
  const items=rows.slice(0,20),last=items.at(-1);return{items,nextCursor:rows.length>20&&last?{id:last.id,updatedAt:last.updatedAt}:null};
 });}
 update(token:string,owner:string,kind:ServicePublicationKind,publicationId:unknown,expectedRevision:unknown,input:unknown){return this.write(()=>withAppSessionTransaction(this.db,token,async(tx,user)=>{
  if(user.id!==owner)throw new ServicePublicationAccessError();kindOf(kind);const id=parseListingDraftId(publicationId),revision=parseListingDraftRevision(expectedRevision),form=await this.profileBoundForm(tx,owner,parseServicePublicationForm(kind,input));
  const row=(await tx.query<{revision:string;professionId:string|null;professionName:string|null}>(`select revision::text as revision,profession_id as "professionId",form->>'professionName' as "professionName"
   from app.service_publications where id=$1 and author_id=$2 and kind=$3 and deleted_at is null for update`,[id,owner,kind])).rows[0];
  if(!row)throw new ServicePublicationAccessError();if(row.revision!==revision||revision==='9223372036854775807')throw new ServicePublicationConflictError();
  // The shared user lock also serializes checkout preparation; SQL keeps its independent guard.
  if(kind==='specialist'&&(await tx.query(`select 1 from app.payment_orders o where o.target_type='specialist' and o.target_id=$1 and o.owner_id=$2
   and (o.status in ('created','pending') or o.status='succeeded' and not exists(select 1 from app.payment_fulfillments f where f.intent_id=o.id)) limit 1`,[id,owner])).rowCount)throw new ServicePublicationCheckoutActiveError();
  const refs=await this.references(tx,form,{id:row.professionId,name:row.professionName}),canonical=form.kind==='specialist'?{...form,professionName:refs.professionName}:form,ids=photoIds(form);await this.checkPhotos(tx,owner,ids);
  const result=await tx.query(`update app.service_publications set form=$4::jsonb,city_id=$5,profession_id=$6,revision=revision+1,updated_at=clock_timestamp()
   where id=$1 and author_id=$2 and kind=$3 and revision=$7::bigint and deleted_at is null`,[id,owner,kind,JSON.stringify(canonical),refs.city,refs.profession,revision]);
  if(result.rowCount!==1)throw new ServicePublicationConflictError();await this.photos(tx,id,ids);return this.snapshot(tx,owner,kind,id);
 }));}
}
