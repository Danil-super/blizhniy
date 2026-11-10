import {randomUUID} from 'node:crypto';
import {createPrimaryYooKassaRefundInspection} from './primary-yookassa-refund-inspection.ts';
import {PostgresRefundDispatchStore, RefundDispatchError, refundDispatchSourceKey} from './postgres-refund-dispatch.ts';
import {PostgresRefundJournalStore} from './postgres-refund-journal.ts';
import {createYooKassaTransport} from './yookassa-transport.ts';
import {validatePrimaryYooKassaRefund} from './yookassa-refund-contract.ts';
import type {PostgresDatabase} from './postgres.ts';
type Merchant = Parameters<typeof createPrimaryYooKassaRefundInspection>[0];
class CandidateDiscovered extends Error {}

/** Dormant TEST-only dispatcher for a trusted financial worker. Caller MUST supply
 * current initiator/policy/fiscal admission. No HTTP consumer or service effects.
 * Inspection, sending and authoritative readback have separate bounded budgets.
 */
export function createPrimaryRefundDispatcher(db: Pick<PostgresDatabase, 'transaction'>, config: Merchant, fetcher: typeof fetch = globalThis.fetch) {
  const merchant = {...config};
  const inspection = createPrimaryYooKassaRefundInspection(merchant, fetcher);
  const store = new PostgresRefundDispatchStore(db, merchant), journal = new PostgresRefundJournalStore(db, merchant, fetcher);
  const transport = createYooKassaTransport({fetch: fetcher, monotonicNow: () => performance.now(), setTimeout, clearTimeout});
  return {
    async dispatch(operationId: unknown, authorizeRefund: () => Promise<void>) {
      if (typeof authorizeRefund !== 'function') throw new RefundDispatchError();
      const original = await store.load(operationId);
      if (original.candidateId) return journal.reconcile(original.request.operationId, original.candidateId);
      // Do not treat our own unresolved attempt as a new purchase/refund. A retry
      // must recover the SAME key/bytes, even if the original send is now pending.
      if (!original.attempted) await (original.payment.targetType === 'application' ? inspection.inspectCompensation : inspection.inspect)({...original.payment, paymentCapturedAt: original.paymentCapturedAt});
      const key = refundDispatchSourceKey(original);
      let attemptId: string | undefined;
      let payload: unknown;
      try {
        payload = await transport.withYooKassaRequestBudget(async budget => {
          const result = await transport.fetchYooKassaJson('https://api.yookassa.ru/v3/refunds', {
            method: 'POST', cache: 'no-store', body: original.request.requestBody,
            headers: {Authorization: `Basic ${Buffer.from(`${merchant.shopId}:${merchant.secretKey}`, 'utf8').toString('base64')}`,
              'Content-Type': 'application/json', 'Idempotence-Key': original.request.idempotenceKey},
          }, budget, async shared => {
            const checkingAt = performance.now(), permitted = await store.authorize(original.request.operationId, randomUUID());
            if (refundDispatchSourceKey(permitted.known) !== key) throw new RefundDispatchError();
            if (permitted.decision === 'recover') throw new CandidateDiscovered();
            shared.limit(permitted.remainingMs - Math.max(0, performance.now() - checkingAt));
            attemptId = permitted.attemptId;
            await authorizeRefund();
          });
          return result.payload;
        });
      } catch (error) {
        if (error instanceof CandidateDiscovered) {
          const known = await store.load(original.request.operationId);
          if (!known.candidateId) throw new RefundDispatchError();
          return journal.reconcile(known.request.operationId, known.candidateId);
        }
        throw error;
      }
      if (!attemptId || !payload || typeof payload !== 'object' || !('id' in payload) || typeof payload.id !== 'string') throw new RefundDispatchError();
      const verified = validatePrimaryYooKassaRefund(payload, {operationId: original.request.operationId, payment: original.payment,
        providerRefundId: payload.id, amount: original.request.amount, paymentCapturedAt: original.paymentCapturedAt}, Date.now());
      // Persist the candidate before further GETs. A failed readback cannot lose
      // this ID and accidentally turn the next invocation into another POST.
      await store.bindCandidate(original.request.operationId, attemptId, verified.id, original);
      return journal.reconcile(original.request.operationId, verified.id);
    },
  };
}
