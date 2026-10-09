import { createHmac } from "node:crypto";
import type { PostgresQueries } from "./postgres";

export type LocalAuthConfig = { origin: string; mailUrl: string; rateSecret: string };

export function readLocalAuthConfig(env: NodeJS.ProcessEnv = process.env): LocalAuthConfig | null {
  if (!env.BLIZHNIY_AUTH_MODE) return null;
  const invalid = () => { throw new Error("Invalid local auth configuration"); };
  if (env.BLIZHNIY_AUTH_MODE !== "local" || !["test", "development"].includes(env.NODE_ENV ?? "") ||
      !["127.0.0.1", "::1"].includes(env.BLIZHNIY_DB_HOST ?? "") || env.BLIZHNIY_DB_SSL_MODE !== "disable") return invalid();
  const origin = env.BLIZHNIY_AUTH_ORIGIN ?? "";
  const mailUrl = env.BLIZHNIY_LOCAL_MAIL_URL ?? "";
  const rateSecret = env.BLIZHNIY_AUTH_RATE_SECRET ?? "";
  try {
    const app = new URL(origin);
    const mail = new URL(mailUrl);
    for (const url of [app, mail]) {
      if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || Number(url.port) < 1024 ||
          url.username || url.password || url.search || url.hash) return invalid();
    }
    if (origin !== app.origin || mailUrl !== `${mail.origin}/messages` || !/^[a-zA-Z0-9_-]{32,128}$/.test(rateSecret)) return invalid();
  } catch { return invalid(); }
  return { origin, mailUrl, rateSecret };
}

export class AuthRequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super("Invalid request"); this.name = "AuthRequestError"; this.status = status; this.code = code;
  }
}

export function authJson(body: unknown, status: number, headers?: HeadersInit): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'", ...headers } });
}

/** Reject simple/cross-origin requests before reading the bounded body. No Referer fallback. */
export async function readAuthJson(request: Request, config: LocalAuthConfig, deadlineMs = 2000): Promise<unknown> {
  if (request.method !== "POST") throw new AuthRequestError(405, "METHOD_NOT_ALLOWED");
  const url = new URL(request.url);
  if (url.origin !== config.origin || request.headers.get("origin") !== config.origin ||
      request.headers.get("x-blizhniy-request") !== "1" ||
      (request.headers.has("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin")) {
    throw new AuthRequestError(403, "FORBIDDEN_ORIGIN");
  }
  if (url.search) throw new AuthRequestError(400, "QUERY_NOT_ALLOWED");
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")) {
    throw new AuthRequestError(415, "JSON_REQUIRED");
  }
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > 4096)) throw new AuthRequestError(413, "BODY_TOO_LARGE");
  if (!request.body) throw new AuthRequestError(400, "INVALID_JSON");
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let complete = false;
  try {
    const text = await Promise.race([
      (async () => {
        let size = 0;
        let text = "";
        const decoder = new TextDecoder("utf-8", { fatal: true });
        for (;;) {
          const { done, value } = await reader.read();
          if (done) { complete = true; return text + decoder.decode(); }
          size += value.byteLength;
          if (size > 4096) throw new AuthRequestError(413, "BODY_TOO_LARGE");
          text += decoder.decode(value, { stream: true });
        }
      })(),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new AuthRequestError(408, "BODY_TIMEOUT")), deadlineMs); }),
    ]);
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof AuthRequestError) throw error;
    throw new AuthRequestError(400, "INVALID_JSON");
  } finally {
    if (timer) clearTimeout(timer);
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export class AuthRateLimiter {
  private readonly db: PostgresQueries;
  private readonly secret: string;
  constructor(db: PostgresQueries, secret: string) {
    if (typeof window !== "undefined" || !/^[a-zA-Z0-9_-]{32,128}$/.test(secret)) throw new Error("Invalid rate limiter configuration");
    this.db = db; this.secret = secret;
  }

  private async consume(key: string, limit: number): Promise<boolean> {
    const digest = createHmac("sha256", this.secret).update(key).digest("hex");
    const { rows: [row] } = await this.db.query<{ allowed: boolean }>(`
      insert into app.auth_rate_limits (key_hash, window_start, attempts)
      values ($1, to_timestamp(floor(extract(epoch from clock_timestamp())/900)*900), 1)
      on conflict (key_hash, window_start) do update set attempts=least(app.auth_rate_limits.attempts+1, $2+1)
      returning attempts <= $2 as allowed
    `, [digest, limit]);
    return row?.allowed === true;
  }

  /** Conservative shared local limit: 60 overall + 5 per email per fixed 15-minute window. */
  async allow(email?: string): Promise<boolean> {
    if (email !== undefined && (typeof email !== "string" || email.length > 254)) throw new Error("Invalid rate limit key");
    if (!await this.consume("auth:all", 60)) return false;
    return email === undefined || await this.consume(`auth:email:${email.trim().toLowerCase()}`, 5);
  }

  async prune(): Promise<number> {
    const result = await this.db.query(`with candidates as (
      select key_hash, window_start from app.auth_rate_limits where window_start < clock_timestamp()-interval '24 hours'
      order by window_start, key_hash limit 1000 for update skip locked
    ) delete from app.auth_rate_limits r using candidates c where r.key_hash=c.key_hash and r.window_start=c.window_start`);
    return result.rowCount ?? 0;
  }
}
