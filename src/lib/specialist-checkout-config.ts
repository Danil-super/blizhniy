import {readListingCheckoutConfig} from './listing-checkout-config.ts';
import {readAccountTestPaymentConfig} from './account-test-payment-config.ts';
import {readPostmoderationEnabled} from './listing-workflow-config.ts';
/** Synthetic local admission only; this switch cannot enable a production merchant. */
export function readSpecialistCheckoutEnabled(env:NodeJS.ProcessEnv=process.env):boolean{
 if(env.BLIZHNIY_SPECIALIST_CHECKOUT===undefined||env.BLIZHNIY_SPECIALIST_CHECKOUT==='disabled')return false;
 if(env.BLIZHNIY_SPECIALIST_CHECKOUT!=='local-v1'||env.BLIZHNIY_LOCAL_PRIMARY!=='enabled'||env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN!=='https://127.0.0.1:3045'||!readPostmoderationEnabled(env))throw Error('Invalid specialist checkout rollout');
 return true;
}

/** Private hosted TEST capability, separate from the loopback simulator. */
export function readSpecialistAccountTest(env:NodeJS.ProcessEnv=process.env){
 const mode=env.BLIZHNIY_SPECIALIST_PAYMENT;
 if(mode===undefined||mode==='disabled')return null;
 const origin=env.BLIZHNIY_AUTH_ORIGIN;
 if(mode!=='account-publication-test'||env.BLIZHNIY_LISTING_PAYMENT!=='account-publication-test'||!origin||env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN!==undefined||
  (env.BLIZHNIY_SPECIALIST_CHECKOUT!==undefined&&env.BLIZHNIY_SPECIALIST_CHECKOUT!=='disabled'))throw Error('Invalid specialist TEST configuration');
 const checkout=readListingCheckoutConfig(env,origin);
 if(!checkout||!/^[1-9][0-9]{0,63}$/.test(checkout.shopId))throw Error('Invalid specialist TEST shop');
 const merchant=readAccountTestPaymentConfig(env,checkout);
 if(!merchant?.publication)throw Error('Invalid specialist TEST merchant');
 return{checkout,merchant};
}

export function specialistTestShop(owner:string):string|undefined{
 if(process.env.BLIZHNIY_PAYMENT_TEST_USER_ID!==owner)return;
 // Invalid payment settings must leave sign-in and order history available.
 try{return readSpecialistAccountTest()?.merchant.shopId;}catch{return;}
}

export function canShowSpecialistTest(owner:string){return specialistTestShop(owner)!==undefined;}
