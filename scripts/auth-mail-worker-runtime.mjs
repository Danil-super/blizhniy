import { randomUUID } from "node:crypto";
import { createProductionMailRuntime } from "../src/lib/production-mail-runtime.ts";

/** One bounded batch. SMTP ambiguity/retry decisions stay inside MailDeliveryWorker. */
export async function runAuthMailWorker({ mode, signal, entryPoint = "cli", createRuntime = createProductionMailRuntime,
  report = event => process.stdout.write(JSON.stringify(event)+"\n") }) {
  const started = performance.now(), runId = randomUUID();
  const outcomes = {};
  let runtime, recovered = 0, pruned = 0, stage = "configuration", failureStage;
  try {
    if (!["check", "run"].includes(mode) || !["cli", "systemd"].includes(entryPoint)) throw new Error("Invalid worker mode");
    if (!signal?.aborted) {
      runtime = await createRuntime();
      if (mode === "run" && !signal?.aborted) {
        stage = "cleanup";
        recovered = await runtime.worker.recoverAbandoned(100);
        if (!signal?.aborted) pruned = await runtime.prune();
      }
      stage = "smtp";
      if (!signal?.aborted) await runtime.mailer.verify();
      stage = "delivery";
      if (mode === "run") for (let attempt = 0; attempt < 3 && !signal?.aborted; attempt++) {
        const result = await runtime.worker.runOne(runtime.mailer);
        if (!["idle", "accepted", "cancelled", "failed", "unknown", "ready", "lost"].includes(result?.state)) throw new Error("Invalid worker outcome");
        outcomes[result.state] = (outcomes[result.state] ?? 0)+1;
        if (result.state === "idle") break;
      }
    }
  } catch { failureStage = stage; }
  finally {
    try { await runtime?.close(); } catch { failureStage ??= "shutdown"; }
  }
  report({ event: "auth_mail_worker", runId, mode: ["check", "run"].includes(mode) ? mode : "invalid",
    entryPoint: ["cli", "systemd"].includes(entryPoint) ? entryPoint : "invalid",
    status: failureStage ? "unavailable" : signal?.aborted ? "stopped" : "complete",
    ...(failureStage ? { failureStage } : {}),
    durationMs: Math.round(performance.now()-started), recovered, pruned, outcomes });
  return failureStage ? 1 : 0;
}
