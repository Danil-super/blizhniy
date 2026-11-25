import {readPostmoderationEnabled} from './listing-workflow-config.ts';
import type {PaymentIntentBinding} from './postgres-payment-intents.ts';
/** Local synthetic composition only. This flag grants no schema, database or dispatch authority. */
export function readServiceCheckoutEnabled(env:NodeJS.ProcessEnv=process.env):boolean{
 if(env.BLIZHNIY_SERVICE_CHECKOUT===undefined||env.BLIZHNIY_SERVICE_CHECKOUT==='disabled')return false;
 if(env.BLIZHNIY_SERVICE_CHECKOUT!=='local-v1'||env.BLIZHNIY_LOCAL_PRIMARY!=='enabled'||!readPostmoderationEnabled(env))throw Error('Invalid service checkout rollout');
 return true;
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
