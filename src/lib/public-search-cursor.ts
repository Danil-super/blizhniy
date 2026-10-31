import {createHash} from 'node:crypto';
import {parseListingDraftId,parseListingDraftCursor} from './listing-draft-contract.ts';
import {PublicSearchError,type PublicSearchInput} from './public-search-contract.ts';
export type PublicSearchAnchor={id:string;rank:number;publishedAt:string|null;createdAt:string|null;sortOrder:number;parent:string;name:string};
type Cursor=PublicSearchAnchor&{direction:'next'|'previous'};
const keys=['id','rank','publishedAt','createdAt','sortOrder','parent','name','direction','binding'];
const binding=(input:PublicSearchInput)=>createHash('sha256').update(JSON.stringify([input.query,input.cityName??null])).digest('hex');
function parse(value:unknown,input:PublicSearchInput):Cursor{
 try{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))throw Error();
  const row=value as Cursor&{binding:string};
  if(row.binding!==binding(input)||!Number.isSafeInteger(row.rank)||row.rank<1||row.rank>7||!['next','previous'].includes(row.direction)||
   !Number.isSafeInteger(row.sortOrder)||row.sortOrder<0||row.sortOrder>2147483647||[row.parent,row.name].some(text=>typeof text!=='string'||text.length>200||!text.isWellFormed()||/[\u0000-\u001f\u007f]/.test(text)))throw Error();
  const id=parseListingDraftId(row.id);
  if(row.rank<=5){
   parseListingDraftCursor({id,updatedAt:row.publishedAt});parseListingDraftCursor({id,updatedAt:row.createdAt});
   if(row.parent||row.name||row.sortOrder!==0)throw Error();
  }else if(row.publishedAt!==null||row.createdAt!==null||!row.name||row.rank===6&&row.parent!==''||row.rank===7&&(!row.parent||row.sortOrder!==0))throw Error();
  return{id,rank:row.rank,publishedAt:row.publishedAt,createdAt:row.createdAt,sortOrder:row.sortOrder,parent:row.parent,name:row.name,direction:row.direction};
 }catch{throw new PublicSearchError();}
}
/** Position metadata only, never authority. Every decoded value remains a SQL parameter. */
export function encodePublicSearchCursor(anchor:PublicSearchAnchor,input:PublicSearchInput,direction:'next'|'previous'){
 const value={...anchor,direction,binding:binding(input)};parse(value,input);
 const result=Buffer.from(JSON.stringify(value)).toString('base64url');if(result.length>4096)throw new PublicSearchError();return result;
}
export function decodePublicSearchCursor(text:string,input:PublicSearchInput):Cursor{
 try{if(!/^[A-Za-z0-9_-]+$/.test(text)||text.length>4096)throw Error();const bytes=Buffer.from(text,'base64url');
  if(bytes.toString('base64url')!==text)throw Error();return parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),input);
 }catch{throw new PublicSearchError();}
}
