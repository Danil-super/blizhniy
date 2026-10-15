import {ListingDraftInputError,parseListingDraftId} from "./listing-draft-contract.ts";

export type ListingDraftPhoto={id:string;mimeType:"image/webp";width:number;height:number;size:number};
export type ListingDraftPhotos={id:string;revision:string;photos:ListingDraftPhoto[]};

/** Existing global media budget bounds SQL work; no URL/path or client metadata authority. */
export function parseListingPhotoIds(value:unknown):string[]{
  if(!Array.isArray(value)||value.length>10000)throw new ListingDraftInputError();
  const ids:string[]=[];
  for(const item of value){
    const id=parseListingDraftId(item);
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id))throw new ListingDraftInputError();
    ids.push(id);
  }
  if(new Set(ids).size!==ids.length)throw new ListingDraftInputError();
  return ids;
}
