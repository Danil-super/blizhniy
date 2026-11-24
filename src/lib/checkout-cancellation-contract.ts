import {parseListingDraftId} from './listing-draft-contract.ts';
export type CheckoutCancellationInput={paymentId:string;targetType:'listing'|'vacancy'|'workRequest'|'application'|'specialist'|'fair_application'|'ad_marquee'};
export type CheckoutCancellationResult=CheckoutCancellationInput&{state:'cancelled'};
export class CheckoutCancellationInputError extends Error{constructor(){super('Invalid checkout cancellation');this.name='CheckoutCancellationInputError';}}
export type CheckoutCancellationTargets={services?:boolean;specialist?:boolean};
export function parseCheckoutCancellation(value:unknown,options:CheckoutCancellationTargets={}):CheckoutCancellationInput{
 try{if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Reflect.ownKeys(value).length!==2)throw Error();
  const row=value as Record<string,unknown>;if(!Object.hasOwn(row,'paymentId')||!Object.hasOwn(row,'targetType')||!['listing','vacancy','workRequest','application',...(options.specialist===true?['specialist']:[]),...(options.services===true?['fair_application','ad_marquee']:[])].some(type=>type===row.targetType))throw Error();
  return{paymentId:parseListingDraftId(row.paymentId),targetType:row.targetType as CheckoutCancellationInput['targetType']};
 }catch{throw new CheckoutCancellationInputError();}
}
export function readCheckoutCancellationEnabled(env:NodeJS.ProcessEnv=process.env):boolean{
 if(typeof window!=='undefined')throw Error('Checkout cancellation configuration is server-only');
 if(env.BLIZHNIY_CHECKOUT_CANCELLATION===undefined)return false;
 if(env.BLIZHNIY_CHECKOUT_CANCELLATION==='hosted-test-v1'){
  if(env.BLIZHNIY_AUTH_MODE!=='postgres'||env.BLIZHNIY_AUTH_ORIGIN!=='https://xn----9sbphbgks4a4a.xn--p1ai'||
   env.BLIZHNIY_LOCAL_PRIMARY!==undefined||env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN!==undefined)throw Error('Invalid hosted TEST checkout cancellation activation');
  return true;
 }
 if(env.BLIZHNIY_CHECKOUT_CANCELLATION!=='local-v1'||env.BLIZHNIY_LOCAL_PRIMARY!=='enabled'||env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN!=='https://127.0.0.1:3045')throw Error('Invalid checkout cancellation activation');
 return true;
}
