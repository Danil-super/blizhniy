import {ListingDraftInputError,parseListingDraftId,parseListingDraftRevision} from './listing-draft-contract.ts';

export type DraftRemovalTarget='listing'|'marquee';
export type ListingOwnerRemovalRequest={action:'read'|'remove';expectedOwnerId:string;listingId:string;expectedRevision:string;target?:DraftRemovalTarget};
export type ListingOwnerRemovalResult={id:string;revision:string;removed:boolean};
export function parseListingOwnerRemovalRequest(value:unknown):ListingOwnerRemovalRequest{
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw new ListingDraftInputError();
 const row=value as Record<string,unknown>;
 const targeted=Object.hasOwn(row,'target');
 const keys=targeted?'action,expectedOwnerId,expectedRevision,listingId,target':'action,expectedOwnerId,expectedRevision,listingId';
 if(Reflect.ownKeys(row).length!==(targeted?5:4)||Object.keys(row).sort().join()!==keys||(row.action!=='read'&&row.action!=='remove'))throw new ListingDraftInputError();
 const result:ListingOwnerRemovalRequest={action:row.action,expectedOwnerId:parseListingDraftId(row.expectedOwnerId),listingId:parseListingDraftId(row.listingId),expectedRevision:parseListingDraftRevision(row.expectedRevision)};
 if(!targeted)return result;
 if(row.target!=='listing'&&row.target!=='marquee')throw new ListingDraftInputError();
 return{...result,target:row.target};
}
export function parseListingOwnerRemovalResult(value:unknown,id:string,revision:string):ListingOwnerRemovalResult{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join()!=='id,removed,revision')throw new ListingDraftInputError();
 const row=value as Record<string,unknown>;
 if(row.id!==id||row.revision!==revision||typeof row.removed!=='boolean')throw new ListingDraftInputError();
 return{id:parseListingDraftId(row.id),revision:parseListingDraftRevision(row.revision),removed:row.removed};
}
