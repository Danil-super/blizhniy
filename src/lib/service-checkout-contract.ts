import {parseListingCheckout} from './listing-checkout-contract.ts';
export type PaidServiceKind='fair'|'marquee';
export type ServiceCheckoutInput={publicationId:string;expectedRevision:string;creationKey:string;expectedTariffId:string;expectedAmount:string;expectedDurationDays:number|null;expectedFairDate:string|null};
export class ServiceCheckoutInputError extends Error{constructor(){super('Invalid service checkout input');this.name='ServiceCheckoutInputError';}}
export class ServiceCheckoutConflictError extends Error{constructor(){super('Service checkout changed');this.name='ServiceCheckoutConflictError';}}
export class ServiceCheckoutUnavailableError extends Error{constructor(){super('Service checkout unavailable');this.name='ServiceCheckoutUnavailableError';}}
/** Syntax only: the server separately checks the current event and stored purchase terms. */
export function parseServiceCheckout(kind:PaidServiceKind,input:unknown):ServiceCheckoutInput{
 try{
  if(!['fair','marquee'].includes(kind)||!input||typeof input!=='object'||Array.isArray(input)||![Object.prototype,null].includes(Object.getPrototypeOf(input)))throw Error();
  const row=input as Record<string,unknown>,keys=['publicationId','expectedRevision','creationKey','expectedTariffId','expectedAmount','expectedDurationDays','expectedFairDate'];
  if(Reflect.ownKeys(row).length!==keys.length||keys.some(key=>!Object.hasOwn(row,key))||row.expectedTariffId!==(kind==='fair'?'fair-participation':'ad-marquee'))throw Error();
  if(kind==='fair'){
   if(row.expectedDurationDays!==null||typeof row.expectedFairDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(row.expectedFairDate))throw Error();
   const day=new Date(row.expectedFairDate+'T00:00:00Z'),next=new Date(day.getTime()+7*86400000);
   if(day.toISOString().slice(0,10)!==row.expectedFairDate||day.getUTCDay()!==0||next.getUTCMonth()===day.getUTCMonth())throw Error();
  }else if(row.expectedFairDate!==null)throw Error();
  const parsed=parseListingCheckout({listingId:row.publicationId,expectedRevision:row.expectedRevision,creationKey:row.creationKey,expectedTariffId:row.expectedTariffId,expectedAmount:row.expectedAmount,expectedDurationDays:kind==='fair'?1:row.expectedDurationDays});
  if(parsed.expectedAmount==='0.00')throw Error();
  return{publicationId:parsed.listingId,expectedRevision:parsed.expectedRevision,creationKey:parsed.creationKey,expectedTariffId:parsed.expectedTariffId,expectedAmount:parsed.expectedAmount,expectedDurationDays:kind==='fair'?null:parsed.expectedDurationDays,expectedFairDate:row.expectedFairDate as string|null};
 }catch{throw new ServiceCheckoutInputError();}
}
