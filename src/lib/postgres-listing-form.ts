import {withAppSessionTransaction} from './app-session-transaction';
import {ListingDraftAccessError,ListingDraftConflictError} from './postgres-listing-drafts';
import {ListingDraftInputError,parseListingDraftId,parseListingDraftRevision} from './listing-draft-contract.ts';
import {parseListingFormDraft,type ListingFormDraft,type ListingFormSnapshot} from './listing-form-contract.ts';
import {maxListingMediaTotalSize} from './media-limits.ts';
import type {PostgresDatabase,PostgresQueries} from './postgres';
import type {ListingDraftPhoto} from './listing-photo-contract';
import {checkListingPublication,type PublicationTariffRow} from './listing-publication-check';
const kinds={sell:'prodam',buy:'kuplyu',free:'otdam-darom',rent:'arenda'} as const;
const dbKinds={prodam:'sell',kuplyu:'buy','otdam-darom':'free',arenda:'rent'} as const;
type Row=ListingFormDraft&{id:string;revision:string;listingType:keyof typeof kinds};
const columns=`l.id,l.revision::text as revision,l.listing_type as "listingType",l.title,l.description,l.price::text as price,
 coalesce(parent.slug,c.slug) as "categorySlug",case when c.parent_id is not null then c.name end as "subcategoryName",city.name as "cityName",
 l.district,l.address,l.latitude::float8 as latitude,l.longitude::float8 as longitude,l.show_exact_address as "showExactAddress",
 l.contact_phone as "contactPhone",l.messenger_url as "messengerUrl",l.booking`;

/** Full owner-private draft replacement. No publication, billing writes, public view or retry. */
export class PostgresListingFormStore{
 private readonly contactMethod:boolean;
 constructor(private readonly db:Pick<PostgresDatabase,'transaction'>,options:{contactMethod?:boolean}={}){
  if(typeof window!=='undefined'||(options.contactMethod!==undefined&&typeof options.contactMethod!=='boolean'))throw new Error('Listing forms are server-only');
  this.contactMethod=options.contactMethod===true;
 }
 private async snapshot(tx:PostgresQueries,owner:string,id:string):Promise<ListingFormSnapshot>{
  const row=(await tx.query<Row>(`select ${columns}${this.contactMethod?',l.contact_method as "contactMethod"':''} from app.listings l left join app.categories c on c.id=l.category_id
   left join app.categories parent on parent.id=c.parent_id left join app.cities city on city.id=l.city_id
   where l.id=$1 and l.author_id=$2 and l.status='draft'`,[id,owner])).rows[0];
  if(!row)throw new ListingDraftAccessError();
  const photos=(await tx.query<ListingDraftPhoto&{permitted:boolean}>(`select m.id,m.mime_type as "mimeType",m.width,m.height,m.size,
   (m.owner_id=$2 and m.state='ready') as permitted from app.listing_photos p join app.media_objects m on m.id=p.media_id
   where p.listing_id=$1 order by p.position limit 10001`,[id,owner])).rows;
  if(photos.length>10000||photos.some(item=>!item.permitted)||photos.reduce((sum,item)=>sum+item.size,0)>maxListingMediaTotalSize)throw new ListingDraftAccessError();
  const {id:listingId,revision,listingType,...fields}=row;
  return{id:listingId,revision,form:parseListingFormDraft({...fields,kind:kinds[listingType],photoIds:photos.map(item=>item.id)}),
   photos:photos.map(({id,mimeType,width,height,size})=>({id,mimeType,width,height,size}))};
 }
 read(token:string,owner:string,listingId:unknown){return withAppSessionTransaction(this.db,token,async(tx,user)=>{
  if(user.id!==owner)throw new ListingDraftAccessError();return this.snapshot(tx,owner,parseListingDraftId(listingId));
 });}
 checkPublication(token:string,owner:string,listingId:unknown,expectedRevision:unknown){return withAppSessionTransaction(this.db,token,async(tx,user)=>{
  if(user.id!==owner)throw new ListingDraftAccessError();return (await this.inspectInTransaction(tx,owner,listingId,expectedRevision)).check;
 });}
 /** Trusted repository composition only: caller must authorize identity and hold the app-session transaction. */
 async inspectInTransaction(tx:PostgresQueries,owner:string,listingId:unknown,expectedRevision:unknown){
  const id=parseListingDraftId(listingId),revision=parseListingDraftRevision(expectedRevision);
  const current=(await tx.query<{revision:string}>("select revision::text as revision from app.listings where id=$1 and author_id=$2 and status='draft' for update",[id,owner])).rows[0];
  if(!current)throw new ListingDraftAccessError();if(current.revision!==revision)throw new ListingDraftConflictError();
  const snapshot=await this.snapshot(tx,owner,id);
  const category=(await tx.query<{active:boolean}>(`select (c.active and (c.parent_id is null or parent.active is true)) as active
   from app.listings l join app.categories c on c.id=l.category_id left join app.categories parent on parent.id=c.parent_id where l.id=$1`,[id])).rows[0];
  const offer=(await tx.query<PublicationTariffRow>(`select id,action,name,price::text as amount,duration_days as "durationDays",active
   from app.tariffs where action='listing_publication' limit 1`)).rows[0]??null;
  return {snapshot,check:checkListingPublication(snapshot,category?.active===true,offer)};
 }
 async update(token:string,owner:string,listingId:unknown,expectedRevision:unknown,input:unknown){
  try{return await withAppSessionTransaction(this.db,token,async(tx,user)=>{
   if(user.id!==owner)throw new ListingDraftAccessError();
   const id=parseListingDraftId(listingId),revision=parseListingDraftRevision(expectedRevision),form=parseListingFormDraft(input);
   if(form.contactMethod==='messenger'&&!this.contactMethod)throw new ListingDraftInputError();
   const current=(await tx.query<{revision:string}>("select revision::text as revision from app.listings where id=$1 and author_id=$2 and status='draft' for update",[id,owner])).rows[0];
   if(!current)throw new ListingDraftAccessError();if(current.revision!==revision||revision==='9223372036854775807')throw new ListingDraftConflictError();
   let categoryId:string|null=null,cityId:string|null=null;
   if(form.categorySlug){
    const categories=(await tx.query<{id:string}>(`select c.id from app.categories root join app.categories c
     on (case when $2::text is null then c.id=root.id else c.parent_id=root.id and c.name=$2 end)
     where root.slug=$1 and root.parent_id is null limit 2`,[form.categorySlug,form.subcategoryName])).rows;
    if(categories.length!==1)throw new ListingDraftInputError();categoryId=categories[0].id;
   }
   if(form.cityName){const cities=(await tx.query<{id:string}>('select id from app.cities where name=$1 limit 2',[form.cityName])).rows;
    if(cities.length!==1)throw new ListingDraftInputError();cityId=cities[0].id;}
   const available=form.photoIds.length?(await tx.query<{size:number}>("select size from app.media_objects where owner_id=$1 and state='ready' and id=any($2::uuid[])",[owner,form.photoIds])).rows:[];
   if(available.length!==form.photoIds.length)throw new ListingDraftAccessError();
   if(available.reduce((sum,item)=>sum+item.size,0)>maxListingMediaTotalSize)throw new ListingDraftInputError();
   const updated=await tx.query(`update app.listings set listing_type=$3,title=$4,description=$5,price=$6,category_id=$7,city_id=$8,
    district=$9,address=$10,latitude=$11,longitude=$12,show_exact_address=$13,contact_phone=$14,messenger_url=$15,booking=$16::jsonb,${this.contactMethod?'contact_method=$18,':''}
    revision=revision+1,updated_at=clock_timestamp() where id=$1 and author_id=$2 and status='draft' and revision=$17::bigint`,
    [id,owner,dbKinds[form.kind],form.title,form.description,form.price,categoryId,cityId,form.district,form.address,form.latitude,form.longitude,
     form.showExactAddress,form.contactPhone,form.messengerUrl,form.booking===null?null:JSON.stringify(form.booking),revision,...(this.contactMethod?[form.contactMethod??'phone']:[])]);
   if(updated.rowCount!==1)throw new ListingDraftConflictError();
   await tx.query('delete from app.listing_photos where listing_id=$1',[id]);
   if(form.photoIds.length)await tx.query(`insert into app.listing_photos(listing_id,media_id,position)
    select $1,item.id,(item.position-1)::integer from unnest($2::uuid[]) with ordinality as item(id,position)`,[id,form.photoIds]);
   return this.snapshot(tx,owner,id);
  });}catch(error){if(error&&typeof error==='object'&&'code'in error&&error.code==='23503')throw new ListingDraftInputError();throw error;}
 }
}
