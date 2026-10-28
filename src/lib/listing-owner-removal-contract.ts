import {ListingDraftInputError,parseListingDraftId,parseListingDraftRevision} from './listing-draft-contract.ts';

export type ListingOwnerRemovalRequest={action:'read'|'remove';expectedOwnerId:string;listingId:string;expectedRevision:string};
export type ListingOwnerRemovalResult={id:string;revision:string;removed:boolean};
export function parseListingOwnerRemovalRequest(value:unknown):ListingOwnerRemovalRequest{
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw new ListingDraftInputError();
 const row=value as Record<string,unknown>;
 if(Reflect.ownKeys(row).length!==4||Object.keys(row).sort().join()!=='action,expectedOwnerId,expectedRevision,listingId'||(row.action!=='read'&&row.action!=='remove'))throw new ListingDraftInputError();
 return{action:row.action,expectedOwnerId:parseListingDraftId(row.expectedOwnerId),listingId:parseListingDraftId(row.listingId),expectedRevision:parseListingDraftRevision(row.expectedRevision)};
}
export function parseListingOwnerRemovalResult(value:unknown,id:string,revision:string):ListingOwnerRemovalResult{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join()!=='id,removed,revision')throw new ListingDraftInputError();
 const row=value as Record<string,unknown>;
 if(row.id!==id||row.revision!==revision||typeof row.removed!=='boolean')throw new ListingDraftInputError();
 return{id:parseListingDraftId(row.id),revision:parseListingDraftRevision(row.revision),removed:row.removed};
}
