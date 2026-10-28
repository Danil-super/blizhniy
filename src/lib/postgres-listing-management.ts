import {withAppSessionTransaction} from './app-session-transaction';
import {AdminAccessError} from './admin-authorization';
import {parseListingDraftId,parseListingDraftRevision} from './listing-draft-contract.ts';
import {parseListingBlockReason,ListingManagementNotFoundError,ListingManagementConflictError,type ListingManagementItem,type ListingManagementSummary} from './listing-block-contract.ts';
import {parseListingFormDraft,type ListingFormSnapshot} from './listing-form-contract.ts';
import {enqueueNotificationInTransaction} from './postgres-notification-inbox';
import {maxListingMediaTotalSize} from './media-limits.ts';
import type {PostgresDatabase,PostgresQueries} from './postgres';
import type {MediaFileRecord} from './media-files';
import type {ListingDraftPhoto} from './listing-photo-contract';
const columns=`l.id,l.revision::text as revision,l.title,l.status,l.is_paid as paid,b.listing_id is not null as blocked,b.reason as "blockReason",
 to_char(b.blocked_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "blockedAt"`;
type Item=ListingManagementItem&{owner:string};
/** Opt-in local postmoderation repository. No listing/payment state mutation, deletion or unblocking API. */
export class PostgresListingManagementStore {
 constructor(private readonly db:Pick<PostgresDatabase,'transaction'>,private readonly files?:{read(record:MediaFileRecord):Promise<Buffer>}){}
 private admin<T>(token:string,expected:string,work:(tx:PostgresQueries,actor:string)=>Promise<T>){
  const actor=parseListingDraftId(expected);
  return withAppSessionTransaction(this.db,token,(tx,user)=>{if(user.id!==actor)throw new AdminAccessError();return work(tx,user.id);},{requireAdmin:true,denied:()=>new AdminAccessError()});
 }
 private async current(tx:PostgresQueries,id:string){
  // Same listing lock serializes owner edits, publication and blocking; block survives every content revision.
  const listing=(await tx.query<{id:string}>('select id from app.listings where id=$1 for update',[id])).rows[0];
  if(!listing)throw new ListingManagementNotFoundError();
  const row=(await tx.query<Item>(`select ${columns},l.author_id as owner from app.listings l left join app.listing_blocks b on b.listing_id=l.id where l.id=$1`,[id])).rows[0];
  if(!row)throw new ListingManagementNotFoundError();return row;
 }
 list(token:string,actor:string,after:unknown){const cursor=after===null?null:parseListingDraftId(after);
  return this.admin(token,actor,async tx=>{
   const rows=(await tx.query<ListingManagementSummary>(`select ${columns},json_build_object(
    'kind',case l.listing_type when 'sell' then 'prodam' when 'buy' then 'kuplyu' when 'free' then 'otdam-darom' when 'rent' then 'arenda' end,
    'price',l.price::text,'city',city.name,'district',l.district,'coverPhotoId',(
     select p.media_id::text from app.listing_photos p join app.media_objects m on m.id=p.media_id and m.owner_id=l.author_id and m.state='ready'
     where p.listing_id=l.id order by p.position limit 1)) as card
    from app.listings l left join app.listing_blocks b on b.listing_id=l.id left join app.cities city on city.id=l.city_id
    ${cursor?'where (l.created_at,l.id)<(select created_at,id from app.listings where id=$1::uuid)':''}
    order by l.created_at desc,l.id desc limit 21`,cursor?[cursor]:[])).rows;
   return {items:rows.slice(0,20),nextCursor:rows.length>20?rows[19].id:null};
  });
 }
 inspect(token:string,actor:string,listingId:unknown){const id=parseListingDraftId(listingId);
  return this.admin(token,actor,async tx=>{
   const {owner,...listing}=await this.current(tx,id);
   const row=(await tx.query<{form:unknown}>(`select json_build_object('kind',case l.listing_type when 'sell' then 'prodam' when 'buy' then 'kuplyu' when 'free' then 'otdam-darom' when 'rent' then 'arenda' end,
    'title',l.title,'description',l.description,'price',l.price::text,'categorySlug',coalesce(parent.slug,c.slug),'subcategoryName',case when c.parent_id is not null then c.name end,
    'cityName',city.name,'district',l.district,'address',l.address,'latitude',l.latitude::float8,'longitude',l.longitude::float8,'showExactAddress',l.show_exact_address,
    'contactPhone',l.contact_phone,'messengerUrl',l.messenger_url,'contactMethod',l.contact_method,'booking',l.booking,
    'photoIds',array(select p.media_id::text from app.listing_photos p where p.listing_id=l.id order by p.position)) as form
    from app.listings l left join app.categories c on c.id=l.category_id left join app.categories parent on parent.id=c.parent_id left join app.cities city on city.id=l.city_id where l.id=$1`,[id])).rows[0];
   const photos=(await tx.query<ListingDraftPhoto>(`select m.id,m.mime_type as "mimeType",m.width,m.height,m.size from app.listing_photos p
    join app.media_objects m on m.id=p.media_id and m.owner_id=$2 and m.state='ready' where p.listing_id=$1 order by p.position limit 10001`,[id,owner])).rows;
   const form=parseListingFormDraft(row.form);
   if(photos.length>10000||photos.map(photo=>photo.id).join()!==form.photoIds.join()||photos.reduce((sum,photo)=>sum+photo.size,0)>maxListingMediaTotalSize)throw new ListingManagementNotFoundError();
   const snapshot:ListingFormSnapshot={id,revision:listing.revision,form,photos};return {listing,snapshot};
  });
 }
 block(token:string,actor:string,listingId:unknown,expectedRevision:unknown,value:unknown){
  const id=parseListingDraftId(listingId),revision=parseListingDraftRevision(expectedRevision),reason=parseListingBlockReason(value);
  return this.admin(token,actor,async(tx,admin)=>{
   const row=await this.current(tx,id);
   if(row.revision!==revision)throw new ListingManagementConflictError();
   if(row.blocked){
    const same=(await tx.query<{same:boolean}>(`select blocked_by=$2 and blocked_revision=$3::bigint and reason=$4 as same from app.listing_blocks where listing_id=$1`,[id,admin,revision,reason])).rows[0];
    if(!same?.same)throw new ListingManagementConflictError();const {owner,...listing}=row;void owner;return listing;
   }
   await tx.query('insert into app.listing_blocks(listing_id,blocked_by,blocked_revision,reason) values($1,$2,$3::bigint,$4)',[id,admin,revision,reason]);
   const body=`Объявление «${row.title||'Без названия'}» заблокировано. Причина: ${reason}`;
   await enqueueNotificationInTransaction(tx,row.owner,{eventKey:`listing-block:${id}`,category:'publication',tone:'warning',title:'Объявление заблокировано',body,actionHref:'/cabinet/obyavleniya',bookingRequestId:null});
   await tx.query(`insert into app.listing_block_mail(listing_id,user_id,subject,body) values($1,$2,'Объявление заблокировано',$3)`,[id,row.owner,body]);
   const {owner,...listing}=await this.current(tx,id);void owner;return listing;
  });
 }
 readPhoto(token:string,actor:string,listingId:unknown,fileId:unknown){const id=parseListingDraftId(listingId),file=parseListingDraftId(fileId);
  return this.admin(token,actor,async tx=>{
   const row=await this.current(tx,id);
   const record=(await tx.query<MediaFileRecord>(`select m.id,m.mime_type as "mimeType",m.width,m.height,m.size,m.sha256 from app.listing_photos p
    join app.media_objects m on m.id=p.media_id and m.owner_id=$3 and m.state='ready' where p.listing_id=$1 and p.media_id=$2`,[id,file,row.owner])).rows[0];
   if(!record)throw new ListingManagementNotFoundError();if(!this.files)throw Error('Private reader unavailable');return {record,bytes:await this.files.read(record)};
  });
 }
}
