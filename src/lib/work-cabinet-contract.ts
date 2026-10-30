import {ListingDraftInputError,parseListingDraft,parseListingDraftId,parseListingDraftRevision,parseListingDraftCursor,type ListingDraftCursor} from './listing-draft-contract.ts';
import type {WorkPublicationKind} from './work-publication-contract';

const statuses=['draft','pending_payment','paid','published','archived','expired','rejected','assigned'] as const;
export type WorkCabinetStatus=typeof statuses[number];
export type WorkCabinetItem={id:string;kind:WorkPublicationKind;revision:string;status:WorkCabinetStatus;paid:boolean;title:string;updatedAt:string;
 amount:string|null;organization:string|null;city:string|null;district:string|null;profession:string|null;schedule:string|null;workFormat:string|null;coverPhotoId:string|null};
export type WorkCabinetPage={items:WorkCabinetItem[];nextCursor:ListingDraftCursor|null};
const isWorkCabinetStatus=(value:unknown):value is WorkCabinetStatus=>typeof value==='string'&&statuses.includes(value as WorkCabinetStatus);
export function parseWorkCabinetStatus(value:unknown):WorkCabinetStatus{
 if(!isWorkCabinetStatus(value))throw new ListingDraftInputError();return value;
}
function exact(value:unknown,keys:string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||
  Reflect.ownKeys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))throw new ListingDraftInputError();
 return value as Record<string,unknown>;
}
function text(value:unknown,max:number):string|null{
 if(value===null)return null;
 if(typeof value!=='string'||value.length>max||!value.isWellFormed()||/[\u0000-\u001f\u007f]/.test(value))throw new ListingDraftInputError();
 return value;
}
/** Owner-only card projection; private contacts, legal requisites and arbitrary media URLs are never bulk-listed. */
export function parseWorkCabinetPage(value:unknown,kind:WorkPublicationKind):WorkCabinetPage{
 if(!['vacancy','workRequest'].includes(kind))throw new ListingDraftInputError();
 const page=exact(value,['items','nextCursor']);
 if(!Array.isArray(page.items)||page.items.length>20)throw new ListingDraftInputError();
 const items=page.items.map(value=>{
  const row=exact(value,['id','kind','revision','status','paid','title','updatedAt','amount','organization','city','district','profession','schedule','workFormat','coverPhotoId']);
  if(row.kind!==kind||typeof row.paid!=='boolean'||!isWorkCabinetStatus(row.status)||typeof row.title!=='string')throw new ListingDraftInputError();
  const id=parseListingDraftId(row.id),stamp=parseListingDraftCursor({id,updatedAt:row.updatedAt})!;
  const amount=parseListingDraft({kind:'prodam',price:row.amount}).price;
  if(amount!==row.amount)throw new ListingDraftInputError();
  return {id,kind,revision:parseListingDraftRevision(row.revision),status:row.status,paid:row.paid,title:text(row.title,120)!,updatedAt:stamp.updatedAt,
   amount,organization:text(row.organization,200),city:text(row.city,160),district:text(row.district,160),profession:text(row.profession,200),
   schedule:text(row.schedule,160),workFormat:text(row.workFormat,160),coverPhotoId:row.coverPhotoId===null?null:parseListingDraftId(row.coverPhotoId)};
 });
 if(new Set(items.map(item=>item.id)).size!==items.length)throw new ListingDraftInputError();
 const nextCursor=parseListingDraftCursor(page.nextCursor),last=items.at(-1);
 if(nextCursor&&(items.length!==20||nextCursor.id!==last?.id||nextCursor.updatedAt!==last.updatedAt))throw new ListingDraftInputError();
 return{items,nextCursor};
}
