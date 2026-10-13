// Explicit extensions let the operator use Node22 directly, without a source loader or build-time secrets.
import { createPostgresDatabase } from "./postgres.ts";
import { MailPayloadCipher, pruneExpiredMail } from "./mail-outbox.ts";
import { MailDeliveryWorker } from "./mail-delivery.ts";
import { createTimewebMailer } from "./timeweb-mail.ts";
import { readProductionAuthConfig, readMailEncryptionKey, renderProductionAuthMail } from "./production-auth-config.ts";
import { verifyProductionAuthDatabase } from "./production-auth-database.ts";

/** One short-lived process owns its pool. Importing never loads secrets, connects or sends. */
export async function createProductionMailRuntime(env: NodeJS.ProcessEnv = process.env) {
  const config = readProductionAuthConfig(env);
  if (!config) throw new Error("Production mail unavailable");
  const key = readMailEncryptionKey(config.mailKeyFile);
  let cipher: MailPayloadCipher;
  try {
    if (key.toString("hex") === config.rateSecret) throw new Error("Invalid mail encryption key");
    cipher = new MailPayloadCipher(key);
  } finally { key.fill(0); }
  const db = createPostgresDatabase(env);
  try {
    await verifyProductionAuthDatabase(db);
    const mailer = createTimewebMailer(env);
    if (!mailer) throw new Error("Production mail unavailable");
    return { worker: new MailDeliveryWorker(db, cipher, renderProductionAuthMail), mailer,
      prune: () => pruneExpiredMail(db, 100), close: () => db.close() };
  } catch {
    await db.close();
    throw new Error("Production mail unavailable");
  }
}
