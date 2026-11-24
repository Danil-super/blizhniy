import { parseListingDraftCursor, parseListingDraftId } from './listing-draft-contract.ts';
import { paymentHistoryStatuses, paymentHistoryTargets } from './payment-history-contract.ts';

export { paymentHistoryStatuses as journalOrderStatuses, paymentHistoryTargets as journalTargetTypes };

function rejected(): never { throw new Error('Invalid payment journal data'); }

function fields(value: unknown, keys: string[]): Record<string, unknown> {
 if (!value || typeof value !== 'object' || Array.isArray(value) ||
     Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) rejected();
 return value as Record<string, unknown>;
}

function choice<T extends string>(value: unknown, allowed: readonly T[]): T {
 if (typeof value !== 'string' || !allowed.some(item => item === value)) return rejected();
 return value as T;
}

function cursor(value: unknown) {
 const { id, createdAt } = fields(value, ['id', 'createdAt']);
 const parsed = parseListingDraftCursor({ id, updatedAt: createdAt })!;
 return { id: parsed.id, createdAt: parsed.updatedAt };
}

export function parseAdminPaymentJournalQuery(value: unknown) {
 const row = fields(value, ['expectedAdminId','kind','status','after']);
 return {
  expectedAdminId: parseListingDraftId(row.expectedAdminId),
  kind: row.kind === null ? null : choice(row.kind, paymentHistoryTargets),
  status: row.status === null ? null : choice(row.status, paymentHistoryStatuses),
  after: row.after === null ? null : cursor(row.after),
 };
}
export type AdminPaymentJournalQuery = ReturnType<typeof parseAdminPaymentJournalQuery>;
export type AdminPaymentJournalCursor = ReturnType<typeof cursor>;

type RefundAction = { kind:'approve' } | { kind:'recover'; operationId:string; providerRefundId:string|null };

function refundAction(value: unknown): RefundAction | null {
 if (value === null) return null;
 if (value && typeof value === 'object' && 'kind' in value && value.kind === 'recover') {
  const row = fields(value, ['kind','operationId','providerRefundId']);
  return { kind:'recover', operationId:parseListingDraftId(row.operationId),
   providerRefundId:row.providerRefundId === null ? null : parseListingDraftId(row.providerRefundId) };
 }
 if (fields(value, ['kind']).kind !== 'approve') rejected();
 return { kind:'approve' };
}

function capture(value: unknown) {
 if (value === null) return null;
 if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value) ||
     !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19)) rejected();
 return value;
}

function item(value: unknown) {
 const hasAction = !!value && typeof value === 'object' && Object.hasOwn(value, 'refundAction');
 const row = fields(value, ['id','targetId','targetType','amount','createdAt','orderStatus','providerStatus','capturedAt',
  'reconciliation','reconciliationCode','fulfillment','fulfilledAt','refund','refundedAt','compensation',...(hasAction ? ['refundAction'] : [])]);
 const { id, createdAt } = cursor({ id: row.id, createdAt: row.createdAt });
 const { amount } = row;
 if (typeof amount !== 'string' || !/^(?:0|[1-9]\d{0,9})\.\d{2}$/.test(amount) || amount === '0.00') rejected();
 const providerStatus = choice(row.providerStatus, ['not_sent','unknown','awaiting_verification','pending','waiting_for_capture','succeeded','canceled'] as const);
 const capturedAt = capture(row.capturedAt);
 const fulfillment = choice(row.fulfillment, ['not_recorded','unavailable','fulfilled','delivered'] as const);
 const fulfilledAt = row.fulfilledAt === null ? null : cursor({ id, createdAt: row.fulfilledAt }).createdAt;
 const refund = choice(row.refund, ['unavailable','none','approved','reserved','prepared','unknown','awaiting_verification','pending','succeeded','canceled','applied'] as const);
 const refundedAt = row.refundedAt === null ? null : cursor({ id, createdAt: row.refundedAt }).createdAt;
 const reconciliation = row.reconciliation === null ? null : choice(row.reconciliation, ['queued','processing','completed','blocked','waiting_phone'] as const);
 const reconciliationCode = row.reconciliationCode === null ? null : choice(row.reconciliationCode,
  ['provider_pending','capture_required','processing_unavailable','publication_blocked','attempts_exhausted','phone_required'] as const);
 const targetType = choice(row.targetType, paymentHistoryTargets);
 const compensation = choice(row.compensation, ['not_applicable','unavailable','none','eligible','queued','processing','completed','blocked','applied'] as const);
 const orderStatus = choice(row.orderStatus, paymentHistoryStatuses);
 const action = hasAction ? refundAction(row.refundAction) : null;
 if (action) {
  const placement = ['listing','vacancy','workRequest','ad_marquee'].includes(targetType);
  if (orderStatus !== 'succeeded' || providerStatus !== 'succeeded' || capturedAt === null ||
      (action.kind === 'approve' && (!placement || refund !== 'none')) ||
      (action.kind === 'recover' && ((!placement && targetType !== 'application') ||
       !['unknown','awaiting_verification','pending','succeeded'].includes(refund)))) rejected();
 }
 if ((capturedAt !== null && providerStatus !== 'succeeded') ||
     (fulfilledAt !== null) !== (fulfillment === 'fulfilled' || fulfillment === 'delivered') ||
     (refundedAt !== null) !== (refund === 'applied') ||
     (reconciliation === 'blocked' && reconciliationCode === null) ||
     (reconciliation === null && reconciliationCode !== null) ||
     (targetType === 'application') === (compensation === 'not_applicable')) rejected();
 return { id, createdAt, amount, targetType, targetId: parseListingDraftId(row.targetId),
  orderStatus, providerStatus, capturedAt,
  fulfillment, fulfilledAt, reconciliation, reconciliationCode, refund, refundedAt, compensation,
  ...(hasAction ? { refundAction:action } : {}) };
}
export type AdminPaymentJournalItem = ReturnType<typeof item>;

const precedes = (a: AdminPaymentJournalCursor, b: AdminPaymentJournalCursor) =>
 a.createdAt < b.createdAt || (a.createdAt === b.createdAt && a.id < b.id);

export function parseAdminPaymentJournalPage(query: AdminPaymentJournalQuery, value: unknown) {
 const page = fields(value, ['items','nextAfter']);
 if (!Array.isArray(page.items) || page.items.length > 50) return rejected();
 const items = page.items.map(item);
 const nextAfter = page.nextAfter === null ? null : cursor(page.nextAfter);
 if (new Set(items.map(entry => entry.id)).size !== items.length) rejected();
 for (const [index, entry] of items.entries()) {
  const upper = items[index-1] ?? query.after;
  if ((upper !== null && !precedes(entry, upper)) ||
      (query.kind !== null && entry.targetType !== query.kind) ||
      (query.status !== null && entry.orderStatus !== query.status)) rejected();
 }
 if (nextAfter && (items.length !== 50 || nextAfter.id !== items[49].id || nextAfter.createdAt !== items[49].createdAt)) rejected();
 return { items, nextAfter };
}
export type AdminPaymentJournalPage = ReturnType<typeof parseAdminPaymentJournalPage>;
