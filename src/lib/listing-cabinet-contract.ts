import {parseListingDraft,parseListingDraftCursor,parseListingDraftId,parseListingDraftRevision,type ListingDraftCursor,type ListingDraftSummary} from './listing-draft-contract.ts';
export type ListingCabinetStatus='draft'|'pending_payment'|'paid'|'published'|'sold'|'archived'|'expired'|'blocked';
export type ListingCabinetSummary=ListingDraftSummary&{card:{city:string|null;district:string|null;coverPhotoId:string|null;status:ListingCabinetStatus;blockReason:string|null}};
export type ListingCabinetPage={items:ListingCabinetSummary[];nextCursor:ListingDraftCursor|null;workflow:'pre-moderation'|'postmoderation'};
const statuses=['draft','pending_payment','paid','published','sold','archived','expired','blocked'];
function object(value:unknown,keys:string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join()!==keys.sort().join())throw Error('Invalid cabinet snapshot');
 return value as Record<string,unknown>;
}
function text(value:unknown,limit:number):string|null{
 if(value===null)return null;
 if(typeof value!=='string'||!value.trim()||value.trim()!==value||value.length>limit||!value.isWellFormed()||/[\x00-\x1f\x7f]/.test(value))throw Error('Invalid cabinet text');
 return value;
}
export function parseListingCabinetPage(value:unknown):ListingCabinetPage{
 const page=object(value,['items','nextCursor','workflow']);
 if(!Array.isArray(page.items)||page.items.length>20||!['pre-moderation','postmoderation'].includes(page.workflow as string))throw Error('Invalid cabinet page');
 const items=page.items.map(value=>{
  const row=object(value,['id','revision','kind','title','price','card']),card=object(row.card,['city','district','coverPhotoId','status','blockReason']);
  const core=parseListingDraft({kind:row.kind,title:row.title,price:row.price}),id=parseListingDraftId(row.id);
  if(core.title!==row.title||core.price!==row.price||id!==row.id||!statuses.includes(card.status as string))throw Error('Invalid cabinet item');
  const blockReason=text(card.blockReason,1000);
  if((card.status==='blocked')!==(blockReason!==null))throw Error('Invalid blocking state');
  return{id,revision:parseListingDraftRevision(row.revision),kind:core.kind,title:core.title,price:core.price,card:{city:text(card.city,160),district:text(card.district,160),coverPhotoId:card.coverPhotoId===null?null:parseListingDraftId(card.coverPhotoId),status:card.status as ListingCabinetStatus,blockReason}};
 });
 const nextCursor=parseListingDraftCursor(page.nextCursor);
 if(new Set(items.map(item=>item.id)).size!==items.length||nextCursor&&(items.length!==20||nextCursor.id!==items.at(-1)?.id))throw Error('Invalid cabinet cursor');
 return{items,nextCursor,workflow:page.workflow as ListingCabinetPage['workflow']};
}
