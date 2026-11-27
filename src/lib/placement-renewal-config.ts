import {readAccountTestPaymentConfig} from './account-test-payment-config.ts';
import {readListingCheckoutConfig} from './listing-checkout-config.ts';
import {readPostmoderationEnabled} from './listing-workflow-config.ts';

export function readHostedPlacementRenewalOwner(env:NodeJS.ProcessEnv=process.env):string|undefined {
 if(env.BLIZHNIY_PLACEMENT_RENEWALS!=='account-publication-test')return;
 const checkout=readListingCheckoutConfig(env,env.BLIZHNIY_AUTH_ORIGIN??'');
 const merchant=checkout&&readAccountTestPaymentConfig(env,checkout);
 if(!merchant?.publication||!(/^[1-9][0-9]{0,63}$/).test(merchant.shopId)||env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN!==undefined)throw Error('Invalid hosted TEST renewal rollout');
 return merchant.ownerId;
}
export function readPlacementRenewalsEnabled(env:NodeJS.ProcessEnv=process.env):boolean {
  const value=env.BLIZHNIY_PLACEMENT_RENEWALS;
  if(value===undefined||value==='disabled')return false;
  if(value==='account-publication-test')return readHostedPlacementRenewalOwner(env)!==undefined;
  if(value!=='local-v1'||env.BLIZHNIY_LOCAL_PRIMARY!=='enabled'||!readPostmoderationEnabled(env))throw Error('Invalid placement renewal rollout');
  return true;
}
