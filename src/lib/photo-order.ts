import {parseListingDraftId} from './listing-draft-contract.ts';
export type PhotoOrder=({savedId:string}|{uploadIndex:number})[];
/** Capture a complete permutation, never an extra media ID or an omitted upload. */
export function parsePhotoOrder(value:unknown,savedIds:string[],fileCount:number):PhotoOrder{
 const natural:PhotoOrder=[...savedIds.map(savedId=>({savedId})),...Array.from({length:fileCount},(_,uploadIndex)=>({uploadIndex}))];
 if(value===null||value===undefined)return natural;
 let input:unknown=value;try{if(typeof value==='string')input=JSON.parse(value);}catch{throw Error('Проверьте порядок фотографий.');}
 if(!Array.isArray(input)||input.length!==natural.length)throw Error('Проверьте порядок фотографий.');
 const saved=new Set(savedIds),seen=new Set<string>();
 return input.map(item=>{
  if(!item||typeof item!=='object'||Object.keys(item).length!==1)throw Error('Проверьте порядок фотографий.');
  if(Object.hasOwn(item,'savedId')){
   const id=parseListingDraftId(item.savedId);if(!saved.has(id)||seen.has(id))throw Error('Проверьте сохранённые фотографии.');seen.add(id);return{savedId:id};
  }
  const index=item.uploadIndex,key='upload:'+index;
  if(!Number.isSafeInteger(index)||index<0||index>=fileCount||seen.has(key))throw Error('Проверьте новые фотографии.');seen.add(key);return{uploadIndex:index};
 });
}
export function resolvePhotoOrder(order:PhotoOrder,uploadedIds:string[]):string[]{return order.map(item=>'savedId'in item?item.savedId:uploadedIds[item.uploadIndex]);}
