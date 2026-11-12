import {createPrimaryYooKassaReader} from './primary-yookassa-reader.ts';
import {createYooKassaTransport} from './yookassa-transport.ts';

/** Read-only TEST store admission. Source payment/receipt checks still belong to each processor. */
export function createRefundMerchantPreflight(config:Parameters<typeof createPrimaryYooKassaReader>[0],fetcher:typeof fetch=globalThis.fetch){
 const merchant={...config};
 createPrimaryYooKassaReader(merchant,fetcher);
 if(merchant.isTest!==true)throw Error('Refund merchant preflight failed');
 const transport=createYooKassaTransport({fetch:fetcher,monotonicNow:()=>performance.now(),setTimeout,clearTimeout});
 return async()=>{
  try{
   const {payload}=await transport.fetchYooKassaJson('https://api.yookassa.ru/v3/me',{
    method:'GET',cache:'no-store',headers:{Authorization:`Basic ${Buffer.from(`${merchant.shopId}:${merchant.secretKey}`).toString('base64')}`},
   });
   if(!payload||typeof payload!=='object'||Array.isArray(payload)||!('account_id'in payload)||payload.account_id!==merchant.shopId||
    !('test'in payload)||payload.test!==true||!('status'in payload)||payload.status!=='enabled')throw Error();
   // YooKassa replaced the legacy boolean with fiscalization.enabled; contradictory settings refuse admission.
   const modern='fiscalization'in payload,legacy='fiscalization_enabled'in payload;
   if(!modern&&!legacy||legacy&&payload.fiscalization_enabled!==false)throw Error();
   if(modern){const value=payload.fiscalization;if(!value||typeof value!=='object'||Array.isArray(value)||!('enabled'in value)||value.enabled!==false)throw Error();}
  }catch{throw Error('Refund merchant preflight failed');}
 };
}
