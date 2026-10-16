import { createHash, randomUUID } from "node:crypto";
import type { PostgresDatabase } from "./postgres";
import type { AuthMailPayload, MailIntent, MailPayloadCipher } from "./mail-outbox";
import type { MailFailureCode, TransactionalMail, TransactionalMailer } from "./timeweb-mail";

type DeliveryState = "ready" | "accepted" | "cancelled" | "failed" | "unknown";
export type MailClaim = { id: string; userId: string; claimId: string };
export type DeliveryOutcome = { state: DeliveryState | "idle" | "lost"; id?: string };
type StoredMail = { id: string; user_id: string; purpose: MailIntent["purpose"]; created_at: Date;
  expires_at: Date; key_id: string; payload: Buffer; attempts: number };
type CurrentUser = { email: string; auth_version: string; email_verified_at: Date | null; is_blocked: boolean };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function assertServer(): void {
  if (typeof window !== "undefined") throw new Error("Mail delivery is server-only");
}
function validateClaim(claim: MailClaim): void {
  assertServer();
  if (!claim || ![claim.id, claim.userId, claim.claimId].every(value => typeof value === "string" && uuid.test(value))) {
    throw new Error("Invalid mail claim");
  }
}

/** Only a definitive SMTP 4xx permits retry. Unknown network outcomes may already be accepted. */
export function deliveryFailure(code: MailFailureCode, attempt: number): { state: DeliveryState; delaySeconds: number } {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 5) throw new Error("Invalid delivery attempt");
  if (code === "TEMPORARY" && attempt < 5) return { state: "ready", delaySeconds: 60*2**(attempt-1) };
  return { state: code === "UNKNOWN" ? "unknown" : "failed", delaySeconds: 0 };
}

/** Explicitly instantiated server worker; no startup side effects, scheduler or environment fallback.
 * render is trusted synchronous application code, not an outbox-supplied URL/template. */
export class MailDeliveryWorker {
  private readonly db: Pick<PostgresDatabase, "query" | "transaction">;
  private readonly cipher: MailPayloadCipher;
  private readonly render: (intent: MailIntent, payload: AuthMailPayload) => TransactionalMail;

  constructor(db: Pick<PostgresDatabase, "query" | "transaction">, cipher: MailPayloadCipher,
    render: (intent: MailIntent, payload: AuthMailPayload) => TransactionalMail) {
    assertServer();
    this.db = db;
    this.cipher = cipher;
    this.render = render;
  }

  async claim(): Promise<MailClaim | null> {
    assertServer();
    const claimId = randomUUID();
    const result = await this.db.query<{ id: string; user_id: string }>(`with candidate as (
      select id from app.mail_outbox where state='ready' and attempts<5
      and available_at<=statement_timestamp() and expires_at>statement_timestamp()
      order by available_at,id limit 1 for update skip locked
    ) update app.mail_outbox m set state='reserved',claim_id=$1,lease_until=clock_timestamp()+interval '60 seconds'
      from candidate c where m.id=c.id returning m.id,m.user_id`, [claimId]);
    const row = result.rows[0];
    return row ? { id: row.id, userId: row.user_id, claimId } : null;
  }

  /** Locks user first, then job/source; checks current token state before committing dispatch.
   * SMTP is outside locks. A subsequently revoked in-flight link cannot be recalled, but cannot authenticate. */
  async prepare(claim: MailClaim): Promise<TransactionalMail | null> {
    validateClaim(claim);
    return this.db.transaction(async tx => {
      const user = (await tx.query<CurrentUser>(`select email,auth_version,email_verified_at,is_blocked
        from app.users where id=$1 for update`, [claim.userId])).rows[0];
      const row = (await tx.query<StoredMail>(`select * from app.mail_outbox
        where id=$1 and user_id=$2 and claim_id=$3 and state='reserved' for update`,
      [claim.id, claim.userId, claim.claimId])).rows[0];
      if (!row) return null;
      const cancel = async (state: "cancelled" | "failed", code: string) => {
        await tx.query(`update app.mail_outbox set state=$2,last_code=$3,claim_id=null,lease_until=null where id=$1`, [row.id, state, code]);
        return null;
      };
      // Evaluate after row-lock acquisition, never against the transaction's start time.
      const timing = (await tx.query<{ live: boolean; owned: boolean }>(`select expires_at>clock_timestamp() as live,
        lease_until>clock_timestamp() as owned from app.mail_outbox where id=$1`, [row.id])).rows[0];
      if (!timing.owned) return null;
      if (!user || !timing.live) return cancel("cancelled", "STALE");
      const intent: MailIntent = { id: row.id, userId: row.user_id, purpose: row.purpose,
        createdAt: row.created_at, expiresAt: row.expires_at };
      let payload: AuthMailPayload;
      try { payload = this.cipher.open(intent, row.payload, row.key_id); }
      catch { return cancel("failed", "INVALID_PAYLOAD"); }
      if (payload.email !== user.email) return cancel("cancelled", "STALE");
      if (row.purpose === "confirm_notice" && (!user.email_verified_at || user.is_blocked)) return cancel("cancelled", "STALE");
      if (row.purpose === "confirm" || row.purpose === "recover") {
        if (row.purpose === "confirm" ? user.email_verified_at || user.is_blocked : !user.email_verified_at) {
          return cancel("cancelled", "STALE");
        }
        const tokenHash = createHash("sha256").update(payload.token!).digest("hex");
        // Table names derive solely from authenticated purpose's closed union, never user input.
        const table = row.purpose === "confirm" ? "app.email_confirmations" : "app.password_recoveries";
        await tx.query(`select token_hash from ${table} where user_id=$1 for update`, [row.user_id]);
        const source = await tx.query(`select 1 from ${table} where user_id=$1 and token_hash=$2
          and email=$3 and auth_version=$4 and expires_at>clock_timestamp()
          and date_trunc('milliseconds',expires_at)=$5`,
        [row.user_id, tokenHash, user.email, user.auth_version, row.expires_at]);
        if (source.rowCount !== 1) return cancel("cancelled", "STALE");
      }
      let message: TransactionalMail;
      try {
        message = this.render(intent, payload);
        if (message.id !== row.id || message.to !== payload.email) throw new Error("Invalid mail rendering");
      } catch { return cancel("failed", "INVALID_PAYLOAD"); }
      // Recheck wall clock after source lock/render; committing 'sending' precedes any external side effect.
      const dispatch = await tx.query(`update app.mail_outbox set state='sending',attempts=attempts+1,
        lease_until=clock_timestamp()+interval '60 seconds' where id=$1 and lease_until>clock_timestamp()
        and expires_at>clock_timestamp() and attempts<5 returning id`, [row.id]);
      return dispatch.rowCount === 1 ? message : null;
    });
  }

  async finish(claim: MailClaim, code: "accepted" | MailFailureCode): Promise<DeliveryState | null> {
    validateClaim(claim);
    if (!["accepted", "TEMPORARY", "AUTH_FAILED", "REJECTED", "UNKNOWN"].includes(code)) throw new Error("Invalid delivery outcome");
    return this.db.transaction(async tx => {
      const row = (await tx.query<{ attempts: number }>(`select attempts from app.mail_outbox
        where id=$1 and user_id=$2 and claim_id=$3 and state='sending' for update`, [claim.id, claim.userId, claim.claimId])).rows[0];
      if (!row) return null;
      const outcome = code === "accepted" ? { state: "accepted", delaySeconds: 0 } : deliveryFailure(code, row.attempts);
      const result = await tx.query<{ state: DeliveryState }>(`update app.mail_outbox set state=$2,
        available_at=clock_timestamp()+$3*interval '1 second',last_code=$4,claim_id=null,lease_until=null
        where id=$1 returning state`, [claim.id, outcome.state, outcome.delaySeconds, code === "accepted" ? null : code]);
      return result.rows[0].state;
    });
  }

  /** Reservation can be reclaimed; attempted SMTP cannot. Bounded cleanup, no unrestricted requeue. */
  async recoverAbandoned(limit = 100): Promise<number> {
    assertServer();
    if (!Number.isInteger(limit) || limit<1 || limit>1000) throw new Error("Invalid delivery cleanup limit");
    const result = await this.db.query(`with abandoned as (
      select id from app.mail_outbox where state in ('reserved','sending') and lease_until<=statement_timestamp()
      order by lease_until,id limit $1 for update skip locked
    ) update app.mail_outbox m set state=case when m.state='reserved' then 'ready' else 'unknown' end,
      last_code=case when m.state='reserved' then m.last_code else 'LOST_WORKER' end,
      claim_id=null,lease_until=null from abandoned a where m.id=a.id`, [limit]);
    return result.rowCount ?? 0;
  }

  /** One bounded attempt. Caller schedules polling/cleanup and records only this sanitized result. */
  async runOne(mailer: Pick<TransactionalMailer, "send">): Promise<DeliveryOutcome> {
    assertServer();
    const claim = await this.claim();
    if (!claim) return { state: "idle" };
    const message = await this.prepare(claim);
    if (!message) {
      const row = (await this.db.query<{ state: DeliveryState | "reserved" | "sending" }>(
        "select state from app.mail_outbox where id=$1", [claim.id])).rows[0];
      return { id: claim.id, state: row && ["cancelled", "failed"].includes(row.state) ? row.state as DeliveryState : "lost" };
    }
    let code: "accepted" | MailFailureCode = "accepted";
    try { await mailer.send(message); }
    catch (error) {
      // Raw provider errors and causes are discarded; unknown acceptance is never auto-retried.
      const candidate = error && typeof error === "object" && "code" in error ? error.code : undefined;
      code = typeof candidate === "string" && ["TEMPORARY", "AUTH_FAILED", "REJECTED", "UNKNOWN"].includes(candidate)
        ? candidate as MailFailureCode : "UNKNOWN";
    }
    return { id: claim.id, state: await this.finish(claim, code) ?? "lost" };
  }
}
