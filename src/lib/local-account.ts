export type LocalAccountUser = { id: string; email: string; role: "user" | "admin"; isBlocked: false };

const errorStatuses: Record<string, number> = { UNAUTHENTICATED: 401, INVALID_CREDENTIALS: 401, RATE_LIMITED: 429,
  HTTPS_REQUIRED: 503, INVALID_INPUT: 422, AUTH_UNAVAILABLE: 503, SYNTHETIC_EMAIL_REQUIRED: 422, CAPTCHA_REQUIRED: 403 };
export class LocalAccountError extends Error {
  readonly code: string;
  constructor(code: string) { super("Local account request failed"); this.name = "LocalAccountError"; this.code = Object.hasOwn(errorStatuses, code) ? code : "AUTH_UNAVAILABLE"; }
}

/** Display hint only. The HttpOnly proof remains unreadable and is verified by the server. */
export function consumeAccountCaptchaResponse(response: Response): void {
  const value = response.headers?.get("X-Blizhniy-Human-Proof");
  if (typeof window === "undefined" || !value || !/^\d{1,16}$/.test(value)) return;
  const expiresAt = Number(value);
  if (!Number.isSafeInteger(expiresAt) || (expiresAt !== 0 && (expiresAt <= Date.now() || expiresAt > Date.now() + 900000))) return;
  window.dispatchEvent(new CustomEvent("blizhniy-human-proof", { detail: { expiresAt } }));
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new LocalAccountError("AUTH_UNAVAILABLE");
  return value as Record<string, unknown>;
}
function userView(value: unknown, production: boolean): LocalAccountUser {
  const row = object(value);
  if (Object.keys(row).length !== 4 || typeof row.id !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(row.id) ||
      typeof row.email !== "string" || row.email.length > 254 ||
      !(production ? /^[a-z0-9.!#$%&'*+\-/=?^_`{|}~]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/ : /^[^\s@]+@[^\s@]+\.invalid$/).test(row.email) ||
      !["user", "admin"].includes(row.role as string) || row.isBlocked !== false) throw new LocalAccountError("AUTH_UNAVAILABLE");
  return { id: row.id, email: row.email, role: row.role as "user" | "admin", isBlocked: false };
}
async function request(action: "login" | "session" | "logout", body: unknown): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(`/api/account/${action}`, { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(10000), headers: { "Content-Type": "application/json", "X-Blizhniy-Request": "1" }, body: JSON.stringify(body) });
    consumeAccountCaptchaResponse(response);
    const payload = object(await response.json());
    if (!response.ok) {
      const error = object(payload.error);
      if (typeof error.code !== "string" || !Object.hasOwn(errorStatuses, error.code) || response.status !== errorStatuses[error.code]) throw new LocalAccountError("AUTH_UNAVAILABLE");
      throw new LocalAccountError(error.code);
    }
    if (response.status !== 200) throw new LocalAccountError("AUTH_UNAVAILABLE");
    return payload;
  } catch (error) {
    if (error instanceof LocalAccountError) throw error;
    throw new LocalAccountError("AUTH_UNAVAILABLE");
  }
}

// The browser owns the HttpOnly cookie; this adapter never receives or persists its token.
function accountClient(production: boolean) { return {
  async login(email: string, password: string, captchaToken?: string): Promise<LocalAccountUser> {
    const payload = await request("login", production ? { email, password, captchaToken } : { email, password });
    if (Object.keys(payload).length !== 2 || payload.status !== "authenticated") throw new LocalAccountError("AUTH_UNAVAILABLE");
    return userView(payload.user, production);
  },
  async session(): Promise<LocalAccountUser | null> {
    try {
      const payload = await request("session", {});
      if (Object.keys(payload).length !== 1) throw new LocalAccountError("AUTH_UNAVAILABLE");
      return userView(payload.user, production);
    } catch (error) {
      if (error instanceof LocalAccountError && error.code === "UNAUTHENTICATED") return null;
      throw error;
    }
  },
  async logout(): Promise<void> {
    const payload = await request("logout", {});
    if (Object.keys(payload).length !== 1 || payload.status !== "logged_out") throw new LocalAccountError("AUTH_UNAVAILABLE");
  },
}; }

export const localAccount = accountClient(false);
export const productionAccount = accountClient(true);

export function openAccountAuthChannel(): BroadcastChannel | null {
  try { return typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("blizhniy-account-auth"); }
  catch { return null; } // Restricted browsers still recheck on focus/visibility/bfcache.
}

/** Invalidation only: messages carry no identity and cannot grant access. */
export function notifyAccountSessionChange(changing: boolean, publisher?: BroadcastChannel | null) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(changing ? "blizhniy-account-changing" : "blizhniy-account-changed"));
  if (!changing) {
    // Reuse a form's listener for publishing: BroadcastChannel excludes the sending object,
    // whereas a new object would invalidate that same form and erase known login errors.
    const channel = publisher ?? openAccountAuthChannel();
    try { channel?.postMessage({ type: "changed" }); }
    catch { return; } // Same-tab invalidation above has already happened; focus is the cross-tab fallback.
    finally { if (!publisher) channel?.close(); }
  }
}
