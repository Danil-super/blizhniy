import {authJson} from './auth-http';
import {readProductionAuthConfig} from './production-auth-config';
import {getProductionAccountDatabase} from './production-auth-runtime';
import {PostgresListingCheckoutStore} from './postgres-listing-checkout';
import {readListingCheckoutConfig} from './listing-checkout-config.ts';
import {createListingCheckoutHandler} from './listing-checkout-http';

export async function handleListingCheckoutRequest(request:Request){
 try{
  // Disabled before opening a database or loading account/merchant credentials.
  if(process.env.BLIZHNIY_LISTING_CHECKOUT===undefined||process.env.BLIZHNIY_LISTING_CHECKOUT==='disabled')return authJson({error:{code:'CHECKOUT_DISABLED'}},503);
  const auth=readProductionAuthConfig();if(!auth)return authJson({error:{code:'NOT_FOUND'}},404);
  const config=readListingCheckoutConfig(process.env,auth.origin);
  if(!config)return authJson({error:{code:'CHECKOUT_DISABLED'}},503);
  return await createListingCheckoutHandler(auth,async()=>{
   const {db,limiter}=await getProductionAccountDatabase(auth);
   return{store:new PostgresListingCheckoutStore(db,config),limiter};
  })(request);
 }catch{return authJson({error:{code:'CHECKOUT_UNAVAILABLE'}},503);}
}
