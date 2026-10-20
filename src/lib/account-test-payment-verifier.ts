import {PostgresPaymentVerificationStore} from './postgres-payment-verification.ts';
import type {PostgresDatabase} from './postgres';
import type {AccountTestPaymentConfig} from './account-test-payment-config.ts';

/** Dedicated financial process, never HTTP. GET-only account-scoped TEST verification.
 * Deliberately no fulfillment or queue import: TEST success cannot publish a production target.
 */
export function createAccountTestPaymentVerifier(db:Pick<PostgresDatabase,'transaction'>,config:AccountTestPaymentConfig,fetcher:typeof fetch=globalThis.fetch,now=()=>performance.now()){
 const merchant={...config};
 if(merchant.isTest!==true||typeof merchant.secretKey!=='string'||!merchant.secretKey.startsWith('test_')||
  typeof merchant.ownerId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(merchant.ownerId))throw Error('Invalid account TEST verifier');
 const verification=new PostgresPaymentVerificationStore(db,merchant,fetcher);
 let nextAt=-Infinity,cursor='00000000-0000-0000-0000-000000000000';
 return{async tick():Promise<{state:'idle'|'completed'}|{state:'deferred';code:'provider_pending'}>{
  if(now()<nextAt)return{state:'idle'};
  const ids=await db.transaction(async tx=>(await tx.query<{id:string}>(`select i.id from app.payment_checkout_intents i
   join app.payment_orders o on o.id=i.id join app.payment_provider_links p on p.intent_id=i.id
   where i.merchant_shop_id=$1 and i.owner_id=$2 and i.is_test=true and i.target_type='listing'
    and o.status in ('created','pending') order by (i.id>$3::uuid) desc,i.id limit 5`,[merchant.shopId,merchant.ownerId,cursor])).rows,{readOnly:true});
  let pending=false;
  for(const {id} of ids){
   cursor=id;
   // Unknown COMMIT/errors stop the supervising loop. A later run recovers with GET, never POST.
   const state=await verification.reconcile(id);pending ||= state.orderStatus==='pending';
  }
  nextAt=now()+30000;
  return pending?{state:'deferred',code:'provider_pending'}:{state:ids.length?'completed':'idle'};
 }};
}
