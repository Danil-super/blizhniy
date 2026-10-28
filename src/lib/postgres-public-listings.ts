import {mapPublicListing,type PublicListingRow} from './public-listings';import {publicListingSource,publicListingLive,publicListingPhotos,postmoderationListingSource,postmoderationListingLive} from './listing-public-eligibility';
import {parseListingDraftId,ListingDraftInputError} from './listing-draft-contract.ts';import {maxListingMediaTotalSize} from './media-limits.ts';
import type {Listing,ListingKind} from './types';import type {ListingFormDraft} from './listing-form-contract';import type {PostgresQueries} from './postgres';import type {MediaFileRecord} from './media-files';
export type PublicListingQuery={kind?:ListingKind;ownerId?:string;categorySlug?:string;subcategoryName?:string;limit?:number;offset?:number};
export type PublicListingPhoto={record:MediaFileRecord;revision:string;expiresAt:string};
type Row=Omit<PublicListingRow,'form'>&{form:Omit<ListingFormDraft,'photoIds'>};
const dbKinds={prodam:'sell',kuplyu:'buy','otdam-darom':'free',arenda:'rent'} as const;
const stamp=(column:string)=>`to_char(${column} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const columns=(coverOnly=false,postmoderation=false)=>`l.id,l.author_id as "ownerId",l.revision::text as revision,${postmoderation?'null::text':'review.revision::text'} as "approvedRevision",
 profile.profile->>'name' as "authorName",(c.parent_id is not null) as "isSubcategory",l.status,l.is_paid as paid,l.view_count as "viewCount",
 ${stamp('l.created_at')} as "createdAt",${stamp('l.published_at')} as "publishedAt",${stamp('l.expires_at')} as "expiresAt",
 json_build_object('kind',case l.listing_type when 'sell' then 'prodam' when 'buy' then 'kuplyu' when 'free' then 'otdam-darom' when 'rent' then 'arenda' end,
 'title',l.title,'description',l.description,'price',l.price::text,'categorySlug',coalesce(parent.slug,c.slug),
 'subcategoryName',case when c.parent_id is not null then c.name end,'cityName',city.name,'district',l.district,'address',l.address,
 'latitude',l.latitude::float8,'longitude',l.longitude::float8,'showExactAddress',l.show_exact_address,'contactPhone',l.contact_phone,'messengerUrl',l.messenger_url,'booking',l.booking) as form,
 array(select p.media_id::text from app.listing_photos p where p.listing_id=l.id order by p.position ${coverOnly?'limit 1':''}) as "mediaIds"`;
function queryOptions(value:PublicListingQuery){
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||
  Reflect.ownKeys(value).some(key=>typeof key!=='string'||!['kind','ownerId','categorySlug','subcategoryName','limit','offset'].includes(key)))throw new ListingDraftInputError();
 const {kind,ownerId,categorySlug,subcategoryName,limit=24,offset=0}=value;
 if(kind!==undefined&&!Object.hasOwn(dbKinds,kind)||!Number.isSafeInteger(limit)||limit<1||limit>1000||!Number.isSafeInteger(offset)||offset<0||offset>1000000||
  categorySlug!==undefined&&(typeof categorySlug!=='string'||categorySlug.length>150||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(categorySlug))||
  subcategoryName!==undefined&&(!categorySlug||typeof subcategoryName!=='string'||!subcategoryName||subcategoryName.length>160||subcategoryName.trim()!==subcategoryName||/[\x00-\x1f\x7f]/.test(subcategoryName)))throw new ListingDraftInputError();
 return{kind:kind===undefined?null:dbKinds[kind],ownerId:ownerId===undefined?null:parseListingDraftId(ownerId),categorySlug:categorySlug??null,subcategoryName:subcategoryName??null,limit,offset};
}
/** Anonymous read-only projection. No owner access, finance/view-count writes, legacy fallback or swallowed SQL failures. */
export class PostgresPublicListingStore{
 private readonly postmoderation:boolean;
 private readonly source:string;
 private readonly eligible:string;
 constructor(private readonly db:PostgresQueries,options:{postmoderation?:boolean}={}){
  if(typeof window!=='undefined'||options.postmoderation!==undefined&&typeof options.postmoderation!=='boolean')throw Error('Public listing storage is server-only');
  this.postmoderation=options.postmoderation===true;
  this.source=`${this.postmoderation?postmoderationListingSource:publicListingSource} left join app.cabinet_profiles profile on profile.user_id=l.author_id`;
  this.eligible=`${this.postmoderation?postmoderationListingLive:publicListingLive} and ${publicListingPhotos}`;
 }
 private project(row:Row):Listing|null{return mapPublicListing({...row,form:{...row.form,photoIds:row.mediaIds}},Date.now(),{postmoderation:this.postmoderation});}
 async read(value:unknown):Promise<Listing|undefined>{
  let id:string;try{id=parseListingDraftId(value);}catch{return undefined;}
  const row=(await this.db.query<Row>(`select ${columns(false,this.postmoderation)} ${this.source} where l.id=$1 and ${this.eligible} limit 1`,[id,maxListingMediaTotalSize])).rows[0];
  return row?this.project(row)??undefined:undefined;
 }
 private async listRows(options:PublicListingQuery){
  // Lists need only a cover; the detail read retains every attached photo for the gallery.
  const query=queryOptions(options),rows=(await this.db.query<Row>(`select ${columns(true,this.postmoderation)} ${this.source} where ${this.eligible}
   and ($1::text is null or l.listing_type=$1) and ($3::uuid is null or l.author_id=$3)
   and ($4::text is null or coalesce(parent.slug,c.slug)=$4)
   and ($5::text is null or c.parent_id is not null and c.name=$5)
   order by l.published_at desc,l.created_at desc,l.id desc limit $6 offset $7`,[query.kind,maxListingMediaTotalSize,query.ownerId,query.categorySlug,query.subcategoryName,query.limit,query.offset])).rows;
  return rows;
 }
 async list(options:PublicListingQuery={}):Promise<Listing[]>{
  return (await this.listRows(options)).map(row=>this.project(row)).filter((row):row is Listing=>row!==null);
 }
 async sitemapPage(limit=100,offset=0){
  const rows=await this.listRows({limit,offset});
  const entries=rows.map(row=>this.project(row)).filter((row):row is Listing=>row!==null)
   .map(({id,publishedAt})=>({id,publishedAt}));
  return{entries,hasMore:rows.length===limit};
 }
 async photoRecord(value:unknown,file:unknown):Promise<PublicListingPhoto|undefined>{
  let id:string,media:string;try{id=parseListingDraftId(value);media=parseListingDraftId(file);}catch{return undefined;}
  const row=(await this.db.query<Row&{record:MediaFileRecord}>(`select ${columns(false,this.postmoderation)},json_build_object('id',image.id,'mimeType',image.mime_type,'width',image.width,'height',image.height,'size',image.size,'sha256',image.sha256) as record
   ${this.source} join app.listing_photos attachment on attachment.listing_id=l.id
   join app.media_objects image on image.id=attachment.media_id and image.owner_id=l.author_id and image.state='ready'
   where l.id=$1 and ${this.eligible} and image.id=$3 limit 1`,[id,maxListingMediaTotalSize,media])).rows[0];
  if(!row||!row.mediaIds.includes(media)||!this.project(row))return undefined;
  return{record:row.record,revision:row.revision,expiresAt:row.expiresAt!};
 }
}
