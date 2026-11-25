import { randomUUID } from "node:crypto";
import type { PostgresQueries } from "./postgres.ts";
import type { PushJob, PushOutcome } from "./push-web-transport.ts";

/** A bounded worker batch. Only a durable claim allows an external call. */
export async function runPushDeliveryBatch(db: PostgresQueries,
  send: (job: PushJob, signal?: AbortSignal) => Promise<PushOutcome>, signal?: AbortSignal) {
  const outcomes: Record<string, number> = {};
  if (signal?.aborted) return { recovered: 0, outcomes };
  const { rows: [sweep] } = await db.query<{ recovered: number }>("select app_push.sweep_delivery() as recovered");
  for (let i = 0; i < 6 && !signal?.aborted; i++) {
    const claim = randomUUID();
    const { rows: [job] } = await db.query<PushJob>("select * from app_push.claim_delivery($1)", [claim]);
    if (!job || signal?.aborted) break;
    if (!job.endpoint) {
      outcomes.cancelled = (outcomes.cancelled ?? 0) + 1;
      continue;
    }
    let result: PushOutcome;
    try { result = await send(job, signal); }
    catch { result = { code: "unknown", delay: 0 }; }
    const { rows: [done] } = await db.query<{ state: string | null }>(
      "select app_push.finish_delivery($1,$2,$3,$4) as state", [job.id, claim, result.code, result.delay]);
    const state = done?.state ?? "lost";
    outcomes[state] = (outcomes[state] ?? 0) + 1;
  }
  return { recovered: sweep.recovered, outcomes };
}
