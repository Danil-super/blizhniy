import { randomUUID } from "node:crypto";
import { enqueueAuthMail } from "./mail-outbox";
import type { MailPayloadCipher } from "./mail-outbox";
import { generateSessionToken, hashPassword, hashSessionToken } from "./identity";
import type { PostgresDatabase } from "./postgres";

// Internal mail payloads only, never public JSON/logs. No session is issued by recovery.
export type PasswordRecovery = { email: string; token: string; expiresAt: Date };
export type PasswordResetReceipt = { email: string };
export class RecoveryInputError extends Error {
  constructor() { super("Invalid recovery input"); this.name = "RecoveryInputError"; }
}
type RecoveryUser = { id: string; email: string; authVersion: string; emailVerifiedAt: Date | null };
const columns = 'id, email, auth_version as "authVersion", email_verified_at as "emailVerifiedAt"';

function canonicalEmail(email: unknown): string {
  if (typeof email !== "string" || email.length > 254 || !email.isWellFormed() || /[\u0000-\u001f\u007f]/.test(email)) throw new RecoveryInputError();
  const value = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(value)) throw new RecoveryInputError();
  return value;
}

export class PasswordRecoveryStore {
  private readonly db: Pick<PostgresDatabase, "query" | "transaction">;
  private readonly mailCipher: MailPayloadCipher | undefined;
  constructor(db: Pick<PostgresDatabase, "query" | "transaction">, mailCipher?: MailPayloadCipher) {
    if (typeof window !== "undefined") throw new Error("Recovery is server-only");
    this.db = db;
    this.mailCipher = mailCipher;
  }

  /** Caller must apply shared rate limits and conceal the result behind a uniform mail response. */
  async requestRecovery(email: string): Promise<PasswordRecovery | null> {
    const canonical = canonicalEmail(email);
    return this.db.transaction(async (tx) => {
      const user = (await tx.query<RecoveryUser>(`select ${columns} from app.users where email=$1 for update`, [canonical])).rows[0];
      if (!user?.emailVerifiedAt) return null;
      const token = generateSessionToken();
      // Same user-first ordering as login/confirmation/reset. Rotation cannot partially revoke a link.
      await tx.query("delete from app.password_recoveries where user_id=$1", [user.id]);
      const { rows: [row] } = await tx.query<{ createdAt: Date; expiresAt: Date }>(`insert into app.password_recoveries
        (user_id,token_hash,email,auth_version) values ($1,$2,$3,$4) returning expires_at as "expiresAt",created_at as "createdAt"`,
      [user.id, hashSessionToken(token), user.email, user.authVersion]);
      if (this.mailCipher) await enqueueAuthMail(tx, this.mailCipher,
        { id: randomUUID(), userId: user.id, purpose: "recover", createdAt: row.createdAt, expiresAt: row.expiresAt }, { email: user.email, token });
      return { email: user.email, token, expiresAt: row.expiresAt };
    });
  }

  /** Single-use, unsafe to retry after unknown commit; blocked users remain blocked. */
  async resetPassword(input: unknown): Promise<PasswordResetReceipt | null> {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new RecoveryInputError();
    const row = input as Record<string, unknown>;
    if (Object.keys(row).length !== 2 || Object.keys(row).some((key) => !["token", "password"].includes(key)) ||
        typeof row.token !== "string" || typeof row.password !== "string") throw new RecoveryInputError();
    const tokenHash = hashSessionToken(row.token);
    if (!tokenHash) return null;
    // Same password policy and bounded scrypt, outside transactions; unknown tokens cannot hold locks.
    const passwordHash = await hashPassword(row.password);
    const candidate = (await this.db.query<{ userId: string }>(
      'select user_id as "userId" from app.password_recoveries where token_hash=$1', [tokenHash],
    )).rows[0];
    if (!candidate) return null;
    return this.db.transaction(async (tx) => {
      const user = (await tx.query<RecoveryUser>(`select ${columns} from app.users where id=$1 for update`, [candidate.userId])).rows[0];
      if (!user?.emailVerifiedAt) return null;
      // DELETE's predicate may run before a row-lock wait. Acquire both locks before checking expiry.
      await tx.query("select token_hash from app.password_recoveries where token_hash=$1 for update", [tokenHash]);
      const consumed = await tx.query(`delete from app.password_recoveries
        where token_hash=$1 and user_id=$2 and email=$3 and auth_version=$4 and expires_at > clock_timestamp()
        returning user_id`, [tokenHash, user.id, user.email, user.authVersion]);
      if (consumed.rowCount !== 1) return null;
      await tx.query("update app.users set password_hash=$2,auth_version=auth_version+1 where id=$1", [user.id, passwordHash]);
      await tx.query("delete from app.sessions where user_id=$1", [user.id]);
      await tx.query("delete from app.email_confirmations where user_id=$1", [user.id]);
      if (this.mailCipher) {
        const { rows: [clock] } = await tx.query<{ createdAt: Date }>('select clock_timestamp() as "createdAt"');
        await enqueueAuthMail(tx, this.mailCipher, { id: randomUUID(), userId: user.id, purpose: "reset_notice",
          createdAt: clock.createdAt, expiresAt: new Date(clock.createdAt.getTime()+86400000) }, { email: user.email, token: null });
      }
      return { email: user.email };
    });
  }

  /** Maintenance only: at most 1000 invalid/expired hashes, no account deletion or background schedule. */
  async pruneRecoveries(): Promise<number> {
    const result = await this.db.query(`with candidates as (
      select r.token_hash from app.password_recoveries r join app.users u on u.id=r.user_id
      where r.expires_at <= clock_timestamp() or r.email <> u.email or r.auth_version <> u.auth_version or u.email_verified_at is null
      order by r.expires_at,r.token_hash limit 1000 for update of r skip locked
    ) delete from app.password_recoveries r using candidates c where r.token_hash=c.token_hash`);
    return result.rowCount ?? 0;
  }
}
