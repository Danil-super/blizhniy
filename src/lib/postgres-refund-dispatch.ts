import {createHash} from 'node:crypto';
import {PostgresRefundRequestStore} from './postgres-refund-requests.ts';
import type {PostgresDatabase, PostgresQueries} from './postgres.ts';

export type RefundDispatchSource = Awaited<ReturnType<PostgresRefundRequestStore['readPrepared']>>;
export type LoadedRefundDispatch = RefundDispatchSource & {candidateId: string | null; attempted: boolean};
export type RefundTransactionAdmission = (tx: PostgresQueries) => Promise<void>;
export class RefundDispatchError extends Error {
  constructor() { super('Refund dispatch requires reconciliation'); this.name = 'RefundDispatchError'; }
}
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
function fail(): never { throw new RefundDispatchError(); }
export function refundDispatchSourceKey(source: RefundDispatchSource): string {
  return createHash('sha256').update(JSON.stringify([source.request, source.payment, source.paymentCapturedAt])).digest('hex');
}
type Merchant = {shopId: string; isTest: boolean};
/** Private TEST send history. An attempt is durable UNKNOWN, not proof of HTTP delivery.
 * No provider calls, automatic SQL retry, financial status or service changes.
 */
export class PostgresRefundDispatchStore {
  private readonly db: Pick<PostgresDatabase, 'transaction'>;
  private readonly merchant: Merchant;
  constructor(db: Pick<PostgresDatabase, 'transaction'>, merchant: Merchant) {
    // Reuse the existing server-only TEST merchant validation without touching SQL.
    new PostgresRefundRequestStore(db, merchant);
    this.db = db; this.merchant = {...merchant};
  }
  private async known(tx: PostgresQueries, operationId: string): Promise<LoadedRefundDispatch> {
    const source = await new PostgresRefundRequestStore({transaction: work => work(tx)}, this.merchant).readPrepared(operationId);
    const candidate = (await tx.query<{id: string; sha256: string}>(`
      select c.provider_refund_id as id,a.request_sha256 as sha256 from app.payment_refund_candidates c
      join app.payment_refund_send_attempts a on a.id=c.attempt_id and a.operation_id=c.operation_id where c.operation_id=$1`, [operationId])).rows[0];
    if (candidate && (!uuid(candidate.id) || candidate.sha256 !== createHash('sha256').update(source.request.requestBody, 'utf8').digest('hex'))) fail();
    const verified = (await tx.query<{id: string}>('select provider_refund_id as id from app.payment_refund_provider_links where operation_id=$1', [operationId])).rows[0];
    if (verified && (!uuid(verified.id) || (candidate && candidate.id !== verified.id))) fail();
    const attempted = (await tx.query<{present: boolean}>('select exists(select 1 from app.payment_refund_send_attempts where operation_id=$1) as present', [operationId])).rows[0];
    if (!attempted) fail();
    return {...source, candidateId: candidate?.id ?? verified?.id ?? null, attempted: attempted.present};
  }
  async load(operationId: unknown): Promise<LoadedRefundDispatch> {
    if (!uuid(operationId)) fail();
    return this.db.transaction(tx => this.known(tx, operationId));
  }
  async authorize(operationId: unknown, attemptId: unknown, assertActive?: RefundTransactionAdmission) {
    if (!uuid(operationId) || !uuid(attemptId)) fail();
    const started = performance.now();
    const result = await this.db.transaction(async tx => {
      const known = await this.known(tx, operationId);
      if (known.candidateId) return {decision: 'recover', known} as const;
      await assertActive?.(tx);
      // Original window is never reset, including after an uncertain send.
      await tx.query('insert into app.payment_refund_dispatch_anchors(operation_id) values($1) on conflict(operation_id) do nothing', [operationId]);
      const existing = (await tx.query<{operationId: string; sha256: string}>(
        'select operation_id as "operationId",request_sha256 as sha256 from app.payment_refund_send_attempts where id=$1', [attemptId])).rows[0];
      // Every possible HTTP send consumes a new durable attempt, including after
      // a lost COMMIT acknowledgement. Reusing an ID must not bypass the cap.
      if (existing) fail();
      await tx.query('insert into app.payment_refund_send_attempts(id,operation_id) values($1,$2)', [attemptId, operationId]);
      const clock = (await tx.query<{remaining: string}>(`select floor(extract(epoch from (authorized_at+interval '23 hours 55 minutes'-clock_timestamp()))*1000)::text as remaining
        from app.payment_refund_dispatch_anchors where operation_id=$1`, [operationId])).rows[0];
      if (!clock || !/^\d+$/.test(clock.remaining) || !Number.isSafeInteger(Number(clock.remaining)) || Number(clock.remaining) <= 0) fail();
      return {decision: 'post', known, attemptId, remainingMs: Number(clock.remaining)} as const;
    });
    if (result.decision === 'recover') return result;
    const remainingMs = result.remainingMs - Math.max(0, performance.now() - started);
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) fail();
    return {...result, remainingMs};
  }
  async bindCandidate(operationId: unknown, attemptId: unknown, providerRefundId: unknown, expected: RefundDispatchSource): Promise<void> {
    if (!uuid(operationId) || !uuid(attemptId) || !uuid(providerRefundId) || !expected || expected.request?.operationId !== operationId) fail();
    const key = refundDispatchSourceKey(expected);
    await this.db.transaction(async tx => {
      const current = await this.known(tx, operationId);
      if (refundDispatchSourceKey(current) !== key || (current.candidateId && current.candidateId !== providerRefundId)) fail();
      const attempt = (await tx.query<{operationId: string; sha256: string}>(
        'select operation_id as "operationId",request_sha256 as sha256 from app.payment_refund_send_attempts where id=$1', [attemptId])).rows[0];
      if (!attempt || attempt.operationId !== operationId || attempt.sha256 !== createHash('sha256').update(current.request.requestBody, 'utf8').digest('hex')) fail();
      if (!current.candidateId) await tx.query('insert into app.payment_refund_candidates(operation_id,attempt_id,provider_refund_id) values($1,$2,$3)', [operationId, attemptId, providerRefundId]);
    });
  }
}
