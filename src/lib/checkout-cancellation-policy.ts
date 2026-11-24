import {readAccountTestPaymentConfig} from './account-test-payment-config.ts';
import {readApplicationAccountTest} from './application-test-config.ts';
import {readCheckoutCancellationEnabled,type CheckoutCancellationInput} from './checkout-cancellation-contract.ts';
import {readListingCheckoutConfig} from './listing-checkout-config.ts';
import {readServiceCheckoutEnabled} from './service-checkout-config.ts';
import {readSpecialistAccountTest} from './specialist-checkout-config.ts';

type Admission={shopId:string;ownerId?:string;publicationMode?:'account-test-v1'|'specialist-account-test-v1'};
export type CheckoutCancellationPolicy=Partial<Record<CheckoutCancellationInput['targetType'],Admission>>;

export function readLocalCheckoutCancellationPolicy(env:NodeJS.ProcessEnv=process.env):CheckoutCancellationPolicy{
 const local={shopId:'local-fixture-shop'};
 return{
  listing:local,vacancy:local,workRequest:local,application:local,
  ...(readServiceCheckoutEnabled(env)?{fair_application:local,ad_marquee:local}:{}),
 };
}

export function readCheckoutCancellationPolicy(env:NodeJS.ProcessEnv=process.env):CheckoutCancellationPolicy|null{
 if(!readCheckoutCancellationEnabled(env))return null;
 if(env.BLIZHNIY_CHECKOUT_CANCELLATION==='local-v1')return readLocalCheckoutCancellationPolicy(env);

 const checkout=readListingCheckoutConfig(env,env.BLIZHNIY_AUTH_ORIGIN!);
 const merchant=checkout&&readAccountTestPaymentConfig(env,checkout);
 if(!merchant||!/^[1-9][0-9]{0,63}$/.test(merchant.shopId))return null;
 const admission={shopId:merchant.shopId,ownerId:merchant.ownerId};
 const publication={...admission,publicationMode:'account-test-v1' as const};
 return{
  listing:merchant.publication?publication:admission,
  ...(merchant.publication?{vacancy:publication,workRequest:publication}:{}),
  ...(readApplicationAccountTest(env)?{application:admission}:{}),
  ...(readSpecialistAccountTest(env)?{specialist:{...admission,publicationMode:'specialist-account-test-v1'}}:{}),
 };
}
