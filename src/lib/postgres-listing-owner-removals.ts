import {withAppSessionTransaction} from './app-session-transaction';
import {ListingDraftAccessError,ListingDraftConflictError} from './postgres-listing-drafts';
import {parseListingDraftId,parseListingDraftRevision} from './listing-draft-contract.ts';
import type {ListingOwnerRemovalResult} from './listing-owner-removal-contract.ts';
import type {PostgresDatabase} from './postgres';

/** Only hides an already blocked item from its owner's cabinet. No destructive/financial writes. */
export class PostgresListingOwnerRemovalStore{
 constructor(private readonly db:Pick<PostgresDatabase,'transaction'>){if(typeof window!=='undefined')throw Error('Listing removal is server-only');}
 private inspect(token:string,expectedOwner:string,value:unknown,expected:unknown,writing:boolean):Promise<ListingOwnerRemovalResult>{
  const id=parseListingDraftId(value),revision=parseListingDraftRevision(expected),owner=parseListingDraftId(expectedOwner);
  return withAppSessionTransaction(this.db,token,async(tx,user)=>{
   if(user.id!==owner)throw new ListingDraftAccessError();
   const row=(await tx.query<{id:string;revision:string;blocked:boolean}>(`select l.id,l.revision::text as revision,
    exists(select 1 from app.listing_blocks b where b.listing_id=l.id) as blocked
    from app.listings l where l.id=$1 and l.author_id=$2 for update of l`,[id,owner])).rows[0];
   if(!row||!row.blocked)throw new ListingDraftAccessError();
   const removed=(await tx.query<{revision:string}>('select removed_revision::text as revision from app.listing_owner_removals where listing_id=$1 and owner_id=$2',[id,owner])).rows[0];
   if(removed){if(removed.revision!==revision)throw new ListingDraftConflictError();return{id,revision,removed:true};}
   if(row.revision!==revision)throw new ListingDraftConflictError();
   if(writing)await tx.query('insert into app.listing_owner_removals(listing_id,owner_id,removed_revision) values($1,$2,$3::bigint)',[id,owner,revision]);
   return{id,revision,removed:writing};
  });
 }
 read(token:string,owner:string,id:unknown,revision:unknown){return this.inspect(token,owner,id,revision,false);}
 remove(token:string,owner:string,id:unknown,revision:unknown){return this.inspect(token,owner,id,revision,true);}
}
