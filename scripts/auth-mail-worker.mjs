// No dotenv or secret command-line flags. systemd supplies a separately protected environment.
import { randomUUID } from "node:crypto";

const controller = new AbortController();
const stop = () => controller.abort();
process.on("SIGTERM", stop); process.on("SIGINT", stop);
process.stdout.on("error", () => { controller.abort(); process.exitCode = 1; });
try {
  const args = process.argv.slice(2);
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (process.platform !== "linux" || major !== 22 || minor < 18 || process.getuid?.() === 0 ||
      args.length !== 1 || !["--check", "--run"].includes(args[0])) throw new Error("Worker unavailable");
  const { runAuthMailWorker } = await import("./auth-mail-worker-runtime.mjs");
  process.exitCode = await runAuthMailWorker({ mode: args[0].slice(2), signal: controller.signal,
    entryPoint: process.env.BLIZHNIY_MAIL_ENTRYPOINT ?? "cli" });
} catch {
  process.stdout.write(JSON.stringify({ event: "auth_mail_worker", runId: randomUUID(), entryPoint: "cli", status: "unavailable", failureStage: "configuration" })+"\n");
  process.exitCode = 1;
} finally { process.off("SIGTERM", stop); process.off("SIGINT", stop); }
