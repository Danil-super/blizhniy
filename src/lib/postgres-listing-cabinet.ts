import {withAppSessionTransaction,AppSessionAccessError} from './app-session-transaction';
import {parseListingDraftCursor,parseListingDraftId} from './listing-draft-contract.ts';
import {parseListingCabinetPage,type ListingCabinetPage,type ListingCabinetSummary} from './listing-cabinet-contract.ts';
import type {PostgresDatabase} from './postgres';
type Row={id:string;revision:string;kind:ListingCabinetSummary['kind'];title:string;price:string|null;city:string|null;district:string|null;coverPhotoId:string|null;status:ListingCabinetSummary['card']['status'];blockReason:string|null;updatedAt:string};
/** Owner's lifecycle projection. Private photos remain cookie-protected, never public draft URLs. */
export class PostgresListingCabinetStore{
 constructor(private readonly db:Pick<PostgresDatabase,'transaction'>,private readonly postmoderation=false){}
 list(token:string,expectedOwner:string,after:unknown):Promise<ListingCabinetPage>{
  const expected=parseListingDraftId(expectedOwner),cursor=parseListingDraftCursor(after);
  return withAppSessionTransaction(this.db,token,async(tx,user)=>{
   if(user.id!==expected)throw new AppSessionAccessError();
   const rows=(await tx.query<Row>(`select l.id,l.revision::text,
    case l.listing_type when 'sell' then 'prodam' when 'buy' then 'kuplyu' when 'rent' then 'arenda' when 'free' then 'otdam-darom' end as kind,
    l.title,l.price::text,city.name as city,l.district,
    (select p.media_id from app.listing_photos p join app.media_objects m on m.id=p.media_id and m.owner_id=l.author_id and m.state='ready' where p.listing_id=l.id order by p.position limit 1) as "coverPhotoId",
    case ${this.postmoderation?"when block.listing_id is not null then 'blocked'":""}
     when l.status='published' and l.expires_at<=clock_timestamp() then 'expired'
     when l.status='published' and l.is_paid and l.published_at<=clock_timestamp() and l.expires_at>clock_timestamp() then 'published'
     when l.status in ('sold','archived','expired') then l.status::text
     when exists(select 1 from app.payment_orders p where p.target_type='listing' and p.target_id=l.id and p.owner_id=l.author_id and p.status='succeeded') then 'paid'
     when exists(select 1 from app.payment_orders p where p.target_type='listing' and p.target_id=l.id and p.owner_id=l.author_id and p.status in ('created','pending')) then 'pending_payment'
     else 'draft' end as status,${this.postmoderation?'block.reason':'null::text'} as "blockReason",
    to_char(l.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "updatedAt"
    from app.listings l left join app.cities city on city.id=l.city_id
    ${this.postmoderation?'left join app.listing_blocks block on block.listing_id=l.id':''}
    where l.author_id=$1 ${this.postmoderation?'and not exists(select 1 from app.listing_owner_removals removed where removed.listing_id=l.id)':''} ${cursor?'and (l.updated_at,l.id)<($2::timestamptz,$3::uuid)':''}
    order by l.updated_at desc,l.id desc limit 21`,cursor?[user.id,cursor.updatedAt,cursor.id]:[user.id])).rows;
   const page=rows.slice(0,20),last=page.at(-1);
   return parseListingCabinetPage({items:page.map(row=>({id:row.id,revision:row.revision,kind:row.kind,title:row.title,price:row.price,card:{city:row.city,district:row.district,coverPhotoId:row.coverPhotoId,status:row.status,blockReason:row.blockReason}})),nextCursor:rows.length>20&&last?{id:last.id,updatedAt:last.updatedAt}:null,workflow:this.postmoderation?'postmoderation':'pre-moderation'});
  });
 }
}
