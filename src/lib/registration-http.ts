import { createHmac, randomUUID } from "node:crypto";
import { AuthRateLimiter, AuthRequestError, authJson, readAuthJson, readLocalAuthConfig } from "./auth-http";
import type { LocalAuthConfig } from "./auth-http";
import { createPostgresDatabase } from "./postgres";
import { RegistrationInputError, RegistrationStore } from "./registration";
import type { EmailConfirmation } from "./registration";

type Runtime = { store: RegistrationStore; limiter: AuthRateLimiter };
const processState = globalThis as typeof globalThis & { blizhniyRegistrationRuntime?: Runtime };
const actions = new Set(["register", "resend", "confirm"]);

function runtime(config: LocalAuthConfig): Runtime {
  if (!processState.blizhniyRegistrationRuntime) {
    const db = createPostgresDatabase();
    processState.blizhniyRegistrationRuntime = { store: new RegistrationStore(db), limiter: new AuthRateLimiter(db, config.rateSecret) };
  }
  return processState.blizhniyRegistrationRuntime;
}

function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new AuthRequestError(422, "INVALID_INPUT");
  return input as Record<string, unknown>;
}

function localEmail(input: unknown): string {
  if (typeof input !== "string" || input.length > 254 || !/^[^\s@]+@[^\s@]+\.invalid$/i.test(input.trim())) {
    throw new AuthRequestError(422, "SYNTHETIC_EMAIL_REQUIRED");
  }
  return input.trim().toLowerCase();
}

async function captureMail(config: LocalAuthConfig, payload: EmailConfirmation | null, requestId: string): Promise<void> {
  // Send a null envelope for a duplicate/invalid resend too; no early mail-side timing branch.
  const mail = payload ? { to: localEmail(payload.email), subject: "БЛИЖНИЙ: подтверждение email (локальный стенд)",
    text: `Подтвердите регистрацию: ${config.origin}/auth/local/confirm#token=${payload.token}\nСсылка действует 1 час.` } : null;
  try {
    const response = await fetch(config.mailUrl, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(2000),
      headers: { "Content-Type": "application/json", "X-Request-ID": requestId,
        Authorization: `Bearer ${createHmac("sha256", config.rateSecret).update("local-mail-capture").digest("hex")}` },
      body: JSON.stringify({ mail }),
    });
    void response.body?.cancel();
    if (response.status !== 204) throw new Error("Capture unavailable");
  } catch {
    console.warn(JSON.stringify({ event: "local_auth_mail_failed", entryPoint: "http", requestId, code: "CAPTURE_UNAVAILABLE" }));
    // Do not reveal whether this address has an account. Password-gated resend remains available.
  }
}

/** Local-only, default-off route boundary. No session is issued by registration/confirmation. */
export async function handleRegistrationRequest(request: Request, action: string): Promise<Response> {
  const requestId = randomUUID();
  const start = Date.now();
  let status = 503;
  let code: string | undefined;
  const respond = (body: unknown, nextStatus: number, headers?: Record<string, string>) => {
    status = nextStatus;
    return authJson(body, status, { "X-Request-ID": requestId, ...headers });
  };
  try {
    const config = readLocalAuthConfig();
    if (!config || !actions.has(action)) return respond({ error: { code: "NOT_FOUND" } }, 404);
    const row = object(await readAuthJson(request, config));
    let email: string | undefined;
    if (action === "confirm") {
      if (Object.keys(row).length !== 1 || typeof row.token !== "string" || !/^[a-f0-9]{64}$/.test(row.token)) {
        throw new AuthRequestError(422, "INVALID_INPUT");
      }
    } else {
      email = localEmail(row.email);
      if (action === "resend" && (Object.keys(row).length !== 2 || typeof row.password !== "string")) {
        throw new AuthRequestError(422, "INVALID_INPUT");
      }
    }
    const { store, limiter } = runtime(config);
    if (!await limiter.allow(email)) {
      code = "RATE_LIMITED";
      return respond({ error: { code } }, 429, { "Retry-After": "900" });
    }
    if (action === "confirm") {
      if (await store.confirmEmail(row.token as string)) return respond({ status: "confirmed" }, 200);
      code = "INVALID_CONFIRMATION";
      return respond({ error: { code } }, 400);
    }
    const payload = action === "register" ? await store.register(row) : await store.resendConfirmation(email!, row.password as string);
    await captureMail(config, payload, requestId);
    return respond({ status: "accepted" }, 202);
  } catch (error) {
    if (error instanceof AuthRequestError) { code = error.code; return respond({ error: { code } }, error.status); }
    if (error instanceof RegistrationInputError || (error instanceof Error && error.message === "Invalid password")) {
      code = "INVALID_INPUT";
      return respond({ error: { code } }, 422);
    }
    code = "AUTH_UNAVAILABLE";
    return respond({ error: { code } }, 503);
  } finally {
    // RED-style request events: finite operation/code sets, latency, no URL/body/email/token/IP.
    console.info(JSON.stringify({ event: "local_auth_request", entryPoint: "http", requestId,
      operation: actions.has(action) ? action : "unknown", status, durationMs: Date.now()-start, code }));
  }
}
