import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { PostgresDatabase } from "./postgres";

const hashPrefix = "scrypt$131072$8$1$";
const hashPattern = /^scrypt\$131072\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{128})$/;
let activeHashes = 0;

function assertServer(): void {
  if (typeof window !== "undefined") throw new Error("Identity is server-only");
}

function validPassword(password: string): boolean {
  return typeof password === "string" && password.length <= 256 && password.isWellFormed() &&
    !password.includes("\0") && password.trim().length > 0 &&
    [...password].length >= 15 && [...password].length <= 128;
}

async function derivePassword(password: string, salt: Buffer): Promise<Buffer> {
  // Bound memory/CPU before enqueueing work in libuv. HTTP rate limits remain mandatory.
  if (activeHashes >= 2) throw new Error("Password hashing capacity exceeded");
  activeHashes++;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 }, (error, key) => {
        if (error) reject(new Error("Password hashing failed"));
        else resolve(key);
      });
    });
  } finally { activeHashes--; }
}

export async function hashPassword(password: string): Promise<string> {
  assertServer();
  if (!validPassword(password)) throw new Error("Invalid password");
  const salt = randomBytes(16);
  const key = await derivePassword(password, salt);
  try { return `${hashPrefix}${salt.toString("hex")}$${key.toString("hex")}`; }
  finally { key.fill(0); }
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  assertServer();
  if (!validPassword(password) || typeof encoded !== "string" || encoded.length > 256) return false;
  const parts = hashPattern.exec(encoded);
  if (!parts) return false;
  const key = await derivePassword(password, Buffer.from(parts[1], "hex"));
  try { return timingSafeEqual(key, Buffer.from(parts[2], "hex")); }
  finally { key.fill(0); }
}

export function generateSessionToken(): string {
  assertServer();
  return randomBytes(32).toString("hex");
}

export function hashSessionToken(token: string): string | null {
  assertServer();
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return null;
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export type IdentityUser = {
  id: string;
  email: string;
  role: "user" | "admin";
  isBlocked: boolean;
};

type CredentialRow = IdentityUser & {
  passwordHash: string;
  authVersion: string;
  emailVerifiedAt: Date | null;
};

export type IssuedSession = { token: string; expiresAt: Date; user: IdentityUser; scope: "app" | "data-subject" };

const credentialColumns = `id, email, role, is_blocked as "isBlocked", password_hash as "passwordHash",
  auth_version as "authVersion", email_verified_at as "emailVerifiedAt"`;
// No matching account still does the same KDF. This is not a usable credential.
const dummyHash = `${hashPrefix}${"0".repeat(32)}$${"0".repeat(128)}`;

function safeUser(row: IdentityUser): IdentityUser {
  return { id: row.id, email: row.email, role: row.role, isBlocked: row.isBlocked };
}

export class IdentityStore {
  private readonly db: Pick<PostgresDatabase, "query" | "transaction">;

  constructor(db: Pick<PostgresDatabase, "query" | "transaction">) {
    assertServer();
    this.db = db;
  }

  login(email: string, password: string, previousToken?: string): Promise<IssuedSession | null> {
    return this.authenticate(email, password, "app", previousToken);
  }

  // Allows a blocked user to request deletion/export even without an old session.
  loginForDataSubject(email: string, password: string): Promise<IssuedSession | null> {
    return this.authenticate(email, password, "data-subject");
  }

  private async authenticate(email: string, password: string, scope: "app" | "data-subject", previousToken?: string): Promise<IssuedSession | null> {
    if (typeof email !== "string" || email.length > 254) return null;
    const canonicalEmail = email.trim().toLowerCase();
    const credential = (await this.db.query<CredentialRow>(
      `select ${credentialColumns} from app.users where email=$1`, [canonicalEmail],
    )).rows[0];
    // Expensive work stays outside database transactions and their locks.
    const verified = await verifyPassword(password, credential?.passwordHash ?? dummyHash);
    if (!credential || !verified) return null;
    return this.db.transaction(async (tx) => {
      // Serializes issuance against password changes and global session revocation.
      const current = (await tx.query<CredentialRow>(
        `select ${credentialColumns} from app.users where id=$1 for update`, [credential.id],
      )).rows[0];
      if (!current || (current.isBlocked && scope === "app") || !current.emailVerifiedAt || current.email !== canonicalEmail ||
          current.passwordHash !== credential.passwordHash || current.authVersion !== credential.authVersion) return null;
      const previousHash = previousToken === undefined ? null : hashSessionToken(previousToken);
      // A successful browser account switch must revoke its old app token in the same commit.
      if (previousHash && scope === "app") await tx.query("delete from app.sessions where token_hash=$1 and scope='app'", [previousHash]);
      const token = generateSessionToken();
      const { rows: [session] } = await tx.query<{ expiresAt: Date }>(
        'insert into app.sessions (token_hash, user_id, auth_version, scope) values ($1, $2, $3, $4) returning expires_at as "expiresAt"',
        [hashSessionToken(token), current.id, current.authVersion, scope],
      );
      return { token, expiresAt: session.expiresAt, user: safeUser(current), scope };
    });
  }

  private async resolve(token: string, allowBlocked: boolean): Promise<IdentityUser | null> {
    const tokenHash = hashSessionToken(token);
    if (!tokenHash) return null;
    const { rows: [user] } = await this.db.query<IdentityUser>(`
      update app.sessions s set last_seen_at=now() from app.users u
      where s.token_hash=$1 and u.id=s.user_id and s.auth_version=u.auth_version
        and s.expires_at > now() and s.last_seen_at > now()-interval '30 minutes'
        and u.email_verified_at is not null and ($2::boolean or not u.is_blocked)
        and ($2::boolean or s.scope='app')
      returning u.id, u.email, u.role, u.is_blocked as "isBlocked"
    `, [tokenHash, allowBlocked]);
    return user ? safeUser(user) : null;
  }

  resolveSession(token: string): Promise<IdentityUser | null> { return this.resolve(token, false); }

  // Use only for ownership-checked export/deletion requests, never ordinary API access.
  resolveDataSubjectSession(token: string): Promise<IdentityUser | null> { return this.resolve(token, true); }

  async revokeSession(token: string): Promise<void> {
    const tokenHash = hashSessionToken(token);
    if (tokenHash) await this.db.query("delete from app.sessions where token_hash=$1", [tokenHash]);
  }

  // Server-internal; the future HTTP caller must authorize the target account.
  async revokeAllSessions(userId: string): Promise<void> {
    await this.db.query("update app.users set auth_version=auth_version+1 where id=$1", [userId]);
  }

  async pruneSessions(): Promise<number> {
    const result = await this.db.query(`
      delete from app.sessions s using app.users u where u.id=s.user_id and
      (s.auth_version <> u.auth_version or s.expires_at <= now() or s.last_seen_at <= now()-interval '30 minutes')
    `);
    return result.rowCount ?? 0;
  }
}
