import {readPostmoderationEnabled} from './listing-workflow-config';
import {authJson} from './auth-http';
import {readProductionAuthConfig} from './production-auth-config';
import {getProductionAccountDatabase} from './production-auth-runtime';
import {PostgresListingCheckoutStore} from './postgres-listing-checkout';
import {readListingCheckoutConfig} from './listing-checkout-config.ts';
import {createListingCheckoutHandler} from './listing-checkout-http';
import {readAccountTestPaymentConfig} from './account-test-payment-config.ts';
import {createAccountTestListingPayment} from './account-test-listing-payment';

export function handleListingCheckoutRequest(request:Request){return handleCheckout(request);}
export function handleWorkCheckoutRequest(request:Request,targetType:'vacancy'|'workRequest'){
 if(!['vacancy','workRequest'].includes(targetType))return Promise.resolve(authJson({error:{code:'CHECKOUT_DISABLED'}},503));
 return handleCheckout(request,targetType);
}
async function handleCheckout(request:Request,targetType?:'vacancy'|'workRequest'){
 try{
  // Disabled before opening a database or loading account/merchant credentials.
  if(process.env.BLIZHNIY_LISTING_CHECKOUT===undefined||process.env.BLIZHNIY_LISTING_CHECKOUT==='disabled')return authJson({error:{code:'CHECKOUT_DISABLED'}},503);
  const auth=readProductionAuthConfig();if(!auth)return authJson({error:{code:'NOT_FOUND'}},404);
  const config=readListingCheckoutConfig(process.env,auth.origin);
  if(!config)return authJson({error:{code:'CHECKOUT_DISABLED'}},503);
  return await createListingCheckoutHandler(auth,async()=>{
   const {db,limiter}=await getProductionAccountDatabase(auth);
   const dispatch=targetType&&process.env.BLIZHNIY_LISTING_PAYMENT!=='account-publication-test'?null:readAccountTestPaymentConfig(process.env,config);
   const store=new PostgresListingCheckoutStore(db,config,{postmoderation:readPostmoderationEnabled(),testModeHistory:true,...(targetType?{targetType}:{}),...(dispatch?.publication?{publicationTestOwner:dispatch.ownerId}:{})});
   return{store,limiter,payments:dispatch?createAccountTestListingPayment(db,store,dispatch):null};
  },undefined,{readOnly:process.env.BLIZHNIY_LISTING_PAYMENT==='disabled'||!!targetType&&process.env.BLIZHNIY_LISTING_PAYMENT!=='account-publication-test'})(request);
 }catch{return authJson({error:{code:'CHECKOUT_UNAVAILABLE'}},503);}
}
