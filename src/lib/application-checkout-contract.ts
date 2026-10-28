import {parseListingDraftId,parseListingDraftRevision} from './listing-draft-contract.ts';
export type ApplicationCheckoutInput={applicationId:string;expectedRevision:string;creationKey:string;expectedTariffId:string;expectedAmount:string};
export class ApplicationCheckoutInputError extends Error{constructor(){super('Invalid application checkout');}}
export class ApplicationCheckoutConflictError extends Error{constructor(){super('Application checkout changed');}}
export class ApplicationCheckoutUnavailableError extends Error{constructor(){super('Application checkout unavailable');}}
export type ApplicationPaymentOrder={id:string;creationKey:string;targetId:string;targetRevision:string;tariffId:string;amount:string;durationDays:null;status:'created'|'pending'|'succeeded'|'failed'|'refunded';createdAt:string};
export type ApplicationPaymentSnapshot={order:ApplicationPaymentOrder;deliveredAt:string|null;targetClosed?:boolean};
export type ApplicationQuote={applicationId:string;revision:string;tariff:{id:string;name:string;amount:string;currency:'RUB';durationDays:null};activePayment:ApplicationPaymentOrder|null};
export function parseApplicationCheckout(value:unknown):ApplicationCheckoutInput{
 try{
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error();
  const row=value as Record<string,unknown>,keys=['applicationId','expectedRevision','creationKey','expectedTariffId','expectedAmount'];
  if(Reflect.ownKeys(row).length!==keys.length||keys.some(key=>!Object.hasOwn(row,key))||row.expectedTariffId!=='job-response'||typeof row.expectedAmount!=='string'||!/^(0|[1-9]\d{0,9})\.\d{2}$/.test(row.expectedAmount)||row.expectedAmount==='0.00')throw Error();
  return{applicationId:parseListingDraftId(row.applicationId),expectedRevision:parseListingDraftRevision(row.expectedRevision),creationKey:parseListingDraftId(row.creationKey),expectedTariffId:row.expectedTariffId,expectedAmount:row.expectedAmount};
 }catch{throw new ApplicationCheckoutInputError();}
}
