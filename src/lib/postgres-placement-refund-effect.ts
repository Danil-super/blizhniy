import type {PostgresDatabase} from './postgres.ts';
import type {RefundTransactionAdmission} from './postgres-refund-dispatch.ts';

export class RefundEffectError extends Error {
  constructor() { super('Refund placement effect requires reconciliation'); this.name = 'RefundEffectError'; }
}
export type PlacementRefundEffect = {
  operationId: string; paymentIntentId: string; providerRefundId: string;
  targetType: 'listing' | 'vacancy' | 'workRequest'; targetId: string;
  effect: 'unfulfilled' | 'revoked' | 'superseded' | 'missing'; appliedAt: string;
};
/** Private TEST capability. SQL atomically validates proof and applies one effect.
 * No network, direct financial/target UPDATE authority or automatic SQL retries.
 */
export class PostgresPlacementRefundEffectStore {
  private readonly db: Pick<PostgresDatabase, 'transaction'>;
  private readonly shopId: string;
  constructor(db: Pick<PostgresDatabase, 'transaction'>, merchant: {shopId: string; isTest: boolean}) {
    if (typeof window !== 'undefined' || !merchant || merchant.isTest !== true ||
        typeof merchant.shopId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(merchant.shopId)) throw new RefundEffectError();
    this.db = db; this.shopId = merchant.shopId;
  }
  async apply(operationId: unknown, assertActive?: RefundTransactionAdmission): Promise<PlacementRefundEffect> {
    if (typeof operationId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(operationId)) throw new RefundEffectError();
    return this.db.transaction(async tx => {
      if (assertActive) {
        // Match the effect trigger's user -> intent -> order order before taking the lease lock.
        await tx.query('select id from app.users where id=(select owner_id from app.payment_checkout_intents where id=(select payment_intent_id from app.payment_refund_reservations where id=$1)) for update', [operationId]);
        await tx.query('select id from app.payment_checkout_intents where id=(select payment_intent_id from app.payment_refund_reservations where id=$1) for update', [operationId]);
        await tx.query('select id from app.payment_orders where id=(select payment_intent_id from app.payment_refund_reservations where id=$1) for update', [operationId]);
        await assertActive(tx);
      }
      await tx.query('insert into app.payment_refund_effects(operation_id,merchant_shop_id) values($1,$2) on conflict(operation_id) do nothing', [operationId, this.shopId]);
      const receipt = (await tx.query<PlacementRefundEffect>(`select operation_id as "operationId",payment_intent_id as "paymentIntentId",
        provider_refund_id as "providerRefundId",target_type as "targetType",target_id as "targetId",effect,
        to_char(applied_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "appliedAt"
        from app.payment_refund_effects where operation_id=$1 and merchant_shop_id=$2`, [operationId, this.shopId])).rows[0];
      if (!receipt) throw new RefundEffectError();
      // Target/notification locks inside the trigger may also outlive the lease.
      await assertActive?.(tx);
      return receipt;
    });
  }
}
