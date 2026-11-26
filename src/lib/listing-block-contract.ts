import {parseListingDraft,parseListingDraftId,parseListingDraftRevision,type ListingDraftInput} from './listing-draft-contract.ts';

export class ListingBlockInputError extends Error {
 constructor(){super('Listing block input invalid');this.name='ListingBlockInputError';}
}
export class ListingManagementNotFoundError extends Error {constructor(){super('Listing not found');this.name='ListingManagementNotFoundError';}}
export class ListingManagementConflictError extends Error {constructor(){super('Listing changed');this.name='ListingManagementConflictError';}}
export function parseListingBlockReason(value:unknown):string {
 if(typeof value!=='string'||!value.isWellFormed()||value!==value.trim()||value.length<1||value.length>1000||/[\x00-\x1f\x7f]/.test(value))throw new ListingBlockInputError();
 return value;
}
export type ListingManagementItem={id:string;revision:string;title:string;status:string;paid:boolean;blocked:boolean;blockReason:string|null;blockedAt:string|null};
export type ListingManagementCard={kind:ListingDraftInput['kind'];price:string|null;city:string|null;district:string|null;coverPhotoId:string|null};
export type ListingManagementSummary=ListingManagementItem&{card?:ListingManagementCard};
export type ListingManagementPage={items:ListingManagementSummary[];nextCursor:string|null};
export function parseListingManagementItem(value:unknown):ListingManagementItem {
 if(!value||typeof value!=='object'||Array.isArray(value))throw new ListingBlockInputError();
 const row=value as ListingManagementItem;
 if(Object.keys(row).sort().join()!=='blockReason,blocked,blockedAt,id,paid,revision,status,title'||typeof row.title!=='string'||row.title.length>160||!row.title.isWellFormed()||
 !['draft','pending_payment','paid','published','sold','archived','expired','rejected','removed'].includes(row.status)||typeof row.paid!=='boolean'||typeof row.blocked!=='boolean'||
 (row.blocked?(parseListingBlockReason(row.blockReason)!==row.blockReason||typeof row.blockedAt!=='string'||!Number.isFinite(Date.parse(row.blockedAt))):(row.blockReason!==null||row.blockedAt!==null)))throw new ListingBlockInputError();
 return {...row,id:parseListingDraftId(row.id),revision:parseListingDraftRevision(row.revision)};
}
/** Additive list-only presentation; inspect/block keep their original strict contract. */
export function parseListingManagementSummary(value:unknown):ListingManagementSummary {
 if(!value||typeof value!=='object'||Array.isArray(value))throw new ListingBlockInputError();
 const {card,...base}=value as ListingManagementSummary;
 const listing=parseListingManagementItem(base);
 if(!Object.hasOwn(value,'card'))return listing;
 if(!card||typeof card!=='object'||Array.isArray(card)||Object.keys(card).sort().join()!=='city,coverPhotoId,district,kind,price')throw new ListingBlockInputError();
 const draft=parseListingDraft({kind:card.kind,price:card.price});
 if(draft.price!==card.price)throw new ListingBlockInputError();
 for(const text of [card.city,card.district])if(text!==null&&(typeof text!=='string'||!text.trim()||text!==text.trim()||text.length>160||!text.isWellFormed()||/[\x00-\x1f\x7f]/.test(text)))throw new ListingBlockInputError();
 const cover=card.coverPhotoId===null?null:parseListingDraftId(card.coverPhotoId);
 if(cover!==card.coverPhotoId)throw new ListingBlockInputError();
 return {...listing,card:{kind:draft.kind,price:draft.price,city:card.city,district:card.district,coverPhotoId:cover}};
}
