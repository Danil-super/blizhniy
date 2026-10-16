import { randomUUID } from "node:crypto";
import { enqueueAuthMail } from "./mail-outbox";
import type { MailPayloadCipher } from "./mail-outbox";
import { generateSessionToken, hashPassword, hashSessionToken, verifyPassword } from "./identity";
import { REGISTRATION_LEGAL_VERSIONS } from "./registration-legal";
import type { PostgresDatabase, PostgresQueries } from "./postgres";
import { normalizeRegistrationName } from "./account-validation.ts";
import { createDefaultCabinetProfile } from "./cabinet-profile";

export type RegistrationInput = {
  // Optional only for already-open pre-upgrade forms. New forms require a name.
  name?: string;
  email: string;
  password: string;
  acceptedAgreement: true;
  acknowledgedPrivacy: true;
  agreementVersion: string;
  privacyVersion: string;
};

// Internal mail payload. Never return it as API JSON or put it in application logs.
export type EmailConfirmation = { email: string; token: string; expiresAt: Date };

export class RegistrationInputError extends Error {
  constructor() { super("Invalid registration input"); this.name = "RegistrationInputError"; }
}

function canonicalEmail(email: unknown): string | null {
  if (typeof email !== "string" || email.length > 254 || !email.isWellFormed() || /[\u0000-\u001f\u007f]/.test(email)) return null;
  const canonical = email.trim().toLowerCase();
  // Deliberately broad, consistent with app.users/login; actual ownership is verified by email.
  return /^[^\s@]+@[^\s@]+$/.test(canonical) ? canonical : null;
}

function parseInput(input: unknown): RegistrationInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new RegistrationInputError();
  const row = input as Record<string, unknown>;
  const keys = ["email", "password", "acceptedAgreement", "acknowledgedPrivacy", "agreementVersion", "privacyVersion"];
  if (Object.hasOwn(row, "name")) keys.push("name");
  const name = Object.hasOwn(row, "name") ? normalizeRegistrationName(row.name) : undefined;
  const email = canonicalEmail(row.email);
  if (Object.keys(row).length !== keys.length || Object.keys(row).some((key) => !keys.includes(key)) ||
      !email || name === null || typeof row.password !== "string" || row.acceptedAgreement !== true || row.acknowledgedPrivacy !== true ||
      row.agreementVersion !== REGISTRATION_LEGAL_VERSIONS.agreement || row.privacyVersion !== REGISTRATION_LEGAL_VERSIONS.privacy) {
    throw new RegistrationInputError();
  }
  return { ...(name ? { name } : {}), email, password: row.password, acceptedAgreement: true, acknowledgedPrivacy: true,
    agreementVersion: REGISTRATION_LEGAL_VERSIONS.agreement, privacyVersion: REGISTRATION_LEGAL_VERSIONS.privacy };
}

type PendingUser = { id: string; email: string; passwordHash: string; authVersion: string; isBlocked: boolean; emailVerifiedAt: Date | null };
const pendingColumns = `id, email, password_hash as "passwordHash", auth_version as "authVersion",
  is_blocked as "isBlocked", email_verified_at as "emailVerifiedAt"`;
const dummyHash = `scrypt$131072$8$1$${"0".repeat(32)}$${"0".repeat(128)}`;

export class RegistrationStore {
  private readonly db: Pick<PostgresDatabase, "query" | "transaction">;
  private readonly mailCipher: MailPayloadCipher | undefined;

  constructor(db: Pick<PostgresDatabase, "query" | "transaction">, mailCipher?: MailPayloadCipher) {
    if (typeof window !== "undefined") throw new Error("Registration is server-only");
    this.db = db;
    this.mailCipher = mailCipher;
  }

  /** Creates only an ordinary pending account. A duplicate is a no-op, not password recovery. */
  async register(input: unknown): Promise<EmailConfirmation | null> {
    const row = parseInput(input);
    // The same KDF runs for new and existing addresses, outside database locks.
    const passwordHash = await hashPassword(row.password);
    return this.db.transaction(async (tx) => {
      const { rows: [user] } = await tx.query<{ id: string; authVersion: string }>(`
        insert into app.users (email, password_hash) values ($1, $2)
        on conflict (email) do nothing returning id, auth_version as "authVersion"
      `, [row.email, passwordHash]);
      if (!user) return null;
      if (row.name) {
        const profile = createDefaultCabinetProfile({ name: row.name, email: "" });
        const stored = Object.fromEntries(Object.entries(profile).filter(([key]) => !["email", "phoneVerified", "verifiedPhone"].includes(key)));
        await tx.query("insert into app.cabinet_profiles(user_id,profile) values($1,$2::jsonb)", [user.id, JSON.stringify(stored)]);
      }
      await tx.query(`insert into app.registration_legal (user_id, document, version)
        values ($1, 'agreement', $2), ($1, 'privacy', $3)`, [user.id, row.agreementVersion, row.privacyVersion]);
      return this.issueConfirmation(tx, user.id, row.email, user.authVersion);
    });
  }

  private async issueConfirmation(tx: PostgresQueries, userId: string, email: string, authVersion: string): Promise<EmailConfirmation> {
    const token = generateSessionToken();
    const { rows: [row] } = await tx.query<{ createdAt: Date; expiresAt: Date }>(`
      insert into app.email_confirmations (user_id, token_hash, email, auth_version)
      values ($1, $2, $3, $4) returning expires_at as "expiresAt",created_at as "createdAt"
    `, [userId, hashSessionToken(token), email, authVersion]);
    // Queue insertion shares signup/resend's transaction; failure rolls back the source token too.
    if (this.mailCipher) await enqueueAuthMail(tx, this.mailCipher,
      { id: randomUUID(), userId, purpose: "confirm", createdAt: row.createdAt, expiresAt: row.expiresAt }, { email, token });
    return { email, token, expiresAt: row.expiresAt };
  }

  /** Password-gated resend cannot reset a pending account or replace its legal records. */
  async resendConfirmation(email: string, password: string): Promise<EmailConfirmation | null> {
    const canonical = canonicalEmail(email);
    if (!canonical) return null;
    const original = (await this.db.query<PendingUser>(`select ${pendingColumns} from app.users where email=$1`, [canonical])).rows[0];
    const verified = await verifyPassword(password, original?.passwordHash ?? dummyHash);
    if (!original || !verified) return null;
    return this.db.transaction(async (tx) => {
      const current = (await tx.query<PendingUser>(`select ${pendingColumns} from app.users where id=$1 for update`, [original.id])).rows[0];
      if (!current || current.isBlocked || current.emailVerifiedAt || current.email !== canonical ||
          current.passwordHash !== original.passwordHash || current.authVersion !== original.authVersion) return null;
      await tx.query("delete from app.email_confirmations where user_id=$1", [current.id]);
      return this.issueConfirmation(tx, current.id, current.email, current.authVersion);
    });
  }

  /** Atomic consume, with user-first locks shared by resend/login; never creates a session. */
  async confirmEmail(token: string): Promise<boolean> {
    const tokenHash = hashSessionToken(token);
    if (!tokenHash) return false;
    const candidate = (await this.db.query<{ userId: string }>(
      'select user_id as "userId" from app.email_confirmations where token_hash=$1', [tokenHash],
    )).rows[0];
    if (!candidate) return false;
    return this.db.transaction(async (tx) => {
      const user = (await tx.query<PendingUser>(`select ${pendingColumns} from app.users where id=$1 for update`, [candidate.userId])).rows[0];
      if (!user || user.isBlocked || user.emailVerifiedAt) return false;
      // Check wall-clock time after acquiring the lock, not the transaction start time.
      const consumed = await tx.query(`delete from app.email_confirmations
        where token_hash=$1 and user_id=$2 and email=$3 and auth_version=$4 and expires_at > clock_timestamp()
        returning user_id`, [tokenHash, user.id, user.email, user.authVersion]);
      if (consumed.rowCount !== 1) return false;
      await tx.query("update app.users set email_verified_at=clock_timestamp() where id=$1", [user.id]);
      return true;
    });
  }

  async pruneConfirmations(): Promise<number> {
    const result = await this.db.query(`delete from app.email_confirmations c using app.users u
      where c.user_id=u.id and (c.expires_at <= clock_timestamp() or c.email <> u.email or c.auth_version <> u.auth_version or u.email_verified_at is not null)`);
    return result.rowCount ?? 0;
  }

  /** Bounded maintenance: unverified registrations become eligible for deletion after 24 hours. */
  async prunePendingRegistrations(): Promise<number> {
    const result = await this.db.query(`with candidates as (
      select id from app.users where email_verified_at is null and created_at <= clock_timestamp()-interval '24 hours'
      order by created_at, id limit 100 for update skip locked
    ) delete from app.users u using candidates c where u.id=c.id returning u.id`);
    return result.rowCount ?? 0;
  }
}
