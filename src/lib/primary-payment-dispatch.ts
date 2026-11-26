import {PostgresPaymentIntentStore,parsePaymentIntent,type PaymentDispatch,type PaymentDispatchAttempt,type PaymentIntentBinding} from './postgres-payment-intents.ts';
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

/** Dispatches a prepared, owner-bound intent. User-facing callers supply a transaction
 * that checks purchase admission while recording authorization for the provider request.
 * A successful POST links provider identity. Verification and fulfillment are separate.
 */
export function createPrimaryPaymentDispatcher(db:Pick<PostgresDatabase,'transaction'>,config:Merchant,fetcher:typeof fetch=globalThis.fetch){
 const merchant={...config},reader=createPrimaryYooKassaReader(merchant,fetcher);
 const intents=new PostgresPaymentIntentStore(db);
 const transport=createYooKassaTransport({fetch:fetcher,monotonicNow:()=>performance.now(),setTimeout,clearTimeout});
 return{
  async dispatch(value:PaymentIntentBinding,admitAttempt?:(attempt:PaymentDispatchAttempt)=>Promise<PaymentDispatch>):Promise<LinkedCheckout>{
   const expected={...value};
   assertPrimaryYooKassaBinding(expected,Date.now());
   if(expected.shopId!==merchant.shopId||expected.isTest!==merchant.isTest)throw new YooKassaBoundaryError('YooKassa original merchant binding does not match');
   return transport.withYooKassaRequestBudget(async budget=>{
    budget.start();
    const first=await Promise.race([intents.inspectDispatch(expected),budget.expired]);
    if(first.decision==='recover')return linked(await reader.read({...expected,providerPaymentId:first.providerId},budget));
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
      const checkingAt=performance.now();
      // Purchase admission and the anchor must commit together. Admission can fail
      // after the intent lock without leaving an otherwise cancellable order fenced.
      const permitted=await (admitAttempt
       ? admitAttempt(tx=>intents.authorizeInTransaction(tx,expected))
       : intents.authorize(expected));
      if(permitted.decision==='recover')throw new KnownPaymentDiscovered(permitted.providerId);
      if(permitted.requestBody!==original)throw new YooKassaBoundaryError('YooKassa original request changed');
      shared.limit(permitted.remainingMs-Math.max(0,performance.now()-checkingAt));
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
