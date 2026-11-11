import {createPrimaryRefundDispatcher} from './primary-refund-dispatch.ts';
import {PostgresPlacementRefundEffectStore, RefundEffectError} from './postgres-placement-refund-effect.ts';
import type {PostgresDatabase} from './postgres.ts';
import type {RefundTransactionAdmission} from './postgres-refund-dispatch.ts';

/** Private TEST composition. Financial policy remains the dispatch caller's duty;
 * only authoritative succeeded may end a placement. No HTTP/worker activation.
 */
export function createPrimaryPlacementRefundProcessor(
  db: Pick<PostgresDatabase, 'transaction'>,
  config: Parameters<typeof createPrimaryRefundDispatcher>[1],
  fetcher: typeof fetch = globalThis.fetch,
) {
  const merchant = {...config};
  const dispatch = createPrimaryRefundDispatcher(db, merchant, fetcher);
  const effects = new PostgresPlacementRefundEffectStore(db, merchant);
  return {
    async process(operationId: unknown, authorizeRefund: () => Promise<void>, assertActive?: RefundTransactionAdmission) {
      const verification = await dispatch.dispatch(operationId, authorizeRefund, assertActive);
      if (verification.status !== 'succeeded') return {state: verification.status, verification, effect: null};
      const effect = await effects.apply(verification.operationId, assertActive);
      if (effect.paymentIntentId !== verification.paymentIntentId || effect.providerRefundId !== verification.providerRefundId) throw new RefundEffectError();
      return {state: 'applied' as const, verification, effect};
    },
  };
}
