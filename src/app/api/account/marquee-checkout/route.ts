import {authJson} from '@/lib/auth-http';
import {PostgresServiceCheckoutStore} from '@/lib/postgres-service-checkout';
import {createPrimaryPaymentDispatcher} from '@/lib/primary-payment-dispatch';
import {readProductionAuthConfig} from '@/lib/production-auth-config';
import {getProductionAccountDatabase} from '@/lib/production-auth-runtime';
import {readHostedMarqueeCheckout} from '@/lib/service-checkout-config';
import {createServiceCheckoutHandler} from '@/lib/service-checkout-http';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function POST(request:Request){
 try{
  const hosted=readHostedMarqueeCheckout();
  if(!hosted)return authJson({error:{code:'CHECKOUT_DISABLED'}},503);
  const auth=readProductionAuthConfig();
  if(!auth)return authJson({error:{code:'NOT_FOUND'}},404);
  return await createServiceCheckoutHandler(auth,'marquee',async()=>{
   const {db,limiter}=await getProductionAccountDatabase(auth);
   const ready=(await db.query<{ready:boolean}>(`select coalesce(has_function_privilege('blizhniy_payment_reconciler',
    to_regprocedure('app.next_hosted_marquee(text)'),'EXECUTE'),false) as ready`)).rows[0]?.ready;
   if(!ready)throw Error('Hosted TEST marquee queue unavailable');
   const store=new PostgresServiceCheckoutStore(db,hosted.checkout,'marquee',hosted.merchant.ownerId);
   const dispatcher=createPrimaryPaymentDispatcher(db,hosted.merchant);
   return{store,limiter,async dispatch(token,owner,id){
    const binding=await store.authorizeDispatch(token,owner,id);
    const result=await dispatcher.dispatch(binding,attempt=>store.authorizeDispatch(token,owner,id,true,attempt));
    await store.authorizeDispatch(token,owner,id);
    return{isTest:true,confirmationUrl:result.confirmationUrl};
   }};
  })(request);
 }catch{return authJson({error:{code:'CHECKOUT_UNAVAILABLE'}},503);}
}

export const PUT=POST;
