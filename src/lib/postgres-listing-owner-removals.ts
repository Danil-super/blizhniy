import {AppSessionAccessError,withAppSessionTransaction} from './app-session-transaction';
import {hashSessionToken} from './identity';
import {ListingDraftAccessError,ListingDraftConflictError} from './postgres-listing-drafts';
import {ListingDraftInputError,parseListingDraftId,parseListingDraftRevision} from './listing-draft-contract.ts';
import type {DraftRemovalTarget,ListingOwnerRemovalResult} from './listing-owner-removal-contract.ts';
import type {PostgresDatabase} from './postgres';

export class DraftRemovalCheckoutActiveError extends Error {
 constructor(){super('Resolve checkout before removing the draft');this.name='DraftRemovalCheckoutActiveError';}
}

/** Owner removal keeps publication and financial history. */
export class PostgresListingOwnerRemovalStore{
 constructor(private readonly db:Pick<PostgresDatabase,'transaction'>){if(typeof window!=='undefined')throw Error('Listing removal is server-only');}
 private async inspect(token:string,expectedOwner:string,value:unknown,expected:unknown,writing:boolean,target?:DraftRemovalTarget):Promise<ListingOwnerRemovalResult>{
  const id=parseListingDraftId(value),revision=parseListingDraftRevision(expected),owner=parseListingDraftId(expectedOwner);
  if(target!==undefined){
   if(target!=='listing'&&target!=='marquee')throw new ListingDraftInputError();
   const hash=hashSessionToken(token);
   if(!hash)throw new AppSessionAccessError();
   try{
    const result=await this.db.transaction(tx=>tx.query<{removed:boolean}>(
     'select app.remove_unpaid_draft($1,$2,$3,$4,$5::bigint,$6) as removed',[hash,owner,target,id,revision,writing]));
    const removed=result.rows[0]?.removed;
    if(typeof removed!=='boolean'||(writing&&!removed))throw Error('Draft removal result unavailable');
    return{id,revision,removed};
   }catch(error){
    const code=error&&typeof error==='object'&&'code' in error?error.code:null;
    if(code==='PDR01')throw new ListingDraftAccessError();
    if(code==='PDR02')throw new ListingDraftConflictError();
    if(code==='PDR03')throw new DraftRemovalCheckoutActiveError();
    if(code==='PDR04')throw new AppSessionAccessError();
    throw error;
   }
  }
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
 read(token:string,owner:string,id:unknown,revision:unknown,target?:DraftRemovalTarget){return this.inspect(token,owner,id,revision,false,target);}
 remove(token:string,owner:string,id:unknown,revision:unknown,target?:DraftRemovalTarget){return this.inspect(token,owner,id,revision,true,target);}
}
