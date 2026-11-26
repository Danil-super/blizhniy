import {withAppSessionTransaction} from './app-session-transaction';
import {ListingDraftAccessError,ListingDraftConflictError} from './postgres-listing-drafts';
import {parseListingDraftId,parseListingDraftRevision,ListingDraftInputError} from './listing-draft-contract.ts';
import type {PostgresDatabase} from './postgres';
export class PostgresListingOwnerActions {
 constructor(private readonly db:Pick<PostgresDatabase,'transaction'>){}
 async change(token:string,owner:string,value:unknown,expected:unknown,action:unknown){
  const id=parseListingDraftId(value),revision=parseListingDraftRevision(expected);
  if(action!=='withdraw'&&action!=='restore')throw new ListingDraftInputError();
  return withAppSessionTransaction(this.db,token,async(tx,user)=>{
   if(user.id!==owner)throw new ListingDraftAccessError();
   // Match financial writers: immutable intent before the listing. Re-read the
   // order after acquiring that lock; a pre-wait snapshot may predate a refund.
   const payments=(await tx.query<{id:string}>(`select i.id from app.payment_checkout_intents i
    join app.payment_fulfillments f on f.intent_id=i.id join app.listings l on l.id=i.target_id and l.author_id=i.owner_id
    where i.target_type='listing' and i.target_id=$1 and i.owner_id=$2 and f.published_at=l.published_at and f.expires_at=l.expires_at
    order by i.id limit 2 for update of i`,[id,owner])).rows;
   if(payments.length!==1)throw new ListingDraftAccessError();
   const payment=(await tx.query<{status:string}>('select status from app.payment_orders where id=$1',[payments[0].id])).rows[0];
   if(!payment||(action==='restore'&&payment.status!=='succeeded'))throw new ListingDraftAccessError();
   const locked=await tx.query('select id from app.listings where id=$1 and author_id=$2 for update',[id,owner]);
   if(locked.rowCount!==1)throw new ListingDraftAccessError();
   // Read the term and moderation state after the wait, including on an idempotent request.
   const row=(await tx.query<{id:string;revision:string;status:string;live:boolean;blocked:boolean}>(`select id,revision::text,status,
    (is_paid and published_at<=statement_timestamp() and expires_at>statement_timestamp()) as live,
    exists(select 1 from app.listing_blocks b where b.listing_id=l.id) as blocked
    from app.listings l where id=$1 and author_id=$2`,[id,owner])).rows[0];
   if(!row||row.blocked||!row.live||!['published','archived'].includes(row.status))throw new ListingDraftAccessError();
   if(row.revision!==revision||revision==='9223372036854775807')throw new ListingDraftConflictError();
   const status=action==='withdraw'?'archived':'published';
   if(row.status===status)return{id,revision,status};
   const result=await tx.query<{id:string;revision:string;status:string}>(`update app.listings set status=$4,revision=revision+1,updated_at=clock_timestamp()
    where id=$1 and author_id=$2 and revision=$3::bigint and expires_at>clock_timestamp()
    returning id,revision::text,status`,[id,owner,revision,status]);
   if(result.rowCount!==1)throw new ListingDraftAccessError();
   return result.rows[0];
  });
 }
}
