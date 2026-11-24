import {servicePlacementRefundTarget,type ServiceRefundScope} from './service-checkout-config.ts';
import {applicationRefundAdmitted} from './postgres-refund-requests.ts';
import {createHash} from 'node:crypto';
import {PostgresPaymentIntentStore, PaymentIntentError} from './postgres-payment-intents.ts';
import {buildPlacementRefundRequest} from './refund-request-contract.ts';
import {createPrimaryYooKassaRefundReader} from './primary-yookassa-refund-reader.ts';
import {validatePrimaryYooKassaRefund, mergeRefundVerification, type VerifiedYooKassaRefund} from './yookassa-refund-contract.ts';
import type {PostgresDatabase, PostgresQueries} from './postgres.ts';

export class RefundJournalError extends Error {
  constructor() { super('Refund journal requires reconciliation'); this.name = 'RefundJournalError'; }
}
type Merchant = Parameters<typeof createPrimaryYooKassaRefundReader>[0] & ServiceRefundScope;
export type StoredRefundVerification = {
  operationId: string; paymentIntentId: string; providerRefundId: string; providerPaymentId: string;
  amount: string; currency: 'RUB'; status: VerifiedYooKassaRefund['status']; createdAt: string;
};
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
function fail(): never { throw new RefundJournalError(); }

/** Trusted TEST worker only. GET-proven identity/status, no POST or financial/service writes.
 * Remote I/O never holds a transaction. A missing entry is not permission to send.
 */
export class PostgresRefundJournalStore {
  private readonly db: Pick<PostgresDatabase, 'transaction'>;
  private readonly shopId: string;
  private readonly serviceScope: ServiceRefundScope;
  private readonly intents: PostgresPaymentIntentStore;
  private readonly reader: ReturnType<typeof createPrimaryYooKassaRefundReader>;
  constructor(db: Pick<PostgresDatabase, 'transaction'>, merchant: Merchant, fetcher: typeof fetch = globalThis.fetch) {
    if (!merchant || merchant.isTest !== true) fail();
    this.db = db; this.shopId = merchant.shopId;
    this.serviceScope = {marqueeRefunds:merchant.marqueeRefunds};
    this.reader = createPrimaryYooKassaRefundReader(merchant, fetcher);
    this.intents = new PostgresPaymentIntentStore(db);
  }
  private async known(tx: PostgresQueries, operationId: string) {
    if ((await tx.query<{mode: string}>("select current_setting('transaction_isolation') as mode")).rows[0]?.mode !== 'read committed') fail();
    const reservation = (await tx.query<{paymentIntentId: string}>(
      'select payment_intent_id as "paymentIntentId" from app.payment_refund_reservations where id=$1', [operationId])).rows[0];
    if (!reservation) fail();
    // Financial intent -> order; never take a later user/profile lock.
    const purchase = await this.intents.lockKnownInTransaction(tx, reservation.paymentIntentId).catch(error => {
      if (error instanceof PaymentIntentError) fail(); throw error;
    });
    const order = (await tx.query<{status: string}>('select status from app.payment_orders where id=$1 for update', [purchase.id])).rows[0];
    const source = (await tx.query<{providerPaymentId: string; amount: string; shopId: string; isTest: boolean;
      requestBody: string; idempotenceKey: string; sha256: string; authorizedAt: string; capturedAt: string | null; verifiedStatus: string}>(`
      select r.provider_payment_id as "providerPaymentId",r.amount::text,r.merchant_shop_id as "shopId",r.is_test as "isTest",
       q.request_body as "requestBody",q.idempotence_key as "idempotenceKey",q.request_sha256 as sha256,
       to_char(a.authorized_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "authorizedAt",
       v.captured_at as "capturedAt",v.status as "verifiedStatus"
      from app.payment_refund_reservations r join app.payment_refund_requests q on q.operation_id=r.id
      join app.payment_refund_dispatch_anchors a on a.operation_id=r.id
      join app.payment_verifications v on v.intent_id=r.payment_intent_id and v.provider_payment_id=r.provider_payment_id
      where r.id=$1`, [operationId])).rows[0];
    if (!order || !['succeeded', 'refunded'].includes(order.status) || !source || source.verifiedStatus !== 'succeeded' || typeof source.capturedAt !== 'string' ||
        !purchase.isTest || purchase.shopId !== this.shopId || !(['listing','vacancy','workRequest'].includes(purchase.targetType)&&purchase.durationDays!==null||servicePlacementRefundTarget(purchase,this.serviceScope)||
    purchase.targetType==='application'&&purchase.durationDays===null&&await applicationRefundAdmitted(tx,purchase.id,operationId)) ||
        source.providerPaymentId !== purchase.providerPaymentId || source.amount !== purchase.amount || source.shopId !== purchase.shopId || source.isTest !== true) fail();
    const request = buildPlacementRefundRequest({operationId, paymentIntentId: purchase.id, providerPaymentId: purchase.providerPaymentId, amount: purchase.amount});
    if (source.requestBody !== request.requestBody || source.idempotenceKey !== request.idempotenceKey ||
        source.sha256 !== createHash('sha256').update(source.requestBody, 'utf8').digest('hex')) fail();
    const link = (await tx.query<{id: string}>('select provider_refund_id as id from app.payment_refund_provider_links where operation_id=$1', [operationId])).rows[0];
    const rows = (await tx.query<{id: string; status: VerifiedYooKassaRefund['status']; createdAt: string}>(`
      select provider_refund_id as id,status,provider_created_at as "createdAt" from app.payment_refund_observations
      where operation_id=$1 order by case when status='pending' then 0 else 1 end`, [operationId])).rows;
    if (!!link !== (rows.length > 0)) fail();
    let previous: VerifiedYooKassaRefund | null = null;
    for (const row of rows) {
      if (row.id !== link?.id) fail();
      const verified = validatePrimaryYooKassaRefund({id: row.id, payment_id: purchase.providerPaymentId,
        amount: {value: purchase.amount, currency: 'RUB'}, status: row.status, created_at: row.createdAt},
      {payment: purchase, providerRefundId: row.id, amount: purchase.amount}, Date.now(), source.capturedAt);
      previous = mergeRefundVerification(previous, verified);
    }
    // Compare every immutable source field after remote I/O; never persist/log PII from the original body.
    const fingerprint = createHash('sha256').update(JSON.stringify([purchase, source])).digest('hex');
    return {purchase, source, fingerprint, link, previous};
  }
  private result(operationId: string, paymentIntentId: string, state: VerifiedYooKassaRefund): StoredRefundVerification {
    return {operationId, paymentIntentId, providerRefundId: state.id, providerPaymentId: state.paymentId,
      amount: state.amount.value, currency: 'RUB', status: state.status, createdAt: state.createdAt};
  }
  async read(operationId: unknown): Promise<StoredRefundVerification | null> {
    if (!uuid(operationId)) fail();
    return this.db.transaction(async tx => {
      const known = await this.known(tx, operationId);
      return known.previous ? this.result(operationId, known.purchase.id, known.previous) : null;
    });
  }
  async reconcile(operationId: unknown, candidate?: unknown): Promise<StoredRefundVerification> {
    if (!uuid(operationId) || (candidate !== undefined && !uuid(candidate))) fail();
    const original = await this.db.transaction(tx => this.known(tx, operationId));
    const providerRefundId = candidate ?? original.link?.id;
    if (!uuid(providerRefundId) || (original.link && original.link.id !== providerRefundId)) fail();
    const verified = await this.reader.read({operationId, payment: original.purchase, providerRefundId,
      amount: original.purchase.amount, paymentCapturedAt: original.source.capturedAt ?? undefined});
    return this.db.transaction(async tx => {
      const current = await this.known(tx, operationId);
      if (current.fingerprint !== original.fingerprint || (current.link && current.link.id !== providerRefundId)) fail();
      // Metadata was proved in the GET contract above. Recheck the whitelisted
      // observation against the fresh DB source/capture, without inventing metadata.
      const fresh = validatePrimaryYooKassaRefund({id: verified.id, payment_id: verified.paymentId, amount: verified.amount,
        status: verified.status, created_at: verified.createdAt},
      {payment: current.purchase, providerRefundId, amount: current.purchase.amount}, Date.now(), current.source.capturedAt ?? undefined);
      const merged = mergeRefundVerification(current.previous, fresh);
      if (!current.link) await tx.query('insert into app.payment_refund_provider_links(operation_id,provider_refund_id) values($1,$2)', [operationId, providerRefundId]);
      if (!current.previous || current.previous.status !== merged.status) {
        await tx.query(`insert into app.payment_refund_observations(operation_id,provider_refund_id,status,provider_created_at)
          values($1,$2,$3,$4)`, [operationId, providerRefundId, merged.status, merged.createdAt]);
      }
      return this.result(operationId, current.purchase.id, merged);
    });
  }
}
