import {parseListingDraftId} from './listing-draft-contract.ts';
import {validPlainText} from './cabinet-field-validation.ts';
export type PublicProfession={id:string;slug:string;name:string;parent:string;active:true};
export const maxPublicProfessions=1000;
export function parseProfessionCatalog(value:unknown):PublicProfession[]{
 if(!Array.isArray(value)||value.length>maxPublicProfessions)throw Error('Profession catalog unavailable');
 const items=value.map(item=>{
  if(!item||typeof item!=='object'||Array.isArray(item)||![Object.prototype,null].includes(Object.getPrototypeOf(item))||
   Reflect.ownKeys(item).length!==5||!['id','slug','name','parent','active'].every(key=>Object.hasOwn(item,key)))throw Error('Profession catalog unavailable');
  const row=item as Record<string,unknown>;
  if(typeof row.slug!=='string'||row.slug.length>150||!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(row.slug)||row.active!==true||
   [row.name,row.parent].some(text=>typeof text!=='string'||!text||text!==text.trim()||text.length>200||!validPlainText(text)))throw Error('Profession catalog unavailable');
  return {id:parseListingDraftId(row.id),slug:row.slug,name:row.name as string,parent:row.parent as string,active:true as const};
 });
 if(new Set(items.map(item=>item.id)).size!==items.length||new Set(items.map(item=>item.slug)).size!==items.length)throw Error('Profession catalog unavailable');
 return items;
}
/** Legacy clients use strict DTO key sets. Response capability changes shape, never authority. */
export function professionWireView(value:unknown,enabled:boolean):unknown{
 if(enabled||!value||typeof value!=='object')return value;
 if(Array.isArray(value))return value.map(item=>professionWireView(item,false));
 return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='professionId').map(([key,item])=>[key,professionWireView(item,false)]));
}
/** Only a stable selected UUID makes a label derived metadata; every other field stays exact. */
export function sameProfessionForm(left:unknown,right:unknown):boolean{
 const a=left as Record<string,unknown>,b=right as Record<string,unknown>;
 if(a?.professionId&&a.professionId===b?.professionId){
  try{parseListingDraftId(a.professionId);}catch{return false;}
  return JSON.stringify({...a,professionName:null})===JSON.stringify({...b,professionName:null});
 }
 return JSON.stringify(left)===JSON.stringify(right);
}
