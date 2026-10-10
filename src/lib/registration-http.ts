import { createHmac, randomUUID } from "node:crypto";
import { AuthRateLimiter, AuthRequestError, authJson, readAuthJson, readLocalAuthConfig } from "./auth-http";
import type { LocalAuthConfig } from "./auth-http";
import { createPostgresDatabase } from "./postgres";
import { RegistrationInputError, RegistrationStore } from "./registration";
import type { EmailConfirmation } from "./registration";
import { IdentityStore } from "./identity";
import type { IdentityUser } from "./identity";
import { PasswordRecoveryStore, RecoveryInputError } from "./password-recovery";
import type { PasswordRecovery, PasswordResetReceipt } from "./password-recovery";

type Runtime = { store: RegistrationStore; identity: IdentityStore; limiter: AuthRateLimiter; recovery: PasswordRecoveryStore; activeRecoveries: number };
const processState = globalThis as typeof globalThis & { blizhniyRegistrationRuntime?: Runtime };
const actions = new Set(["register", "resend", "confirm", "login", "session", "logout", "recover", "reset"]);
const sessionCookieName = "__Host-blizhniy_session";

function runtime(config: LocalAuthConfig): Runtime {
  if (!processState.blizhniyRegistrationRuntime) {
    const db = createPostgresDatabase();
    processState.blizhniyRegistrationRuntime = { store: new RegistrationStore(db), identity: new IdentityStore(db),
      limiter: new AuthRateLimiter(db, config.rateSecret), recovery: new PasswordRecoveryStore(db), activeRecoveries: 0 };
  }
  return processState.blizhniyRegistrationRuntime;
}

function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new AuthRequestError(422, "INVALID_INPUT");
  return input as Record<string, unknown>;
}

function localEmail(input: unknown): string {
  if (typeof input !== "string" || input.length > 254 || !input.isWellFormed() || /[\u0000-\u001f\u007f]/.test(input) || !/^[^\s@]+@[^\s@]+\.invalid$/i.test(input.trim())) {
    throw new AuthRequestError(422, "SYNTHETIC_EMAIL_REQUIRED");
  }
  return input.trim().toLowerCase();
}

function cookieToken(request: Request): string | null {
  const header = request.headers.get("cookie") ?? "";
  if (header.length > 4096) return null;
  const matches = header.split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${sessionCookieName}=`));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(sessionCookieName.length+1);
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}

function sessionCookie(token: string, maxAge: number): string {
  if (!Number.isInteger(maxAge) || maxAge < 0 || maxAge > 8*3600 || (maxAge > 0 && !/^[a-f0-9]{64}$/.test(token))) {
    throw new Error("Invalid session cookie");
  }
  const expiry = maxAge === 0 ? new Date(0) : new Date(Date.now()+maxAge*1000);
  return `${sessionCookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}; Expires=${expiry.toUTCString()}`;
}

function accountView(user: IdentityUser): IdentityUser {
  return { id: user.id, email: user.email, role: user.role, isBlocked: user.isBlocked };
}

/** Authentication only; a resource handler must additionally check ownership/required role. */
export async function requireAccountSession(request: Request, identity: IdentityStore): Promise<IdentityUser> {
  const token = cookieToken(request);
  const user = token ? await identity.resolveSession(token) : null;
  if (!user) throw new AuthRequestError(401, "UNAUTHENTICATED");
  return accountView(user);
}

async function captureMail(config: LocalAuthConfig, payload: EmailConfirmation | PasswordRecovery | PasswordResetReceipt | null,
  requestId: string, purpose: "confirm" | "recover" | "reset" = "confirm", entryPoint: "http" | "worker" = "http"): Promise<void> {
  // Send a null envelope for a duplicate/invalid resend too; no early mail-side timing branch.
  try {
    const token = payload && "token" in payload ? payload.token : undefined;
    if (payload && purpose !== "reset" && (!token || !/^[a-f0-9]{64}$/.test(token))) throw new Error("Invalid mail payload");
    const text = purpose === "reset" ? "Пароль изменён. Все прежние сессии отозваны. Если это сделали не вы, обратитесь в поддержку."
      : purpose === "recover" ? `Смените пароль: ${config.origin}/auth/local/reset#token=${token}\nСсылка действует 30 минут. Если вы не запрашивали восстановление, проигнорируйте письмо.`
        : `Подтвердите регистрацию: ${config.origin}/auth/local/confirm#token=${token}\nСсылка действует 1 час.`;
    const mail = payload ? { to: localEmail(payload.email), subject: `БЛИЖНИЙ: ${purpose === "confirm" ? "подтверждение email" : purpose === "recover" ? "восстановление пароля" : "пароль изменён"} (локальный стенд)`, text } : null;
    const response = await fetch(config.mailUrl, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(2000),
      headers: { "Content-Type": "application/json", "X-Request-ID": requestId, "X-Blizhniy-Entry-Point": entryPoint,
        Authorization: `Bearer ${createHmac("sha256", config.rateSecret).update("local-mail-capture").digest("hex")}` },
      body: JSON.stringify({ mail }),
    });
    void response.body?.cancel();
    if (response.status !== 204) throw new Error("Capture unavailable");
  } catch {
    console.warn(JSON.stringify({ event: "local_auth_mail_failed", entryPoint, requestId, code: "CAPTURE_UNAVAILABLE" }));
    // Delivery failure must not disclose an account or undo an already committed password reset.
  }
}

/** Local capture only: no durable queue, at most two jobs, no response-time account lookup. */
function startRecovery(state: Runtime, config: LocalAuthConfig, email: string, requestId: string): void {
  if (state.activeRecoveries >= 2) throw new AuthRequestError(503, "AUTH_UNAVAILABLE");
  state.activeRecoveries++;
  void Promise.resolve().then(async () => {
    await captureMail(config, await state.recovery.requestRecovery(email), requestId, "recover", "worker");
  }).catch(() => {
    console.warn(JSON.stringify({ event: "local_auth_recovery_failed", entryPoint: "worker", requestId, code: "RECOVERY_UNAVAILABLE" }));
  }).finally(() => { state.activeRecoveries--; });
}

/** Local-only, default-off account boundary. Registration/confirmation never issue a session. */
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
    if (["login", "session", "logout", "recover", "reset"].includes(action) && !config.origin.startsWith("https://")) {
      throw new AuthRequestError(503, "HTTPS_REQUIRED");
    }
    const row = object(await readAuthJson(request, config));
    if (action === "session" || action === "logout") {
      if (Object.keys(row).length !== 0) throw new AuthRequestError(422, "INVALID_INPUT");
      const token = cookieToken(request);
      if (action === "logout") {
        // No credential-attempt limiter here: users must still be able to leave after rate denial/blocking.
        if (token) await runtime(config).identity.revokeSession(token);
        return respond({ status: "logged_out" }, 200, { "Set-Cookie": sessionCookie("", 0) });
      }
      if (!token) throw new AuthRequestError(401, "UNAUTHENTICATED");
      return respond({ user: await requireAccountSession(request, runtime(config).identity) }, 200);
    }
    let email: string | undefined;
    if (action === "reset") {
      if (Object.keys(row).length !== 2 || Object.keys(row).some((key) => !["token", "password"].includes(key)) ||
          typeof row.token !== "string" || !/^[a-f0-9]{64}$/.test(row.token) || typeof row.password !== "string" || row.password.length > 256) {
        throw new AuthRequestError(422, "INVALID_INPUT");
      }
    } else if (action === "confirm") {
      if (Object.keys(row).length !== 1 || typeof row.token !== "string" || !/^[a-f0-9]{64}$/.test(row.token)) {
        throw new AuthRequestError(422, "INVALID_INPUT");
      }
    } else {
      email = localEmail(row.email);
      if (action === "recover" && (Object.keys(row).length !== 1 || !Object.hasOwn(row, "email"))) throw new AuthRequestError(422, "INVALID_INPUT");
      if ((action === "resend" || action === "login") && (Object.keys(row).length !== 2 || typeof row.password !== "string" || row.password.length > 256)) {
        throw new AuthRequestError(422, "INVALID_INPUT");
      }
    }
    const state = runtime(config);
    const { store, identity, limiter, recovery } = state;
    if (!await limiter.allow(email)) {
      code = "RATE_LIMITED";
      return respond({ error: { code } }, 429, { "Retry-After": "900" });
    }
    if (action === "confirm") {
      if (await store.confirmEmail(row.token as string)) return respond({ status: "confirmed" }, 200);
      code = "INVALID_CONFIRMATION";
      return respond({ error: { code } }, 400);
    }
    if (action === "recover") {
      startRecovery(state, config, email!, requestId);
      return respond({ status: "accepted" }, 202);
    }
    if (action === "reset") {
      const receipt = await recovery.resetPassword(row);
      if (!receipt) throw new AuthRequestError(400, "INVALID_RECOVERY");
      // A failed notification cannot undo the commit or invite a destructive automatic retry.
      await captureMail(config, receipt, requestId, "reset");
      return respond({ status: "password_reset" }, 200);
    }
    if (action === "login") {
      const issued = await identity.login(email!, row.password as string, cookieToken(request) ?? undefined);
      if (!issued) throw new AuthRequestError(401, "INVALID_CREDENTIALS");
      const maxAge = Math.min(8*3600, Math.floor((issued.expiresAt.getTime()-Date.now())/1000));
      if (issued.scope !== "app" || maxAge <= 0) throw new Error("Invalid issued session");
      return respond({ status: "authenticated", user: accountView(issued.user) }, 200, { "Set-Cookie": sessionCookie(issued.token, maxAge) });
    }
    const payload = action === "register" ? await store.register(row) : await store.resendConfirmation(email!, row.password as string);
    await captureMail(config, payload, requestId);
    return respond({ status: "accepted" }, 202);
  } catch (error) {
    if (error instanceof AuthRequestError) { code = error.code; return respond({ error: { code } }, error.status); }
    if (error instanceof RegistrationInputError || error instanceof RecoveryInputError || (error instanceof Error && error.message === "Invalid password")) {
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
