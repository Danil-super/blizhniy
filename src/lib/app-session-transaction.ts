import { hashSessionToken } from "./identity";
import type { PostgresDatabase, PostgresQueries } from "./postgres";

export class AppSessionAccessError extends Error {
  constructor() { super("App session access required"); this.name = "AppSessionAccessError"; }
}
type AppPrincipal = { id: string; role: "user" | "admin"; isBlocked: boolean; verified: boolean; authVersion: string };
const liveSession = `token_hash=$1 and user_id=$2 and auth_version=$3 and scope='app'
  and expires_at>clock_timestamp() and last_seen_at>clock_timestamp()-interval '30 minutes'`;

/** User -> session -> resource lock order. Policy is trusted server code, never request fields. */
export async function withAppSessionTransaction<T>(
  db: Pick<PostgresDatabase, "transaction">, token: string, work: (tx: PostgresQueries, user: AppPrincipal) => Promise<T>,
  policy: { requireAdmin?: boolean; denied?: () => Error } = {},
): Promise<T> {
  if (typeof window !== "undefined") throw new Error("App session authorization is server-only");
  const denied = policy.denied ?? (() => new AppSessionAccessError());
  const hash = hashSessionToken(token);
  if (!hash) throw denied();
  return db.transaction(async tx => {
    const { rows: [user] } = await tx.query<AppPrincipal>(`select u.id,u.role,u.is_blocked as "isBlocked",
      u.email_verified_at is not null as verified,u.auth_version::text as "authVersion"
      from app.users u where u.id=(select user_id from app.sessions where token_hash=$1) for update of u`, [hash]);
    if (!user || (policy.requireAdmin && user.role !== "admin") || user.isBlocked || !user.verified) throw denied();
    const values = [hash, user.id, user.authVersion];
    const session = await tx.query(`select token_hash from app.sessions where ${liveSession} for update`, values);
    if (session.rowCount !== 1) throw denied();
    const result = await work(tx, user);
    // Waiting on a resource lock may outlive the session. Do not commit that work.
    const refreshed = await tx.query(`update app.sessions set last_seen_at=least(clock_timestamp(),expires_at)
      where ${liveSession}`, values);
    if (refreshed.rowCount !== 1) throw denied();
    return result;
  });
}
