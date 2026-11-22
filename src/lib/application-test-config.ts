import {readAccountTestPaymentConfig} from './account-test-payment-config.ts';
import {readListingCheckoutConfig} from './listing-checkout-config.ts';
import {hashSessionToken} from './identity';
import type {PostgresDatabase} from './postgres';

export function readApplicationAccountTest(env:NodeJS.ProcessEnv=process.env){
 if(env.BLIZHNIY_APPLICATION_PAYMENT!=='account-response-test'||!env.BLIZHNIY_AUTH_ORIGIN||
  env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN!==undefined)return null;
 const checkout=readListingCheckoutConfig(env,env.BLIZHNIY_AUTH_ORIGIN);
 const merchant=checkout&&readAccountTestPaymentConfig(env,checkout);
 if(!checkout?.receiptVatCode||!merchant?.publication||!/^[1-9][0-9]{0,63}$/.test(merchant.shopId))return null;
 return {checkout,merchant};
}

export async function canShowApplicationTest(db:Pick<PostgresDatabase,'transaction'>,owner:string,token:string){
 if(process.env.BLIZHNIY_APPLICATION_PAYMENT!=='account-response-test'||process.env.BLIZHNIY_PAYMENT_TEST_USER_ID!==owner)return false;
 try{
  const config=readApplicationAccountTest();if(!config)return false;
  return await db.transaction(async tx=>(await tx.query<{allowed:boolean}>(
   'select app_response.can_prepare($1,$2,$3,$4) as allowed',
   [owner,hashSessionToken(token),config.merchant.shopId,config.checkout.receiptVatCode])).rows[0]?.allowed===true);
 }catch{return false;} // Failure to read the optional payment capability must leave sign-in available.
}
