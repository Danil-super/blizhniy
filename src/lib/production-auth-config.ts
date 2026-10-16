import { constants, openSync, fstatSync, readSync, closeSync, lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { readTimewebMailConfig } from "./timeweb-mail.ts";
import type { AuthMailPayload, MailIntent } from "./mail-outbox";
import type { TransactionalMail } from "./timeweb-mail";

export const productionAuthOrigin = "https://xn----9sbphbgks4a4a.xn--p1ai";
export type ProductionAuthConfig = { origin: string; rateSecret: string; mailKeyFile: string };
function assertServer(): void {
  if (typeof window !== "undefined") throw new Error("Production auth is server-only");
}

/** Producer opt-in: enable only after the schema and all delivery readers support notices. */
export function readConfirmationNoticeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  assertServer();
  const value = env.BLIZHNIY_AUTH_CONFIRMATION_NOTICE;
  if (value === undefined || value === "disabled") return false;
  if (value === "enabled") return true;
  throw new Error("Invalid confirmation notice configuration");
}

/** Separate from local mode: approved host/database/role only, no capture or legacy fallback. */
export function readProductionAuthConfig(env: NodeJS.ProcessEnv = process.env): ProductionAuthConfig | null {
  assertServer();
  if (!env.BLIZHNIY_AUTH_MODE || env.BLIZHNIY_AUTH_MODE === "local") return null;
  try {
    if (env.BLIZHNIY_AUTH_MODE !== "postgres" || env.NODE_ENV !== "production" ||
        env.BLIZHNIY_AUTH_ORIGIN !== productionAuthOrigin || env.BLIZHNIY_DB_HOST !== "17e86f80f26733d39ef4b84d.twc1.net" ||
        env.BLIZHNIY_DB_PORT !== "5432" || env.BLIZHNIY_DB_NAME !== "blizhniy_prod" || env.BLIZHNIY_DB_USER !== "blizhniy_runtime" ||
        !env.BLIZHNIY_DB_PASSWORD || env.BLIZHNIY_DB_SSL_MODE !== "verify-full" ||
        !env.BLIZHNIY_DB_CA_FILE || !isAbsolute(env.BLIZHNIY_DB_CA_FILE) ||
        !env.BLIZHNIY_AUTH_MAIL_KEY_FILE || !isAbsolute(env.BLIZHNIY_AUTH_MAIL_KEY_FILE) ||
        !/^[a-zA-Z0-9_-]{32,128}$/.test(env.BLIZHNIY_AUTH_RATE_SECRET ?? "") ||
        !/^[a-zA-Z0-9_-]{20,256}$/.test(env.TURNSTILE_SECRET_KEY ?? "") ||
        env.BLIZHNIY_LOCAL_MAIL_URL || Object.keys(env).some(key => key.startsWith("PG")) ||
        !readTimewebMailConfig(env)) throw new Error();
    return { origin: productionAuthOrigin, rateSecret: env.BLIZHNIY_AUTH_RATE_SECRET!, mailKeyFile: env.BLIZHNIY_AUTH_MAIL_KEY_FILE };
  } catch { throw new Error("Invalid production auth configuration"); }
}

/** No-follow bounded key read; exact bytes, owned 0600 file below an owned private directory. */
export function readMailEncryptionKey(file: string): Buffer {
  assertServer();
  let descriptor: number | undefined;
  try {
    if (typeof file !== "string" || !isAbsolute(file)) throw new Error();
    const uid = process.getuid?.();
    if (uid === undefined) throw new Error();
    const directory = dirname(file);
    const parent = lstatSync(directory);
    if (realpathSync(directory) !== directory || !parent.isDirectory() || parent.uid !== uid ||
        (parent.mode & 0o777) !== 0o700) throw new Error();
    descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.uid !== uid || (info.mode & 0o777) !== 0o600 || info.size !== 32) throw new Error();
    const bytes = Buffer.alloc(33);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(descriptor, bytes, length, bytes.length-length, null);
      if (!count) break;
      length += count;
    }
    if (length !== 32) { bytes.fill(0); throw new Error(); }
    return bytes.subarray(0, 32);
  } catch { throw new Error("Invalid mail encryption key file"); }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
}

/** Trusted renderer for authenticated outbox payloads; token fragments never enter request URLs. */
export function renderProductionAuthMail(intent: MailIntent, payload: AuthMailPayload): TransactionalMail {
  assertServer();
  if (intent.purpose === "confirm_notice") return { id: intent.id, to: payload.email, subject: "БЛИЖНИЙ: почта подтверждена",
    text: `Почта подтверждена. Ваш аккаунт готов к входу на сайт БЛИЖНИЙ:\n${productionAuthOrigin}/auth\nЭто информационное уведомление; повторно подтверждать email не нужно.` };
  if (intent.purpose === "reset_notice") return { id: intent.id, to: payload.email, subject: "БЛИЖНИЙ: пароль изменён",
    text: "Пароль изменён. Все прежние сессии отозваны. Если это сделали не вы, восстановите доступ на сайте БЛИЖНИЙ и обратитесь в поддержку." };
  const confirming = intent.purpose === "confirm";
  const link = `${productionAuthOrigin}/auth/${confirming ? "confirm" : "reset"}#token=${payload.token}`;
  return { id: intent.id, to: payload.email, subject: `БЛИЖНИЙ: ${confirming ? "подтверждение email" : "восстановление пароля"}`,
    text: `${confirming ? "Подтвердите регистрацию" : "Смените пароль"}: ${link}\nСсылка действительна до ${intent.expiresAt.toISOString()}.\nЕсли вы не запрашивали это действие, проигнорируйте письмо.` };
}
