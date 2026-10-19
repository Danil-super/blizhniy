import {authJson} from './auth-http';
import {readProductionAuthConfig} from './production-auth-config';
import {getProductionAccountDatabase} from './production-auth-runtime';
import {PostgresPaymentReconciliationQueue} from './postgres-payment-reconciliation.ts';
import {createPrimaryPaymentWebhook} from './primary-payment-webhook.ts';

/** Callback gate is independent of new-checkout admission. No worker/merchant secret in HTTP. */
export async function handlePrimaryPaymentWebhook(request:Request){
 try{
  const mode=process.env.BLIZHNIY_PAYMENT_WEBHOOK;
  if(mode===undefined||mode==='disabled')return authJson({error:{code:'WEBHOOK_DISABLED'}},503);
  const shopId=process.env.BLIZHNIY_PAYMENT_SHOP_ID;
  if(mode!=='queued-test'||process.env.BLIZHNIY_PAYMENT_MODE!=='test'||!shopId||!/^[a-zA-Z0-9_-]{1,64}$/.test(shopId))throw new Error('Invalid webhook configuration');
  const config=readProductionAuthConfig();if(!config)return authJson({error:{code:'WEBHOOK_UNAVAILABLE'}},503);
  return await createPrimaryPaymentWebhook(config,async()=>{
   const {db}=await getProductionAccountDatabase(config);
   return new PostgresPaymentReconciliationQueue(db,{shopId,isTest:true});
  })(request);
 }catch{return authJson({error:{code:'WEBHOOK_UNAVAILABLE'}},503);}
}
