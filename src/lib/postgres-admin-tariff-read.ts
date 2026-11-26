import { createHash } from 'node:crypto';
import { AdminTariffError, parseAdminTariffResult, type AdminTariffCommand } from './admin-tariff-contract';
import { withAppSessionTransaction } from './app-session-transaction';
import type { PostgresDatabase } from './postgres';
import { PostgresTariffRepository } from './postgres-tariffs';

export async function readAdminTariffs(db: Pick<PostgresDatabase, 'transaction'>, token: string, command: AdminTariffCommand) {
  if (command.action !== 'list') throw new AdminTariffError('READ_ONLY');
  const denied = () => new AdminTariffError('ADMIN_REQUIRED');
  return withAppSessionTransaction(db, token, async (tx, actor) => {
    if (actor.id !== command.expectedAdminId) throw denied();
    const rows = await new PostgresTariffRepository(tx).getStoredTariffs();
    const tariffs = rows.map((row) => ({
      ...row,
      price: row.price.toFixed(2),
      // The read-only transport has no write history. Edits get their revision from the operator.
      revision: createHash('sha256').update(JSON.stringify(row)).digest('hex'),
    }));
    return parseAdminTariffResult(command, { tariffs, receipt: null, history: [] });
  }, { requireAdmin: true, denied });
}
