import { AppSessionAccessError, withAppSessionTransaction } from './app-session-transaction';
import { hashSessionToken } from './identity';
import type { AdminPaymentJournalItem, AdminPaymentJournalQuery } from './admin-payment-journal-contract.ts';
import type { PostgresDatabase } from './postgres';

export function readAdminPaymentJournal(db: Pick<PostgresDatabase,'transaction'>, shop: string, token: string, command: AdminPaymentJournalQuery, refundActions = false) {
 return withAppSessionTransaction(db, token, async (tx, actor) => {
  if (actor.id !== command.expectedAdminId) throw new AppSessionAccessError();
  const rows = (await tx.query<{ item: AdminPaymentJournalItem }>(
   refundActions ? 'select item from app_payment_admin.list_orders_with_refund_actions($1,$2,$3,$4,$5,$6,$7) as item'
    : 'select item from app_payment_admin.list_orders($1,$2,$3,$4,$5,$6,$7) as item',
   [hashSessionToken(token), actor.id, shop, command.kind, command.status, command.after?.createdAt ?? null, command.after?.id ?? null],
  )).rows;
  const items = rows.slice(0,50).map(row => row.item);
  const last = items.at(-1);
  return { items, nextAfter: rows.length > 50 && last ? { id: last.id, createdAt: last.createdAt } : null };
 }, { requireAdmin: true });
}
