import {
  assertPrimaryYooKassaBinding, validatePrimaryYooKassaPayment, validateCaptureTime, YooKassaBoundaryError,
  type PrimaryYooKassaBinding,
} from './yookassa-payment-contract.ts';
import {validatePrimaryYooKassaRefund} from './yookassa-refund-contract.ts';
import {mergePaymentVerification} from './payment-verification-contract.ts';
import {createYooKassaTransport, type YooKassaRequestBudget} from './yookassa-transport.ts';

type KnownPayment = PrimaryYooKassaBinding & {providerPaymentId: string; paymentCapturedAt?: string};
type Merchant = {shopId: string; isTest: boolean; secretKey: string};
export type RefundInspectionEvidence = {
  paymentId: string;
  amount: string;
  currency: 'RUB';
  reportedRefundedAmount: '0.00' | null;
  canceledRefundCount: number;
  inspectedAt: string;
};
function invalid(): never { throw new YooKassaBoundaryError('YooKassa refund inspection requires reconciliation'); }
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function inspectPayment(payload: unknown, expected: KnownPayment) {
  const payment = validatePrimaryYooKassaPayment(payload, expected, Date.now());
  if (payment.status !== 'succeeded' || !object(payload) || payload.refundable !== true) invalid();
  // Optional in the vendor schema. Never manufacture a reported zero from absence.
  let reportedRefundedAmount: '0.00' | null = null;
  if (Object.hasOwn(payload, 'refunded_amount')) {
    if (!object(payload.refunded_amount) || payload.refunded_amount.value !== '0.00' ||
        payload.refunded_amount.currency !== 'RUB') invalid();
    reportedRefundedAmount = '0.00';
  }
  return {payment, reportedRefundedAmount};
}

function inspectHistory(payload: unknown, expected: KnownPayment, capturedAt?: string): number {
  // A partial first page is not evidence of an empty remainder. Keep the existing
  // total attempt limit; longer histories need a separate bounded reconciliation.
  if (!object(payload) || payload.type !== 'list' || !Array.isArray(payload.items) ||
      payload.items.length > 100 || Object.hasOwn(payload, 'next_cursor')) invalid();
  const ids = new Set<string>();
  const now = Date.now();
  for (const row of payload.items) {
    if (!object(row) || typeof row.id !== 'string' || !object(row.amount) || typeof row.amount.value !== 'string') invalid();
    const refund = validatePrimaryYooKassaRefund(row, {
      payment: expected, providerRefundId: row.id, amount: row.amount.value,
    }, now, capturedAt);
    const id = refund.id.toLowerCase();
    if (refund.status !== 'canceled' || ids.has(id)) invalid();
    ids.add(id);
  }
  return ids.size;
}

/** Read-only TEST placement evidence. No permission, POST, persistence or service effects.
 * A provider operation can still race the final GET; this is not a balance guarantee.
 * Source: https://yookassa.ru/developers/api/yookassa-openapi-specification.yaml
 */
export function createPrimaryYooKassaRefundInspection(config: Merchant, fetcher: typeof fetch = globalThis.fetch) {
  if (typeof window !== 'undefined') throw new YooKassaBoundaryError('YooKassa refund inspection is server-only');
  const merchant = {...config};
  if (typeof merchant.shopId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(merchant.shopId) ||
      merchant.isTest !== true || typeof merchant.secretKey !== 'string' || !merchant.secretKey.startsWith('test_') ||
      merchant.secretKey.length > 2048 || /[\s\u0000-\u001f\u007f]/.test(merchant.secretKey)) {
    throw new YooKassaBoundaryError('YooKassa merchant configuration is invalid');
  }
  const authorization = `Basic ${Buffer.from(`${merchant.shopId}:${merchant.secretKey}`, 'utf8').toString('base64')}`;
  const transport = createYooKassaTransport({fetch: fetcher, monotonicNow: () => performance.now(), setTimeout, clearTimeout});
  async function inspectKnown(expected: KnownPayment, budget: YooKassaRequestBudget): Promise<RefundInspectionEvidence> {
    async function get(path: string) {
      const {payload} = await transport.fetchYooKassaJson(`https://api.yookassa.ru/v3/${path}`, {
        method: 'GET', cache: 'no-store', headers: {Authorization: authorization},
      }, budget);
      return payload;
    }
    const paymentPath = `payments/${expected.providerPaymentId}`;
    const before = inspectPayment(await get(paymentPath), expected);
    const initial = mergePaymentVerification(expected.paymentCapturedAt === undefined ? null : {status: 'succeeded', capturedAt: expected.paymentCapturedAt},
      {status: before.payment.status, capturedAt: before.payment.capturedAt ?? null});
    const history = await get(`refunds?payment_id=${expected.providerPaymentId}&limit=100`);
    const canceledRefundCount = inspectHistory(history, expected, initial.capturedAt ?? undefined);
    const after = inspectPayment(await get(paymentPath), expected);
    const merged = mergePaymentVerification(
      initial,
      {status: after.payment.status, capturedAt: after.payment.capturedAt ?? null},
    );
    // If capture was absent initially, the final observation must still constrain
    // every history row; never replace a missing provider timestamp with now.
    if (!initial.capturedAt && merged.capturedAt) inspectHistory(history, expected, merged.capturedAt);
    budget.check();
    return {paymentId: expected.providerPaymentId, amount: expected.amount, currency: 'RUB',
      reportedRefundedAmount: after.reportedRefundedAmount, canceledRefundCount, inspectedAt: new Date().toISOString()};
  }
  return {
    async inspect(value: KnownPayment, budget?: YooKassaRequestBudget) {
      const expected = {...value};
      assertPrimaryYooKassaBinding(expected, Date.now());
      if (expected.paymentCapturedAt !== undefined) validateCaptureTime(expected.paymentCapturedAt, 'succeeded', Date.now());
      if (!expected.providerPaymentId || expected.shopId !== merchant.shopId || expected.isTest !== true ||
          !['listing', 'vacancy', 'workRequest'].includes(expected.targetType)) invalid();
      return budget ? inspectKnown(expected, budget) : transport.withYooKassaRequestBudget(shared => inspectKnown(expected, shared));
    },
  };
}
