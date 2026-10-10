import { hashSessionToken } from "./identity";
import type { PostgresDatabase, PostgresQueries } from "./postgres";

export class AdminAccessError extends Error {
  constructor() { super("Admin access required"); this.name = "AdminAccessError"; }
}

type AdminPrincipal = { id: string; role: "user" | "admin"; isBlocked: boolean; verified: boolean; authVersion: string };
const liveSession = `token_hash=$1 and user_id=$2 and auth_version=$3 and scope='app'
  and expires_at>clock_timestamp() and last_seen_at>clock_timestamp()-interval '30 minutes'`;

/** Caller-supplied roles are never authority. No demo bypass, retry or separate pre-check. */
export async function withAdminTransaction<T>(
  db: Pick<PostgresDatabase, "transaction">, token: string, work: (tx: PostgresQueries) => Promise<T>,
): Promise<T> {
  if (typeof window !== "undefined") throw new Error("Admin authorization is server-only");
  const hash = hashSessionToken(token);
  if (!hash) throw new AdminAccessError();
  return db.transaction(async tx => {
    // Same user -> session lock order as login/password changes/global revocation.
    const { rows: [user] } = await tx.query<AdminPrincipal>(`select u.id,u.role,u.is_blocked as "isBlocked",
      u.email_verified_at is not null as verified,u.auth_version::text as "authVersion"
      from app.users u where u.id=(select user_id from app.sessions where token_hash=$1) for update of u`, [hash]);
    if (!user || user.role !== "admin" || user.isBlocked || !user.verified) throw new AdminAccessError();
    const values = [hash, user.id, user.authVersion];
    const session = await tx.query(`select token_hash from app.sessions where ${liveSession} for update`, values);
    if (session.rowCount !== 1) throw new AdminAccessError();
    const result = await work(tx);
    // The session may expire while waiting on a target row; roll back all work then.
    // clock_timestamp(), unlike now(), does not freeze at the transaction's start.
    const refreshed = await tx.query(`update app.sessions set last_seen_at=least(clock_timestamp(),expires_at)
      where ${liveSession}`, values);
    if (refreshed.rowCount !== 1) throw new AdminAccessError();
    return result;
  });
}
