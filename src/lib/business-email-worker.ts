import { randomUUID } from "node:crypto";
import { productionAuthOrigin } from "./production-auth-config.ts";
import { MailError } from "./timeweb-mail.ts";
import type { MailFailureCode, TransactionalMailer } from "./timeweb-mail.ts";
import type { PostgresQueries } from "./postgres.ts";

/** Dispatches neutral notices through the existing SMTP boundary. The journal owns all retry decisions. */
export async function runBusinessEmailBatch(db: PostgresQueries, mailer: Pick<TransactionalMailer, "send">, signal?: AbortSignal) {
  const outcomes: Record<string, number> = {};
  if (signal?.aborted) return { recovered: 0, outcomes };
  const { rows: [sweep] } = await db.query<{ recovered: number }>(
    "select notification_delivery.sweep_business_email() as recovered",
  );
  for (let i = 0; i < 3 && !signal?.aborted; i++) {
    const claim = randomUUID();
    const { rows: [job] } = await db.query<{ id: string; recipient: string | null }>(
      "select id,recipient from notification_delivery.claim_business_email($1)", [claim],
    );
    if (!job || signal?.aborted) break;
    if (!job.recipient) {
      outcomes.cancelled = (outcomes.cancelled ?? 0) + 1;
      continue;
    }
    let outcome: "accepted" | MailFailureCode = "accepted";
    try {
      await mailer.send({ id: job.id, to: job.recipient, subject: "БЛИЖНИЙ: новое уведомление",
        text: `В личном кабинете появилось новое уведомление. Откройте кабинет: ${productionAuthOrigin}/cabinet` });
    } catch (error) {
      outcome = error instanceof MailError ? error.code : "UNKNOWN";
    }
    const { rows: [result] } = await db.query<{ state: string | null }>(
      "select notification_delivery.finish_business_email($1,$2,$3) as state", [job.id, claim, outcome],
    );
    const state = result.state ?? "lost";
    outcomes[state] = (outcomes[state] ?? 0) + 1;
  }
  return { recovered: sweep.recovered, outcomes };
}
