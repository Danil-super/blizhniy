import { randomUUID } from "node:crypto";
import { AuthRequestError, authJson, readAuthJson } from "./auth-http";
import type { AuthRateLimiter } from "./auth-http";
import { createAccountSessionCookie, readAccountSessionToken } from "./account-cookie";
import { getTrustedProxyIp } from "./trusted-proxy-ip";
import { normalizeMailAddress } from "./timeweb-mail";
import { RegistrationInputError } from "./registration";
import type { RegistrationStore } from "./registration";
import { RecoveryInputError } from "./password-recovery";
import type { PasswordRecoveryStore } from "./password-recovery";
import type { IdentityStore, IdentityUser } from "./identity";
import { REGISTRATION_LEGAL_VERSIONS } from "./registration-legal";
import { productionAuthOrigin } from "./production-auth-config";
import type { ProductionAuthConfig } from "./production-auth-config";
import { normalizeRegistrationName } from "./account-validation.ts";

export type ProductionAccountRuntime = {
  store: Pick<RegistrationStore, "register" | "resendConfirmation" | "confirmEmail">;
  recovery: Pick<PasswordRecoveryStore, "requestRecovery" | "resetPassword">;
  identity: Pick<IdentityStore, "login" | "resolveSession" | "revokeSession">;
  limiter: Pick<AuthRateLimiter, "allowProduction">;
  verifyCaptcha: (token: unknown, ip: string) => Promise<boolean>;
};
type AuthEvent = { event: "account_request"; requestId: string; operation: string; status: number; durationMs: number; code?: string };
const inputKeys = {
  register: ["email", "password", "acceptedAgreement", "acknowledgedPrivacy", "agreementVersion", "privacyVersion", "captchaToken"],
  resend: ["email", "password", "captchaToken"], login: ["email", "password", "captchaToken"],
  confirm: ["token"], recover: ["email", "captchaToken"], reset: ["token", "password", "captchaToken"], session: [], logout: [],
};
type Action = keyof typeof inputKeys;

function parseBody(action: Action, input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new AuthRequestError(422, "INVALID_INPUT");
  const row = input as Record<string, unknown>;
  const keys: readonly string[] = action === "register" && Object.hasOwn(row, "name") ? [...inputKeys.register, "name"] : inputKeys[action];
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))) throw new AuthRequestError(422, "INVALID_INPUT");
  if (keys.includes("captchaToken") && (typeof row.captchaToken !== "string" || !row.captchaToken.trim() || row.captchaToken.length > 2048)) {
    throw new AuthRequestError(422, "INVALID_INPUT");
  }
  if (keys.includes("password") && (typeof row.password !== "string" || row.password.length > 256)) throw new AuthRequestError(422, "INVALID_INPUT");
  if (keys.includes("token") && (typeof row.token !== "string" || !/^[a-f0-9]{64}$/.test(row.token))) throw new AuthRequestError(422, "INVALID_INPUT");
  if (action === "register" && (row.acceptedAgreement !== true || row.acknowledgedPrivacy !== true ||
      row.agreementVersion !== REGISTRATION_LEGAL_VERSIONS.agreement || row.privacyVersion !== REGISTRATION_LEGAL_VERSIONS.privacy)) {
    throw new AuthRequestError(422, "INVALID_INPUT");
  }
  if (action === "register" && Object.hasOwn(row, "name")) {
    const name = normalizeRegistrationName(row.name);
    if (!name) throw new AuthRequestError(422, "INVALID_INPUT");
    row.name = name;
  }
  if (keys.includes("email")) {
    const email = typeof row.email === "string" && row.email.length <= 254 && row.email.isWellFormed()
      ? normalizeMailAddress(row.email.trim().toLowerCase()) : null;
    if (!email) throw new AuthRequestError(422, "INVALID_INPUT");
    return { ...row, email };
  }
  return row;
}
function view(user: IdentityUser): IdentityUser {
  return { id: user.id, email: user.email, role: user.role, isBlocked: user.isBlocked };
}

/** Runtime is lazy: invalid requests cannot create a pool, read keys or call an external provider.
 * Valid recovery is committed before acceptance; no volatile fire-and-forget job or SMTP in HTTP. */
export function createProductionAccountHandler(config: ProductionAuthConfig, getRuntime: () => ProductionAccountRuntime | Promise<ProductionAccountRuntime>,
  audit: (event: AuthEvent) => void = event => console.info(JSON.stringify(event))) {
  if (typeof window !== "undefined" || config.origin !== productionAuthOrigin) throw new Error("Invalid production account boundary");
  return async (request: Request, operation: string): Promise<Response> => {
    const requestId = randomUUID();
    const start = Date.now();
    let status = 503;
    let code: string | undefined;
    const respond = (body: unknown, nextStatus: number, headers?: Record<string, string>) => {
      status = nextStatus;
      return authJson(body, status, { "X-Request-ID": requestId, ...headers });
    };
    try {
      if (!Object.hasOwn(inputKeys, operation)) return respond({ error: { code: "NOT_FOUND" } }, 404);
      const action = operation as Action;
      const input = parseBody(action, await readAuthJson(request, config));
      const ip = getTrustedProxyIp(request.headers);
      if (!ip) throw new AuthRequestError(403, "UNTRUSTED_INGRESS");
      const presented = readAccountSessionToken(request);
      if (action === "session" && !presented) throw new AuthRequestError(401, "UNAUTHENTICATED");
      if (action === "logout" && !presented) return respond({ status: "logged_out" }, 200, { "Set-Cookie": createAccountSessionCookie("", 0) });
      const state = await getRuntime();
      if (action === "logout") {
        if (presented) await state.identity.revokeSession(presented);
        return respond({ status: "logged_out" }, 200, { "Set-Cookie": createAccountSessionCookie("", 0) });
      }
      const email = typeof input.email === "string" ? input.email : undefined;
      if (!await state.limiter.allowProduction(action === "session" ? "session" : "credential", ip, email)) {
        code = "RATE_LIMITED";
        return respond({ error: { code } }, 429, { "Retry-After": "900" });
      }
      if (Object.hasOwn(input, "captchaToken") && await state.verifyCaptcha(input.captchaToken, ip) !== true) {
        throw new AuthRequestError(403, "CAPTCHA_REQUIRED");
      }
      if (action === "session") {
        const user = await state.identity.resolveSession(presented!);
        if (!user || user.isBlocked) throw new AuthRequestError(401, "UNAUTHENTICATED");
        return respond({ user: view(user) }, 200);
      }
      if (action === "confirm") {
        if (!await state.store.confirmEmail(input.token as string)) throw new AuthRequestError(400, "INVALID_CONFIRMATION");
        return respond({ status: "confirmed" }, 200);
      }
      if (action === "recover") {
        await state.recovery.requestRecovery(email!);
        return respond({ status: "accepted" }, 202);
      }
      if (action === "reset") {
        const receipt = await state.recovery.resetPassword({ token: input.token, password: input.password });
        if (!receipt) throw new AuthRequestError(400, "INVALID_RECOVERY");
        return respond({ status: "password_reset" }, 200);
      }
      if (action === "login") {
        const issued = await state.identity.login(email!, input.password as string, presented ?? undefined);
        if (!issued) throw new AuthRequestError(401, "INVALID_CREDENTIALS");
        const maxAge = Math.min(8*3600, Math.floor((issued.expiresAt.getTime()-Date.now())/1000));
        if (issued.scope !== "app" || issued.user.isBlocked || maxAge <= 0) throw new Error("Invalid issued session");
        return respond({ status: "authenticated", user: view(issued.user) }, 200, { "Set-Cookie": createAccountSessionCookie(issued.token, maxAge) });
      }
      if (action === "resend") await state.store.resendConfirmation(email!, input.password as string);
      else {
        const business = Object.fromEntries(Object.entries(input).filter(([key]) => key !== "captchaToken"));
        await state.store.register(business);
      }
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
      audit({ event: "account_request", requestId, operation: Object.hasOwn(inputKeys, operation) ? operation : "unknown",
        status, durationMs: Date.now()-start, code });
    }
  };
}
