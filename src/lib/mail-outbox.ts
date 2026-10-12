import { createCipheriv, createDecipheriv, createHash, createSecretKey, randomBytes } from "node:crypto";
import { domainToASCII } from "node:url";
import type { KeyObject } from "node:crypto";
import type { PostgresQueries } from "./postgres";

export type MailPurpose = "confirm" | "recover" | "reset_notice";
export type MailIntent = { id: string; userId: string; purpose: MailPurpose; createdAt: Date; expiresAt: Date };
export type AuthMailPayload = { email: string; token: string | null };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const lifetimes = { confirm: 3600000, recover: 1800000, reset_notice: 86400000 };

function assertServer(): void {
  if (typeof window !== "undefined") throw new Error("Mail outbox requires a server-only runtime");
}
function invalid(): never { throw new Error("Invalid encrypted mail payload"); }

function context(intent: MailIntent, keyId: string): Buffer {
  if (!intent || typeof intent.id !== "string" || typeof intent.userId !== "string" || !uuid.test(intent.id) || !uuid.test(intent.userId) ||
      !Object.hasOwn(lifetimes, intent.purpose) || !(intent.createdAt instanceof Date) || !(intent.expiresAt instanceof Date)) return invalid();
  const created = intent.createdAt.getTime();
  const expiry = intent.expiresAt.getTime();
  if (!Number.isFinite(created) || !Number.isFinite(expiry) || expiry <= created ||
      expiry-created > lifetimes[intent.purpose]) return invalid();
  return Buffer.from(JSON.stringify(["blizhniy-mail:v1", keyId, intent.id, intent.userId, intent.purpose,
    intent.createdAt.toISOString(), intent.expiresAt.toISOString()]), "utf8");
}

function validatePayload(input: unknown, purpose: MailPurpose): AuthMailPayload {
  if (!input || typeof input !== "object" || Array.isArray(input)) return invalid();
  const value = input as Record<string, unknown>;
  const { email, token } = value;
  if (Object.keys(value).length !== 2 || !Object.hasOwn(value, "email") || !Object.hasOwn(value, "token") ||
      typeof email !== "string" || email.length > 254 || email !== email.toLowerCase() ||
      !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(email) ||
      domainToASCII(email.split("@")[1]) !== email.split("@")[1] ||
      email.startsWith(".") || email.split("@")[0].endsWith(".") || email.split("@")[0].includes("..") ||
      (purpose === "reset_notice" ? token !== null : typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))) return invalid();
  return { email, token: token as string | null };
}

/** Dedicated random 32-byte key, held outside the database/Git. No SMTP-password or environment fallback. */
export class MailPayloadCipher {
  #key: KeyObject;
  #keyId: string;
  constructor(key: Buffer) {
    assertServer();
    if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error("Invalid mail encryption key");
    this.#key = createSecretKey(key);
    this.#keyId = createHash("sha256").update(key).digest("hex").slice(0, 32);
  }
  get keyId(): string { return this.#keyId; }

  seal(intent: MailIntent, payload: AuthMailPayload): Buffer {
    assertServer();
    const aad = context(intent, this.keyId);
    const plaintext = Buffer.from(JSON.stringify(validatePayload(payload, intent.purpose)), "utf8");
    const nonce = randomBytes(12);
    // https://nodejs.org/docs/latest-v22.x/api/crypto.html#ciphersetaadbuffer-options
    const cipher = createCipheriv("aes-256-gcm", this.#key, nonce, { authTagLength: 16 });
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), ciphertext]);
  }

  open(intent: MailIntent, encrypted: Buffer, storedKeyId: string): AuthMailPayload {
    assertServer();
    try {
      if (storedKeyId !== this.keyId) return invalid();
      const aad = context(intent, storedKeyId);
      if (!Buffer.isBuffer(encrypted) || encrypted.length < 30 || encrypted.length > 2048 || encrypted[0] !== 1) return invalid();
      const decipher = createDecipheriv("aes-256-gcm", this.#key, encrypted.subarray(1, 13), { authTagLength: 16 });
      decipher.setAAD(aad);
      decipher.setAuthTag(encrypted.subarray(13, 29));
      // Never expose or parse plaintext before final() authenticates the entire message.
      const plaintext = Buffer.concat([decipher.update(encrypted.subarray(29)), decipher.final()]);
      return validatePayload(JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(plaintext)), intent.purpose);
    } catch { return invalid(); }
  }
}

/** Must use the query interface from the caller's business transaction. No implicit transaction or retry. */
export async function enqueueAuthMail(tx: PostgresQueries, cipher: MailPayloadCipher, intent: MailIntent,
  payload: AuthMailPayload): Promise<string> {
  assertServer();
  const encrypted = cipher.seal(intent, payload);
  const result = await tx.query<{ id: string }>(`insert into app.mail_outbox
    (id,user_id,purpose,key_id,payload,created_at,expires_at) values($1,$2,$3,$4,$5,$6,$7) returning id`,
  [intent.id, intent.userId, intent.purpose, cipher.keyId, encrypted, intent.createdAt, intent.expiresAt]);
  if (result.rowCount !== 1 || result.rows[0]?.id !== intent.id) throw new Error("Mail enqueue outcome unknown");
  return intent.id;
}

/** Deletes expired encrypted payloads only, in a bounded batch. No delivery worker is running yet. */
export async function pruneExpiredMail(db: PostgresQueries, limit = 100): Promise<number> {
  assertServer();
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("Invalid mail cleanup limit");
  const result = await db.query(`with expired as (
    select id from app.mail_outbox where expires_at <= statement_timestamp()
    order by expires_at,id limit $1 for update skip locked
  ) delete from app.mail_outbox m using expired e where m.id=e.id`, [limit]);
  return result.rowCount ?? 0;
}
