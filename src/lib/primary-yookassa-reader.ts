import {
  assertPrimaryYooKassaBinding, validatePrimaryYooKassaPayment,
  YooKassaBoundaryError, type PrimaryYooKassaBinding,
} from './yookassa-payment-contract.ts';
import { createYooKassaTransport } from './yookassa-transport.ts';

type Merchant = { shopId: string; isTest: boolean; secretKey: string };
type KnownPayment = PrimaryYooKassaBinding & { providerPaymentId: string };
/** Server-only authoritative GET. No creation, POST fallback, financial persistence or fulfillment. */
export function createPrimaryYooKassaReader(config: Merchant, fetcher: typeof fetch = globalThis.fetch) {
  if (typeof window !== 'undefined') throw new YooKassaBoundaryError('YooKassa reader is server-only');
  const merchant = { ...config };
  if (typeof merchant.shopId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(merchant.shopId) ||
      typeof merchant.secretKey !== 'string' || !merchant.secretKey || merchant.secretKey.length > 2048 ||
      /[\s\u0000-\u001f\u007f]/.test(merchant.secretKey) || typeof merchant.isTest !== 'boolean' ||
      merchant.isTest !== merchant.secretKey.startsWith('test_')) {
    throw new YooKassaBoundaryError('YooKassa merchant configuration is invalid');
  }
  const transport = createYooKassaTransport({ fetch: fetcher, monotonicNow: () => performance.now(), setTimeout, clearTimeout });
  return {
    async read(value: KnownPayment) {
      const expected = { ...value };
      assertPrimaryYooKassaBinding(expected, Date.now());
      if (!expected.providerPaymentId || expected.shopId !== merchant.shopId || expected.isTest !== merchant.isTest) {
        throw new YooKassaBoundaryError('YooKassa original merchant binding does not match');
      }
      const authorization = `Basic ${Buffer.from(`${merchant.shopId}:${merchant.secretKey}`, 'utf8').toString('base64')}`;
      const { payload } = await transport.fetchYooKassaJson(`https://api.yookassa.ru/v3/payments/${expected.providerPaymentId}`, {
        method: 'GET', cache: 'no-store', headers: { Authorization: authorization },
      });
      return validatePrimaryYooKassaPayment(payload, expected, Date.now());
    },
  };
}
