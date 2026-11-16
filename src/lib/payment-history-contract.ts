import {parseListingDraftCursor,parseListingDraftId} from './listing-draft-contract.ts';

export const paymentHistoryPageSize=50;
export const paymentHistoryTargets=['listing','vacancy','workRequest','specialist','application','fair_application','ad_marquee'] as const;
export const paymentHistoryStatuses=['created','pending','succeeded','failed','refunded'] as const;
export type PaymentHistoryCursor={id:string;createdAt:string};
export type PaymentHistoryItem={id:string;targetType:typeof paymentHistoryTargets[number];amount:string;status:typeof paymentHistoryStatuses[number];isTest:boolean;createdAt:string};
export type PaymentHistoryPage={items:PaymentHistoryItem[];nextCursor:PaymentHistoryCursor|null};
function exact(value:unknown,keys:string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join()!==[...keys].sort().join())throw Error('Invalid payment history');
 return value as Record<string,unknown>;
}
export function parsePaymentHistoryCursor(value:unknown):PaymentHistoryCursor|null{
 if(value===null)return null;
 const row=exact(value,['id','createdAt']),parsed=parseListingDraftCursor({id:row.id,updatedAt:row.createdAt})!;
 return{id:parsed.id,createdAt:parsed.updatedAt};
}
export function parsePaymentHistoryInput(value:unknown){
 const row=exact(value,['expectedOwnerId','cursor']);
 return{expectedOwnerId:parseListingDraftId(row.expectedOwnerId),cursor:parsePaymentHistoryCursor(row.cursor)};
}
const before=(left:PaymentHistoryCursor,right:PaymentHistoryCursor)=>left.createdAt<right.createdAt||left.createdAt===right.createdAt&&left.id<right.id;
export function parsePaymentHistoryPage(value:unknown,cursor:PaymentHistoryCursor|null):PaymentHistoryPage{
 const page=exact(value,['items','nextCursor']);
 if(!Array.isArray(page.items)||page.items.length>paymentHistoryPageSize)throw Error('Invalid payment history');
 let previous=cursor;
 const items=page.items.map(value=>{
  const row=exact(value,['id','targetType','amount','status','isTest','createdAt']),stamp=parsePaymentHistoryCursor({id:row.id,createdAt:row.createdAt})!;
  if(!paymentHistoryTargets.includes(row.targetType as PaymentHistoryItem['targetType'])||!paymentHistoryStatuses.includes(row.status as PaymentHistoryItem['status'])||
   typeof row.amount!=='string'||!/^(0|[1-9][0-9]{0,9})\.[0-9]{2}$/.test(row.amount)||row.amount==='0.00'||typeof row.isTest!=='boolean'||previous&&!before(stamp,previous))throw Error('Invalid payment history');
  previous=stamp;
  return{...stamp,targetType:row.targetType as PaymentHistoryItem['targetType'],amount:row.amount,status:row.status as PaymentHistoryItem['status'],isTest:row.isTest};
 });
 const nextCursor=parsePaymentHistoryCursor(page.nextCursor),last=items.at(-1);
 if(nextCursor&&(items.length!==paymentHistoryPageSize||!last||nextCursor.id!==last.id||nextCursor.createdAt!==last.createdAt))throw Error('Invalid payment history');
 return{items,nextCursor};
}
