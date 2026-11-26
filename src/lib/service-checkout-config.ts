import {readAccountTestPaymentConfig} from './account-test-payment-config.ts';
import {readListingCheckoutConfig} from './listing-checkout-config.ts';
import {readPostmoderationEnabled} from './listing-workflow-config.ts';
import type {PaymentIntentBinding} from './postgres-payment-intents.ts';
/** Local synthetic composition only. This flag grants no schema, database or dispatch authority. */
export function readServiceCheckoutEnabled(env:NodeJS.ProcessEnv=process.env):boolean{
 if(env.BLIZHNIY_SERVICE_CHECKOUT===undefined||env.BLIZHNIY_SERVICE_CHECKOUT==='disabled')return false;
 if(env.BLIZHNIY_SERVICE_CHECKOUT!=='local-v1'||env.BLIZHNIY_LOCAL_PRIMARY!=='enabled'||!readPostmoderationEnabled(env))throw Error('Invalid service checkout rollout');
 return true;
}
export function readHostedMarqueeCheckout(env:NodeJS.ProcessEnv=process.env){
 const mode=env.BLIZHNIY_MARQUEE_PAYMENT;
 if(mode===undefined||mode==='disabled')return null;
 if(mode!=='account-publication-test'||!env.BLIZHNIY_AUTH_ORIGIN||env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN!==undefined||
  (env.BLIZHNIY_SERVICE_CHECKOUT!==undefined&&env.BLIZHNIY_SERVICE_CHECKOUT!=='disabled'))throw Error('Invalid marquee TEST deployment');
 const checkout=readListingCheckoutConfig({...env,BLIZHNIY_LISTING_CHECKOUT:'prepare-only'},env.BLIZHNIY_AUTH_ORIGIN);
 const merchant=checkout&&readAccountTestPaymentConfig({...env,BLIZHNIY_LISTING_PAYMENT:'account-publication-test'},checkout);
 if(!checkout||!merchant?.publication||!/^[1-9][0-9]{0,63}$/.test(merchant.shopId))throw Error('Invalid marquee TEST merchant');
 return{checkout,merchant};
}

export function canShowMarqueeTest(owner:string):boolean{
 if(process.env.BLIZHNIY_PAYMENT_TEST_USER_ID!==owner)return false;
 try{return readHostedMarqueeCheckout()?.merchant.ownerId===owner;}catch{return false;}
}

export type ServiceRefundScope={marqueeRefunds?:boolean;specialistRefunds?:boolean};

export function serviceRefundKindEnabled(targetType:string,scope:ServiceRefundScope):boolean{
 if(targetType==='specialist')return scope.specialistRefunds===true;
 if(scope.marqueeRefunds!==undefined)return scope.marqueeRefunds===true&&targetType==='ad_marquee';
 return (targetType==='fair_application'||targetType==='ad_marquee')&&readServiceCheckoutEnabled();
}

export function servicePlacementRefundTarget(purchase:Pick<PaymentIntentBinding,'targetType'|'durationDays'>,scope:ServiceRefundScope):boolean{
 if(!serviceRefundKindEnabled(purchase.targetType,scope))return false;
 return purchase.targetType==='fair_application'?purchase.durationDays===null:purchase.durationDays!==null;
}
