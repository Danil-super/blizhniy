import {readListingCheckoutConfig} from './listing-checkout-config.ts';
import type {ListingCheckoutConfig} from './postgres-listing-checkout';
export type AccountTestPaymentConfig={ownerId:string;shopId:string;isTest:true;secretKey:string;publication?:true};
/** Server-only, fail-closed TEST allowlist. No implicit adoption of legacy LIVE credentials. */
export function readAccountTestPaymentConfig(env:NodeJS.ProcessEnv,checkout:ListingCheckoutConfig):AccountTestPaymentConfig|null{
 if(typeof window!=='undefined')throw Error('Payment configuration is server-only');
 const mode=env.BLIZHNIY_LISTING_PAYMENT;
 if(mode===undefined||mode==='disabled')return null;
 const owner=env.BLIZHNIY_PAYMENT_TEST_USER_ID,secret=env.YOOKASSA_SECRET_KEY;
 const publication=mode==='account-publication-test';
 if(publication&&(env.BLIZHNIY_AUTH_MODE!=='postgres'||env.BLIZHNIY_AUTH_ORIGIN!=='https://xn----9sbphbgks4a4a.xn--p1ai'||
  checkout.siteOrigin!==env.BLIZHNIY_AUTH_ORIGIN||env.BLIZHNIY_LISTING_WORKFLOW!=='postmoderation'||env.BLIZHNIY_LOCAL_PRIMARY!==undefined))throw Error('Invalid publication TEST configuration');
 if(mode!=='account-test'&&!publication||!checkout.isTest||checkout.receiptVatCode===null||
  !owner||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(owner)||
  env.YOOKASSA_SHOP_ID!==checkout.shopId||!secret?.startsWith('test_')||secret.length>2048||/[\s\u0000-\u001f\u007f]/.test(secret))throw Error('Invalid account TEST payment configuration');
 return{ownerId:owner,shopId:checkout.shopId,isTest:true,secretKey:secret,...(publication?{publication:true as const}:{})};
}

/** Display eligibility for an authenticated session. Checkout authorizes each purchase separately. */
export function canShowWorkPublicationTest(owner:string,env:NodeJS.ProcessEnv=process.env):boolean{
 if(env.BLIZHNIY_LISTING_PAYMENT!=='account-publication-test'||env.BLIZHNIY_PAYMENT_TEST_USER_ID!==owner||!env.BLIZHNIY_AUTH_ORIGIN)return false;
 try{
  const checkout=readListingCheckoutConfig(env,env.BLIZHNIY_AUTH_ORIGIN);
  return !!checkout&&readAccountTestPaymentConfig(env,checkout)?.publication===true;
 }catch{return false;} // A misconfigured merchant must leave the account session usable.
}
