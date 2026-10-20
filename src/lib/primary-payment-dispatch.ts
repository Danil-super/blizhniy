import {PostgresPaymentIntentStore,parsePaymentIntent,type PaymentIntentBinding} from './postgres-payment-intents.ts';
import {createPrimaryYooKassaReader} from './primary-yookassa-reader.ts';
import {createYooKassaTransport} from './yookassa-transport.ts';
import {assertPrimaryYooKassaBinding,validatePrimaryYooKassaPayment,YooKassaBoundaryError,type YooKassaPaymentResponse} from './yookassa-payment-contract.ts';
import type {PostgresDatabase} from './postgres';

type Merchant=Parameters<typeof createPrimaryYooKassaReader>[0];
type LinkedCheckout={providerPaymentId:string;confirmationUrl:string|null};
class KnownPaymentDiscovered extends Error{
 readonly id:string;
 constructor(id:string){super('Known payment requires readback');this.id=id;}
}
const linked=(payment:YooKassaPaymentResponse):LinkedCheckout=>({providerPaymentId:payment.id,confirmationUrl:payment.confirmation?.confirmation_url??null});

/** Private trusted dispatcher, NOT an owner checkout API. No runtime consumer or production grants.
 * The caller must have atomically authorized the target and frozen this original intent first.
 * A successful POST links identity only; authoritative financial verification/fulfillment are separate.
 */
export function createPrimaryPaymentDispatcher(db:Pick<PostgresDatabase,'transaction'>,config:Merchant,fetcher:typeof fetch=globalThis.fetch){
 const merchant={...config},reader=createPrimaryYooKassaReader(merchant,fetcher);
 const intents=new PostgresPaymentIntentStore(db);
 const transport=createYooKassaTransport({fetch:fetcher,monotonicNow:()=>performance.now(),setTimeout,clearTimeout});
 return{
  async dispatch(value:PaymentIntentBinding,beforePost?:()=>Promise<void>):Promise<LinkedCheckout>{
   const expected={...value};
   assertPrimaryYooKassaBinding(expected,Date.now());
   if(expected.shopId!==merchant.shopId||expected.isTest!==merchant.isTest)throw new YooKassaBoundaryError('YooKassa original merchant binding does not match');
   return transport.withYooKassaRequestBudget(async budget=>{
    budget.start();
    const authorizingAt=performance.now();
    const first=await Promise.race([intents.authorize(expected),budget.expired]);
    if(first.decision==='recover')return linked(await reader.read({...expected,providerPaymentId:first.providerId},budget));
    // Include scheduling around await as well, even though the store already subtracts its SQL roundtrip.
    budget.limit(first.remainingMs-Math.max(0,performance.now()-authorizingAt));
    const original=parsePaymentIntent({...expected,requestBody:first.requestBody}).requestBody;
    let payload:unknown;
    try{
     ({payload}=await transport.fetchYooKassaJson('https://api.yookassa.ru/v3/payments',{
      method:'POST',cache:'no-store',body:original,headers:{
       Authorization:`Basic ${Buffer.from(`${merchant.shopId}:${merchant.secretKey}`,'utf8').toString('base64')}`,
       'Content-Type':'application/json','Idempotence-Key':expected.id,
      },
     },budget,async shared=>{
      // Recheck the original DB anchor and immutable bytes immediately before EVERY attempt.
      const checkingAt=performance.now(),permitted=await intents.authorize(expected);
      if(permitted.decision==='recover')throw new KnownPaymentDiscovered(permitted.providerId);
      if(permitted.requestBody!==original)throw new YooKassaBoundaryError('YooKassa original request changed');
      shared.limit(permitted.remainingMs-Math.max(0,performance.now()-checkingAt));
      // Purchase admission follows the potentially blocking canonical intent lock.
      // The transport then checks the shared deadline immediately before fetch.
      if(beforePost)await beforePost();
     }));
    }catch(error){
     if(error instanceof KnownPaymentDiscovered)return linked(await reader.read({...expected,providerPaymentId:error.id},budget));
     throw error;
    }
    const verified=validatePrimaryYooKassaPayment(payload,expected,Date.now());
    // A lost binding COMMIT is UNKNOWN, not permission for an internal SQL retry or a new key.
    await intents.bindProvider(expected,verified.id);
    return linked(verified);
   });
  },
 };
}
