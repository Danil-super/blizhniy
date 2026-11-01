import {createPrimaryYooKassaReader} from './primary-yookassa-reader.ts';
import {createYooKassaTransport,type YooKassaRequestBudget} from './yookassa-transport.ts';
import {YooKassaBoundaryError} from './yookassa-payment-contract.ts';
import {assertPrimaryYooKassaRefundBinding,validatePrimaryYooKassaRefund,type KnownYooKassaRefund} from './yookassa-refund-contract.ts';

/** Server-only readback of a known refund. No POST, database writes or entitlement changes. */
export function createPrimaryYooKassaRefundReader(config:Parameters<typeof createPrimaryYooKassaReader>[0],fetcher:typeof fetch=globalThis.fetch){
  const merchant={...config};
  const payments=createPrimaryYooKassaReader(merchant,fetcher);
  const transport=createYooKassaTransport({fetch:fetcher,monotonicNow:()=>performance.now(),setTimeout,clearTimeout});
  async function readKnown(expected:KnownYooKassaRefund,budget:YooKassaRequestBudget){
    const payment=await payments.read(expected.payment,budget);
    if(payment.status!=='succeeded')throw new YooKassaBoundaryError('YooKassa refund requires a captured payment');
    const authorization=`Basic ${Buffer.from(`${merchant.shopId}:${merchant.secretKey}`,'utf8').toString('base64')}`;
    const {payload}=await transport.fetchYooKassaJson(`https://api.yookassa.ru/v3/refunds/${expected.providerRefundId}`,{
      method:'GET',cache:'no-store',headers:{Authorization:authorization},
    },budget);
    return validatePrimaryYooKassaRefund(payload,expected,Date.now(),payment.capturedAt);
  }
  return {
    async read(value:KnownYooKassaRefund,budget?:YooKassaRequestBudget){
      // Freeze both levels before the first await; caller mutation cannot rebind a request.
      const expected={...value,payment:{...value.payment}};
      assertPrimaryYooKassaRefundBinding(expected,Date.now());
      if(expected.payment.shopId!==merchant.shopId||expected.payment.isTest!==merchant.isTest)throw new YooKassaBoundaryError('YooKassa original merchant binding does not match');
      return budget?readKnown(expected,budget):transport.withYooKassaRequestBudget(shared=>readKnown(expected,shared));
    },
  };
}
