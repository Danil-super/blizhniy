import {authJson} from './auth-http';
import {readApplicationAccountTest} from './application-test-config';
import {createApplicationCheckoutHandler} from './application-checkout-http';
import {PostgresApplicationCheckoutStore} from './postgres-application-checkout';
import {createPrimaryPaymentDispatcher} from './primary-payment-dispatch';
import {readProductionAuthConfig} from './production-auth-config';
import {getProductionAccountDatabase} from './production-auth-runtime';

export async function handleApplicationCheckoutRequest(request:Request){
 try{
  const config=readApplicationAccountTest();
  if(!config)return authJson({error:{code:'CHECKOUT_DISABLED'}},503);
  const auth=readProductionAuthConfig();
  if(!auth)return authJson({error:{code:'NOT_FOUND'}},404);
  return await createApplicationCheckoutHandler(auth.origin,async()=>{
   const {db,limiter}=await getProductionAccountDatabase(auth);
   const store=new PostgresApplicationCheckoutStore(db,null,undefined,'account-response-test');
   const dispatcher=createPrimaryPaymentDispatcher(db,config.merchant);
   return {store,limiter,async dispatch(token,owner,id){
    const binding=await store.authorizeDispatch(token,owner,id,true);
    const result=await dispatcher.dispatch(binding,async()=>{await store.authorizeDispatch(token,owner,id,true);});
    await store.authorizeDispatch(token,owner,id);
    return {confirmationUrl:result.confirmationUrl,isTest:true};
   }};
  })(request);
 }catch{return authJson({error:{code:'CHECKOUT_UNAVAILABLE'}},503);}
}
