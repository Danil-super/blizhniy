import type {ListingCheckoutConfig} from './postgres-listing-checkout';
export type AccountTestPaymentConfig={ownerId:string;shopId:string;isTest:true;secretKey:string};
/** Server-only, fail-closed TEST allowlist. No implicit adoption of legacy LIVE credentials. */
export function readAccountTestPaymentConfig(env:NodeJS.ProcessEnv,checkout:ListingCheckoutConfig):AccountTestPaymentConfig|null{
 if(typeof window!=='undefined')throw Error('Payment configuration is server-only');
 const mode=env.BLIZHNIY_LISTING_PAYMENT;
 if(mode===undefined||mode==='disabled')return null;
 const owner=env.BLIZHNIY_PAYMENT_TEST_USER_ID,secret=env.YOOKASSA_SECRET_KEY;
 if(mode!=='account-test'||!checkout.isTest||checkout.receiptVatCode===null||
  !owner||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(owner)||
  env.YOOKASSA_SHOP_ID!==checkout.shopId||!secret?.startsWith('test_')||secret.length>2048||/[\s\u0000-\u001f\u007f]/.test(secret))throw Error('Invalid account TEST payment configuration');
 return{ownerId:owner,shopId:checkout.shopId,isTest:true,secretKey:secret};
}
