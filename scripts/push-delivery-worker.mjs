// Explicit opt-in and protected deployment variables. Journal output contains counts only.
import { createPostgresDatabase } from "../src/lib/postgres.ts";
import { productionAuthOrigin } from "../src/lib/production-auth-config.ts";
import { runPushDeliveryBatch } from "../src/lib/push-delivery-worker.ts";
import { createWebPushTransport } from "../src/lib/push-web-transport.ts";

const controller = new AbortController();
const stop = () => controller.abort();
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
const env = process.env;
let db, stage = "configuration", result;
try {
  const [major, minor] = process.versions.node.split(".").map(Number);
  const args = process.argv.slice(2);
  const mode = args[0];
  if (major !== 22 || minor < 18 || process.platform !== "linux" || process.getuid?.() === 0 ||
      args.length !== 1 || (mode !== "--check" && mode !== "--run") ||
      env.BLIZHNIY_PUSH !== "inbox-v1" || env.NODE_ENV !== "production" ||
      env.BLIZHNIY_DB_HOST !== "17e86f80f26733d39ef4b84d.twc1.net" || env.BLIZHNIY_DB_PORT !== "5432" ||
      env.BLIZHNIY_DB_NAME !== "blizhniy_prod" || env.BLIZHNIY_DB_USER !== "blizhniy_push_worker" ||
      env.BLIZHNIY_DB_SSL_MODE !== "verify-full" || env.NODE_USE_ENV_PROXY === "1") throw new Error("Push delivery unavailable");
  const send = createWebPushTransport({ subject: productionAuthOrigin,
    publicKey: env.BLIZHNIY_PUSH_PUBLIC_KEY ?? "", privateKey: env.BLIZHNIY_PUSH_PRIVATE_KEY ?? "" });
  stage = "database";
  db = createPostgresDatabase(env);
  const { rows: [probe] } = await db.query("select current_user='blizhniy_push_worker'"+
    " and has_function_privilege(to_regprocedure('app_push.claim_delivery(uuid)'),'EXECUTE')"+
    " and has_function_privilege(to_regprocedure('app_push.finish_delivery(uuid,uuid,text,integer)'),'EXECUTE')"+
    " and has_function_privilege(to_regprocedure('app_push.sweep_delivery()'),'EXECUTE') as ready");
  if (!probe?.ready) throw new Error("Push delivery unavailable");
  if (mode === "--run") {
    stage = "delivery";
    result = await runPushDeliveryBatch(db, send, controller.signal);
  }
  stage = "shutdown";
  await db.close();
  db = undefined;
  console.info(JSON.stringify({ event: "push_delivery_worker", status: controller.signal.aborted ? "stopped" : "complete", ...result }));
} catch {
  await db?.close().catch(() => undefined);
  console.info(JSON.stringify({ event: "push_delivery_worker", status: "unavailable", stage }));
  process.exitCode = 1;
} finally {
  process.off("SIGTERM", stop);
  process.off("SIGINT", stop);
}
