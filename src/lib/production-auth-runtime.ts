import { randomUUID } from "node:crypto";
import { authJson, AuthRateLimiter } from "./auth-http";
import { createPostgresDatabase } from "./postgres";
import type { PostgresDatabase } from "./postgres";
import { MailPayloadCipher } from "./mail-outbox";
import { MailDeliveryWorker } from "./mail-delivery";
import { createTimewebMailer } from "./timeweb-mail";
import { RegistrationStore } from "./registration";
import { PasswordRecoveryStore } from "./password-recovery";
import { IdentityStore } from "./identity";
import { verifyTurnstileToken } from "./turnstile";
import { readProductionAuthConfig, readMailEncryptionKey, renderProductionAuthMail } from "./production-auth-config";
import type { ProductionAuthConfig } from "./production-auth-config";
import { createProductionAccountHandler } from "./production-account-http";
import type { ProductionAccountRuntime } from "./production-account-http";

type Runtime = { db: PostgresDatabase; cipher: MailPayloadCipher; account: ProductionAccountRuntime; verified: Promise<void> };
const shared = globalThis as typeof globalThis & { blizhniyProductionAuth?: Runtime };

async function verifyRuntimeRole(db: PostgresDatabase): Promise<void> {
  const row = (await db.query<Record<string, unknown>>(`select current_user as name,
    rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,
    has_schema_privilege('app','CREATE') as schema_create,
    has_schema_privilege('public','CREATE') as public_create,
    has_database_privilege(current_database(),'CREATE') as database_create,
    has_database_privilege(current_database(),'TEMP') as temp_create,
    has_column_privilege('app.users','role','UPDATE') as role_update,
    has_column_privilege('app.users','role','INSERT') as role_insert,
    not exists(select 1 from pg_constraint where conrelid='app.auth_rate_limits'::regclass
      and conname='auth_rate_limits_production_attempts_check' and convalidated) as rate_schema_missing
    from pg_roles where rolname=current_user`)).rows[0];
  if (!row || row.name !== "blizhniy_runtime" || row.rate_schema_missing !== false || row.role_insert !== false ||
      Object.entries(row).some(([key,value]) => key !== "name" && value !== false)) {
    throw new Error("Invalid production runtime privileges");
  }
  // Fail before any account write if the required delivery schema/grants have not been applied.
  await db.query("select state,claim_id,lease_until from app.mail_outbox limit 0");
}

function runtime(config: ProductionAuthConfig): Runtime {
  if (typeof window !== "undefined") throw new Error("Production auth is server-only");
  if (!shared.blizhniyProductionAuth) {
    const key = readMailEncryptionKey(config.mailKeyFile);
    let cipher: MailPayloadCipher;
    try {
      if (key.toString("hex") === config.rateSecret) throw new Error("Mail key cannot be the rate secret");
      cipher = new MailPayloadCipher(key);
    } finally { key.fill(0); }
    const db = createPostgresDatabase();
    const account: ProductionAccountRuntime = { store: new RegistrationStore(db, cipher),
      recovery: new PasswordRecoveryStore(db, cipher), identity: new IdentityStore(db),
      limiter: new AuthRateLimiter(db, config.rateSecret), verifyCaptcha: verifyTurnstileToken };
    const verified = verifyRuntimeRole(db).catch(async error => { await db.close(); throw error; });
    shared.blizhniyProductionAuth = { db, cipher, account, verified };
  }
  return shared.blizhniyProductionAuth;
}

/** No imports connect, send SMTP, run migrations or load a key. Restart is required after configuration changes. */
export async function handleProductionAccountRequest(request: Request, action: string): Promise<Response> {
  try {
    const config = readProductionAuthConfig();
    if (!config) return authJson({ error: { code: "NOT_FOUND" } }, 404);
    return await createProductionAccountHandler(config, async () => {
      const state = runtime(config);
      await state.verified;
      return state.account;
    })(request, action);
  } catch {
    const requestId = randomUUID();
    console.warn(JSON.stringify({ event: "account_configuration_failed", requestId, code: "AUTH_UNAVAILABLE" }));
    return authJson({ error: { code: "AUTH_UNAVAILABLE" } }, 503, { "X-Request-ID": requestId });
  }
}

/** Explicit worker entry only. The operator installs its bounded poll/cleanup process separately. */
export async function getProductionMailDelivery() {
  const config = readProductionAuthConfig();
  if (!config) throw new Error("Production mail unavailable");
  const state = runtime(config);
  await state.verified;
  const mailer = createTimewebMailer();
  if (!mailer) throw new Error("Production mail unavailable");
  return { worker: new MailDeliveryWorker(state.db, state.cipher, renderProductionAuthMail), mailer };
}

/** Resource handlers reuse the verified Auth pool; they never accept caller-selected credentials. */
export async function getProductionAccountDatabase(config: ProductionAuthConfig) {
  const state = runtime(config);
  await state.verified;
  return { db: state.db, limiter: state.account.limiter };
}
