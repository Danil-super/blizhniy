import {authJson} from '@/lib/auth-http';import {readCheckoutCancellationEnabled} from '@/lib/checkout-cancellation-contract';
import {readProductionAuthConfig} from '@/lib/production-auth-config';import {getProductionAccountDatabase} from '@/lib/production-auth-runtime';
import {PostgresCheckoutCancellation} from '@/lib/postgres-checkout-cancellation';import {createCheckoutCancellationHandler} from '@/lib/checkout-cancellation-http';
export const runtime='nodejs';
async function handle(request:Request){
 try{
  if(!readCheckoutCancellationEnabled())return authJson({error:{code:'NOT_FOUND'}},404);
  const config=readProductionAuthConfig();if(!config)return authJson({error:{code:'NOT_FOUND'}},404);
  return await createCheckoutCancellationHandler(config,async()=>{const {db,limiter}=await getProductionAccountDatabase(config);return{store:new PostgresCheckoutCancellation(db),limiter};})(request);
 }catch{return authJson({error:{code:'CANCELLATION_UNAVAILABLE'}},503);}
}
export const POST=handle,PUT=handle;
