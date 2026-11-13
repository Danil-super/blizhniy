import {parseListingDraftId} from './listing-draft-contract.ts';
export type CheckoutCancellationInput={paymentId:string;targetType:'listing'|'vacancy'|'workRequest'|'application'|'fair_application'|'ad_marquee'};
export type CheckoutCancellationResult=CheckoutCancellationInput&{state:'cancelled'};
export class CheckoutCancellationInputError extends Error{constructor(){super('Invalid checkout cancellation');this.name='CheckoutCancellationInputError';}}
export function parseCheckoutCancellation(value:unknown,options:{services?:boolean}={}):CheckoutCancellationInput{
 try{if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Reflect.ownKeys(value).length!==2)throw Error();
  const row=value as Record<string,unknown>;if(!Object.hasOwn(row,'paymentId')||!Object.hasOwn(row,'targetType')||!['listing','vacancy','workRequest','application',...(options.services===true?['fair_application','ad_marquee']:[])].some(type=>type===row.targetType))throw Error();
  return{paymentId:parseListingDraftId(row.paymentId),targetType:row.targetType as CheckoutCancellationInput['targetType']};
 }catch{throw new CheckoutCancellationInputError();}
}
export function readCheckoutCancellationEnabled(env:NodeJS.ProcessEnv=process.env):boolean{
 if(typeof window!=='undefined')throw Error('Checkout cancellation configuration is server-only');
 if(env.BLIZHNIY_CHECKOUT_CANCELLATION===undefined)return false;
 if(env.BLIZHNIY_CHECKOUT_CANCELLATION!=='local-v1'||env.BLIZHNIY_LOCAL_PRIMARY!=='enabled'||env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN!=='https://127.0.0.1:3045')throw Error('Invalid checkout cancellation activation');
 return true;
}
