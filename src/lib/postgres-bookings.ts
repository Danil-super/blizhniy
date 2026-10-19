import {withAppSessionTransaction,AppSessionAccessError} from './app-session-transaction';
import {parseBookingRequest,quoteBookingRequest,BookingRequestInputError,BookingQuoteError,type BookingRequestInput} from './booking-request-contract.ts';
import {parseListingDraftId,parseListingDraftRevision,parseListingDraftCursor,type ListingDraftCursor} from './listing-draft-contract.ts';
import {parseListingFormDraft,type ListingFormDraft} from './listing-form-contract.ts';import {checkListingFormContent} from './listing-publication-check';
import {maxListingMediaTotalSize} from './media-limits.ts';import {enqueueNotificationInTransaction} from './postgres-notification-inbox';
import type {PostgresDatabase,PostgresQueries} from './postgres';import type {BookingDetails} from './types';
export class BookingAccessError extends Error{constructor(){super('Booking unavailable');this.name='BookingAccessError';}}
export class BookingConflictError extends Error{constructor(){super('Booking changed');this.name='BookingConflictError';}}
export class BookingAvailabilityError extends Error{constructor(){super('Booking capacity unavailable');this.name='BookingAvailabilityError';}}
export class BookingBusyError extends Error{constructor(){super('Booking participant busy');this.name='BookingBusyError';}}
type Bookable={id:string;author:string;revision:string;title:string;booking:BookingDetails;today:string};
/** Shared public eligibility gate; private form/contact columns are validated, never returned. Caller locks separately for writes. */
export async function readBookableListing(tx:PostgresQueries,id:string):Promise<Bookable|null>{
 const row=(await tx.query<ListingFormDraft&{id:string;author:string;revision:string;today:string}>(`select l.id,l.author_id as author,l.revision::text as revision,l.title,l.description,l.price::text as price,
  coalesce(parent.slug,c.slug) as "categorySlug",case when c.parent_id is not null then c.name end as "subcategoryName",city.name as "cityName",
  l.district,l.address,l.latitude::float8 as latitude,l.longitude::float8 as longitude,l.show_exact_address as "showExactAddress",l.contact_phone as "contactPhone",l.messenger_url as "messengerUrl",l.booking,
  to_char(clock_timestamp() at time zone 'Europe/Moscow','YYYY-MM-DD') as today
  from app.listings l join app.users author on author.id=l.author_id and not author.is_blocked and author.email_verified_at is not null
  join app.categories c on c.id=l.category_id and c.active left join app.categories parent on parent.id=c.parent_id
  join app.cities city on city.id=l.city_id join app.listing_moderation review on review.listing_id=l.id and review.revision=l.revision and review.state='approved'
  where l.id=$1 and l.listing_type='rent' and l.status='published' and l.is_paid and l.published_at<=clock_timestamp() and l.expires_at>clock_timestamp()
  and (c.parent_id is null or parent.active is true)
  and not exists(select 1 from app.listing_photos p left join app.media_objects m on m.id=p.media_id
   where p.listing_id=l.id and (m.id is null or m.owner_id<>l.author_id or m.state<>'ready'))
  and (select count(*)<=10000 and coalesce(sum(m.size),0)<=$2 from app.listing_photos p join app.media_objects m on m.id=p.media_id where p.listing_id=l.id)`,[id,maxListingMediaTotalSize])).rows[0];
 if(!row)return null;
 try{const {id,author,revision,today,...fields}=row,form=parseListingFormDraft({...fields,kind:'arenda',photoIds:[]});
  if(!form.booking||checkListingFormContent(form,true).length)return null;return{id,author,revision,title:form.title,booking:form.booking,today};
 }catch{return null;}
}
type Status='pending'|'accepted'|'declined';type Terms={listingRevision:string;title:string;booking:BookingDetails};
export type BookingInventory={listing:{id:string;revision:string;title:string};booking:BookingDetails;today:string;occupiedDates:string[];tourSeatsRemaining:number|null};
/** Anonymous point-in-time inventory, never request rows. Mutations always recheck under the listing lock. */
export class PostgresBookingAvailabilityStore{
 constructor(private readonly db:PostgresQueries){}
 async read(value:unknown):Promise<BookingInventory|null>{
  const id=parseListingDraftId(value),listing=await readBookableListing(this.db,id);if(!listing)return null;
  let occupiedDates:string[]=[],tourSeatsRemaining:number|null=null;
  if(listing.booking.mode==='stay'){
   occupiedDates=(await this.db.query<{day:string}>(`select distinct to_char(day,'YYYY-MM-DD') as day from app.booking_requests b
    cross join lateral generate_series(greatest(b.start_date,$2::date)::timestamp,least(b.end_date-1,$2::date+365)::timestamp,interval '1 day') as day
    where b.listing_id=$1 and b.mode='stay' and b.status in ('pending','accepted') and b.start_date<=$2::date+365 and b.end_date>$2::date order by day limit 367`,[id,listing.today])).rows.map(row=>row.day);
   if(occupiedDates.length>366)throw new BookingAvailabilityError();
  }else{
   const occupied=(await this.db.query<{occupied:string}>(`select coalesce(sum(guests),0)::text as occupied from app.booking_requests where listing_id=$1 and mode='tour' and status='accepted' and start_date=$2::date`,[id,listing.booking.tourDate])).rows[0].occupied;
   const remaining=BigInt(listing.booking.maxGuests!)-BigInt(occupied);tourSeatsRemaining=remaining>BigInt(0)?Number(remaining):0;
  }
  const current=await readBookableListing(this.db,id);
  if(!current)return null;if(current.revision!==listing.revision||current.today!==listing.today||JSON.stringify(current.booking)!==JSON.stringify(listing.booking))throw new BookingConflictError();
  return{listing:{id,title:listing.title,revision:listing.revision},booking:listing.booking,today:listing.today,occupiedDates,tourSeatsRemaining};
 }
}
type Row={id:string;guest:string;host:string;listingId:string;creationKey:string;mode:'stay'|'tour';startDate:string;endDate:string|null;guests:number;total:string;terms:Terms;revision:string;status:Status;createdAt:string;updatedAt:string;decidedAt:string|null};
export type BookingSnapshot={id:string;revision:string;view:'guest'|'host';listing:{id:string;title:string};mode:'stay'|'tour';startDate:string;endDate:string|null;guests:number;total:string;status:Status;booking:BookingDetails;createdAt:string;updatedAt:string;decidedAt:string|null};
export type BookingSummary=Omit<BookingSnapshot,'booking'|'updatedAt'|'decidedAt'>;
export type BookingPage={items:BookingSummary[];nextCursor:ListingDraftCursor|null};
const stamp=(column:string)=>`to_char(${column} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const source='from app.booking_requests b join app.listings l on l.id=b.listing_id',member='(b.guest_id=$2 or l.author_id=$2)';
const columns=`b.id,b.guest_id as guest,l.author_id as host,b.listing_id as "listingId",b.creation_key as "creationKey",b.mode,b.start_date::text as "startDate",b.end_date::text as "endDate",b.guests,b.total::text as total,
 b.details_snapshot as terms,b.revision::text as revision,b.status,${stamp('b.created_at')} as "createdAt",${stamp('b.updated_at')} as "updatedAt",${stamp('b.decided_at')} as "decidedAt"`;
const display=(row:Row,actor:string):BookingSnapshot=>({id:row.id,revision:row.revision,view:row.guest===actor?'guest':'host',listing:{id:row.listingId,title:row.terms.title},mode:row.mode,startDate:row.startDate,endDate:row.endDate,guests:row.guests,total:row.total,status:row.status,booking:row.terms.booking,createdAt:row.createdAt,updatedAt:row.updatedAt,decidedAt:row.decidedAt});
/** All create/decision operations serialize on the listing row. No payment, identity or quoted amount updates. */
export class PostgresBookingStore{
 constructor(private readonly db:Pick<PostgresDatabase,'transaction'>){}
 private owner<T>(token:string,owner:string,work:(tx:PostgresQueries,actor:string)=>Promise<T>){const expected=parseListingDraftId(owner);
  return withAppSessionTransaction(this.db,token,(tx,user)=>{if(user.id!==expected)throw new AppSessionAccessError();return work(tx,user.id);});}
 private async peer(tx:PostgresQueries,id:string,live=false){
  try{if((await tx.query(`select id from app.users where id=$1 ${live?'and not is_blocked and email_verified_at is not null':''} for share nowait`,[id])).rowCount!==1)throw new BookingAccessError();}
  catch(error){if(error&&typeof error==='object'&&'code'in error&&error.code==='55P03')throw new BookingBusyError();throw error;}
 }
 private async current(tx:PostgresQueries,actor:string,id:string){
  const initial=(await tx.query<{author:string}>('select author_id as author from app.listings where id=$1',[id])).rows[0];if(!initial||initial.author===actor)throw new BookingAccessError();
  await this.peer(tx,initial.author,true);const locked=(await tx.query<{author:string}>('select author_id as author from app.listings where id=$1 for update',[id])).rows[0];
  if(!locked||locked.author!==initial.author)throw new BookingAccessError();const result=await readBookableListing(tx,id);if(!result)throw new BookingAccessError();return result;
 }
 private async available(tx:PostgresQueries,input:BookingRequestInput,booking:BookingDetails,exclude:string|null=null){
  if(input.mode==='stay'){
   const rows=await tx.query(`select id from app.booking_requests where listing_id=$1 and mode='stay' and status in ('pending','accepted')
    and start_date<$3::date and end_date>$2::date and ($4::uuid is null or id<>$4) limit 1`,[input.listingId,input.startDate,input.endDate,exclude]);
   if(rows.rowCount)throw new BookingAvailabilityError();
  }else{
   const {occupied}=(await tx.query<{occupied:string}>(`select coalesce(sum(guests),0)::text as occupied from app.booking_requests
    where listing_id=$1 and mode='tour' and start_date=$2::date and status='accepted' and ($3::uuid is null or id<>$3)`,[input.listingId,input.startDate,exclude])).rows[0];
   if(!Number.isSafeInteger(booking.maxGuests)||booking.maxGuests===undefined||BigInt(occupied)+BigInt(input.guests)>BigInt(booking.maxGuests))throw new BookingAvailabilityError();
  }
 }
 private async row(tx:PostgresQueries,actor:string,id:string,lock=true){const row=(await tx.query<Row>(`select ${columns} ${source} where b.id=$1 and ${member} ${lock?'for update of b':''}`,[id,actor])).rows[0];if(!row)throw new BookingAccessError();return row;}
 private async locate(tx:PostgresQueries,actor:string,id:string){const initial=await this.row(tx,actor,id,false);await tx.query('select id from app.listings where id=$1 for update',[initial.listingId]);return this.row(tx,actor,id);}
 private async finish(tx:PostgresQueries,id:string,input:BookingRequestInput){const listing=await readBookableListing(tx,id);if(!listing)throw new BookingAccessError();quoteBookingRequest(listing.booking,input,listing.today);}
 preview(token:string,owner:string,value:unknown){const input=parseBookingRequest(value);return this.owner(token,owner,async(tx,actor)=>{
  const listing=await this.current(tx,actor,input.listingId);if(listing.revision!==input.expectedListingRevision)throw new BookingConflictError();
  const quote=quoteBookingRequest(listing.booking,input,listing.today);await this.available(tx,input,listing.booking);await this.finish(tx,listing.id,input);
  return{listing:{id:listing.id,title:listing.title,revision:listing.revision},quote};
 });}
 create(token:string,owner:string,value:unknown){const input=parseBookingRequest(value);return this.owner(token,owner,async(tx,actor)=>{
  const existing=(await tx.query<{id:string}>('select id from app.booking_requests where guest_id=$1 and creation_key=$2',[actor,input.creationKey])).rows[0];
  if(existing){const row=await this.locate(tx,actor,existing.id);if(row.guest!==actor||row.listingId!==input.listingId||row.terms.listingRevision!==input.expectedListingRevision||row.mode!==input.mode||row.startDate!==input.startDate||row.endDate!==input.endDate||row.guests!==input.guests)throw new BookingConflictError();return display(row,actor);}
  const listing=await this.current(tx,actor,input.listingId);if(listing.revision!==input.expectedListingRevision)throw new BookingConflictError();
  const quote=quoteBookingRequest(listing.booking,input,listing.today);await this.available(tx,input,listing.booking);
  const terms=JSON.stringify({listingRevision:listing.revision,title:listing.title,booking:listing.booking});if(Buffer.byteLength(terms,'utf8')>16384)throw new BookingQuoteError();
  const {id}=(await tx.query<{id:string}>(`insert into app.booking_requests(listing_id,guest_id,creation_key,mode,start_date,end_date,guests,total,details_snapshot)
   values($1,$2,$3,$4,$5::date,$6::date,$7,$8::numeric,$9::jsonb) returning id`,[listing.id,actor,input.creationKey,input.mode,input.startDate,input.endDate,input.guests,quote.total,terms])).rows[0];
  await enqueueNotificationInTransaction(tx,listing.author,{eventKey:`booking_request:${id}`,category:'booking',tone:'info',title:'Новая заявка на бронирование',body:'Проверьте даты и условия заявки в личном кабинете.',actionHref:'/cabinet/bronirovaniya',bookingRequestId:id});
  const saved=display(await this.row(tx,actor,id),actor);await this.finish(tx,listing.id,input);return saved;
 });}
 read(token:string,owner:string,value:unknown){const id=parseListingDraftId(value);return this.owner(token,owner,async(tx,actor)=>display(await this.locate(tx,actor,id),actor));}
 readIntent(token:string,owner:string,value:unknown){const key=parseListingDraftId(value);return this.owner(token,owner,async(tx,actor)=>{const found=(await tx.query<{id:string}>('select id from app.booking_requests where guest_id=$1 and creation_key=$2',[actor,key])).rows[0];return found?display(await this.locate(tx,actor,found.id),actor):null;});}
 decide(token:string,owner:string,value:unknown,expected:unknown,state:unknown){const id=parseListingDraftId(value),revision=parseListingDraftRevision(expected);if(state!=='accepted'&&state!=='declined')throw new BookingRequestInputError();
  return this.owner(token,owner,async(tx,actor)=>{
   const initial=await this.row(tx,actor,id,false);if(initial.host!==actor||initial.guest===actor)throw new BookingAccessError();await this.peer(tx,initial.guest,state==='accepted');const row=await this.locate(tx,actor,id);
   if(row.host!==actor)throw new BookingAccessError();if(row.status===state&&BigInt(row.revision)===BigInt(revision)+BigInt(1))return display(row,actor);
   if(row.status!=='pending'||row.revision!==revision)throw new BookingConflictError();let accepting:BookingRequestInput|null=null;
   if(state==='accepted'){const listing=await readBookableListing(tx,row.listingId);if(!listing)throw new BookingAccessError();accepting={listingId:row.listingId,creationKey:row.creationKey,expectedListingRevision:listing.revision,mode:row.mode,startDate:row.startDate,endDate:row.endDate,guests:row.guests};
    quoteBookingRequest(listing.booking,accepting,listing.today);await this.available(tx,accepting,listing.booking,id);}
   const changed=await tx.query('update app.booking_requests set status=$2,revision=revision+1,decided_at=clock_timestamp(),updated_at=clock_timestamp() where id=$1 and revision=$3::bigint and revision<9223372036854775807',[id,state,revision]);if(changed.rowCount!==1)throw new BookingConflictError();
   await enqueueNotificationInTransaction(tx,row.guest,{eventKey:`booking_decision:${id}:${state}`,category:'booking',tone:state==='accepted'?'success':'warning',title:state==='accepted'?'Бронирование подтверждено':'Бронирование отклонено',body:'Владелец ответил на вашу заявку. Условия доступны в личном кабинете.',actionHref:'/cabinet/bronirovaniya',bookingRequestId:id});
   const saved=display(await this.row(tx,actor,id),actor);if(accepting)await this.finish(tx,row.listingId,accepting);return saved;
  });
 }
 list(token:string,owner:string,mode:unknown,after:unknown):Promise<BookingPage>{if(mode!=='guest'&&mode!=='host')throw new BookingRequestInputError();const cursor=parseListingDraftCursor(after);
  return this.owner(token,owner,async(tx,actor)=>{const rows=(await tx.query<Omit<BookingSummary,'view'|'listing'>&{listingId:string;title:string}>(`select b.id,b.revision::text as revision,b.listing_id as "listingId",b.details_snapshot->>'title' as title,b.mode,b.start_date::text as "startDate",b.end_date::text as "endDate",b.guests,b.total::text as total,b.status,${stamp('b.created_at')} as "createdAt"
   ${source} where ${mode==='guest'?'b.guest_id=$1':'l.author_id=$1 and b.guest_id<>$1'} ${cursor?'and (b.created_at,b.id)<($2::timestamptz,$3::uuid)':''} order by b.created_at desc,b.id desc limit 21`,cursor?[actor,cursor.updatedAt,cursor.id]:[actor])).rows;
   const items=rows.slice(0,20).map<BookingSummary>(({listingId,title,...row})=>({...row,view:mode,listing:{id:listingId,title}})),last=items.at(-1);return{items,nextCursor:rows.length>20&&last?{id:last.id,updatedAt:last.createdAt}:null};
  });
 }
}
