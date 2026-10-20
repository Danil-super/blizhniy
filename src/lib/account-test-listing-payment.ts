import {createPrimaryPaymentDispatcher} from './primary-payment-dispatch.ts';
import {ListingCheckoutUnavailableError} from './listing-checkout-contract.ts';
import type {PostgresListingCheckoutStore} from './postgres-listing-checkout';
import type {PostgresDatabase} from './postgres';
import type {AccountTestPaymentConfig} from './account-test-payment-config.ts';

/** One allowlisted authenticated account, TEST only. HTTP gets no verification/fulfillment authority. */
export function createAccountTestListingPayment(db:Pick<PostgresDatabase,'transaction'>,store:Pick<PostgresListingCheckoutStore,'preview'|'authorizeDispatch'>,config:AccountTestPaymentConfig,fetcher:typeof fetch=globalThis.fetch){
 const merchant={...config};
 if(merchant.isTest!==true||!merchant.secretKey.startsWith('test_'))throw new ListingCheckoutUnavailableError();
 const allowed=(owner:string)=>{if(owner!==merchant.ownerId)throw new ListingCheckoutUnavailableError();};
 const dispatcher=createPrimaryPaymentDispatcher(db,merchant,fetcher);
 return{
  async preview(token:string,owner:string,listingId:string,revision:string){allowed(owner);return store.preview(token,owner,listingId,revision);},
  async dispatch(token:string,owner:string,paymentId:string){
   allowed(owner);
   const binding=await store.authorizeDispatch(token,owner,paymentId);
   const result=await dispatcher.dispatch(binding,async()=>{await store.authorizeDispatch(token,owner,paymentId,true);});
   await store.authorizeDispatch(token,owner,paymentId);
   return{confirmationUrl:result.confirmationUrl,isTest:true as const};
  },
 };
}
