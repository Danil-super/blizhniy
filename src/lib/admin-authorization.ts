import { withAppSessionTransaction } from "./app-session-transaction";
import type { PostgresDatabase, PostgresQueries } from "./postgres";

export class AdminAccessError extends Error {
  constructor() { super("Admin access required"); this.name = "AdminAccessError"; }
}

/** Caller-supplied roles are never authority. No demo bypass, retry or separate pre-check. */
export async function withAdminTransaction<T>(
  db: Pick<PostgresDatabase, "transaction">, token: string, work: (tx: PostgresQueries) => Promise<T>,
): Promise<T> {
  if (typeof window !== "undefined") throw new Error("Admin authorization is server-only");
  return withAppSessionTransaction(db, token, work, { requireAdmin: true, denied: () => new AdminAccessError() });
}
