import {authJson} from './auth-http';
import {readProductionAuthConfig} from './production-auth-config';
import {getProductionAccountDatabase} from './production-auth-runtime';
import {PostgresPaymentHistoryStore} from './postgres-payment-history';
import {createPaymentHistoryHandler} from './payment-history-http';
export async function handlePaymentHistoryRequest(request:Request){
 try{
  const config=readProductionAuthConfig();if(!config)return authJson({error:{code:'NOT_FOUND'}},404);
  return await createPaymentHistoryHandler(config,async()=>{
   const {db,limiter}=await getProductionAccountDatabase(config);return{store:new PostgresPaymentHistoryStore(db),limiter};
  })(request);
 }catch{return authJson({error:{code:'PAYMENT_HISTORY_UNAVAILABLE'}},503);}
}
