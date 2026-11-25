// Explicit opt-in, protected environment only. The worker never logs addresses or mail content.
import { createPostgresDatabase } from "../src/lib/postgres.ts";
import { createTimewebMailer } from "../src/lib/timeweb-mail.ts";
import { runBusinessEmailBatch } from "../src/lib/business-email-worker.ts";

const controller = new AbortController();
const stop = () => controller.abort();
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
const env = process.env;
let db, stage = "configuration", result;
try {
  const [major, minor] = process.versions.node.split(".").map(Number);
  const [mode, extra] = process.argv.slice(2);
  if (major !== 22 || minor < 18 || process.platform !== "linux" || process.getuid?.() === 0 ||
      extra !== undefined || (mode !== "--check" && mode !== "--run") ||
      env.BLIZHNIY_BUSINESS_EMAIL !== "inbox-v1" || env.NODE_ENV !== "production" ||
      env.BLIZHNIY_DB_HOST !== "17e86f80f26733d39ef4b84d.twc1.net" || env.BLIZHNIY_DB_PORT !== "5432" ||
      env.BLIZHNIY_DB_NAME !== "blizhniy_prod" || env.BLIZHNIY_DB_USER !== "blizhniy_business_email" ||
      env.BLIZHNIY_DB_SSL_MODE !== "verify-full") throw new Error("Business email unavailable");
  const mailer = createTimewebMailer(env);
  if (!mailer) throw new Error("Business email unavailable");
  stage = "database";
  db = createPostgresDatabase(env);
  const { rows: [probe] } = await db.query(`select current_user='blizhniy_business_email'
    and has_function_privilege(to_regprocedure('notification_delivery.claim_business_email(uuid)'),'EXECUTE')
    and has_function_privilege(to_regprocedure('notification_delivery.finish_business_email(uuid,uuid,text)'),'EXECUTE')
    and has_function_privilege(to_regprocedure('notification_delivery.sweep_business_email()'),'EXECUTE') as ready`);
  if (!probe?.ready) throw new Error("Business email unavailable");
  if (!controller.signal.aborted && mode === "--check") {
    stage = "smtp";
    await mailer.verify();
  }
  if (mode === "--run") {
    stage = "delivery";
    result = await runBusinessEmailBatch(db, mailer, controller.signal);
  }
  stage = "shutdown";
  await db.close();
  db = undefined;
  console.info(JSON.stringify({ event: "business_email_worker", status: controller.signal.aborted ? "stopped" : "complete", ...result }));
} catch {
  await db?.close().catch(() => undefined);
  console.info(JSON.stringify({ event: "business_email_worker", status: "unavailable", stage }));
  process.exitCode = 1;
} finally {
  process.off("SIGTERM", stop);
  process.off("SIGINT", stop);
}
