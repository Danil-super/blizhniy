import type {ListingCheckoutConfig} from './postgres-listing-checkout';

/** Preparation only. TEST rollout is separate from dispatch and must not activate real charges. */
export function readListingCheckoutConfig(env:NodeJS.ProcessEnv,siteOrigin:string):ListingCheckoutConfig|null{
 if(typeof window!=='undefined')throw new Error('Checkout configuration is server-only');
 const mode=env.BLIZHNIY_LISTING_CHECKOUT;
 if(mode===undefined||mode==='disabled')return null;
 const shop=env.BLIZHNIY_PAYMENT_SHOP_ID,vat=env.BLIZHNIY_PAYMENT_RECEIPT_VAT;
 if(mode!=='prepare-only'||env.BLIZHNIY_PAYMENT_MODE!=='test'||!shop||!/^[a-zA-Z0-9_-]{1,64}$/.test(shop)||
  !vat||!(/^(?:[1-9]|1[0-2])$/.test(vat)||vat==='none'))throw new Error('Invalid checkout configuration');
 return{shopId:shop,isTest:true,siteOrigin,receiptVatCode:vat==='none'?null:Number(vat)};
}
