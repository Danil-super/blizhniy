import { createHmac, randomUUID } from "node:crypto";
import { AuthRateLimiter, AuthRequestError, authJson, readAuthJson, readLocalAuthConfig } from "./auth-http";
import type { LocalAuthConfig } from "./auth-http";
import { createPostgresDatabase } from "./postgres";
import { RegistrationInputError, RegistrationStore } from "./registration";
import type { EmailConfirmation } from "./registration";
import { IdentityStore } from "./identity";
import type { IdentityUser } from "./identity";

type Runtime = { store: RegistrationStore; identity: IdentityStore; limiter: AuthRateLimiter };
const processState = globalThis as typeof globalThis & { blizhniyRegistrationRuntime?: Runtime };
const actions = new Set(["register", "resend", "confirm", "login", "session", "logout"]);
const sessionCookieName = "__Host-blizhniy_session";

function runtime(config: LocalAuthConfig): Runtime {
  if (!processState.blizhniyRegistrationRuntime) {
    const db = createPostgresDatabase();
    processState.blizhniyRegistrationRuntime = { store: new RegistrationStore(db), identity: new IdentityStore(db), limiter: new AuthRateLimiter(db, config.rateSecret) };
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
    if (["login", "session", "logout"].includes(action) && !config.origin.startsWith("https://")) {
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
    if (action === "confirm") {
      if (Object.keys(row).length !== 1 || typeof row.token !== "string" || !/^[a-f0-9]{64}$/.test(row.token)) {
        throw new AuthRequestError(422, "INVALID_INPUT");
      }
    } else {
      email = localEmail(row.email);
      if ((action === "resend" || action === "login") && (Object.keys(row).length !== 2 || typeof row.password !== "string" || row.password.length > 256)) {
        throw new AuthRequestError(422, "INVALID_INPUT");
      }
    }
    const { store, identity, limiter } = runtime(config);
    if (!await limiter.allow(email)) {
      code = "RATE_LIMITED";
      return respond({ error: { code } }, 429, { "Retry-After": "900" });
    }
    if (action === "confirm") {
      if (await store.confirmEmail(row.token as string)) return respond({ status: "confirmed" }, 200);
      code = "INVALID_CONFIRMATION";
      return respond({ error: { code } }, 400);
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
