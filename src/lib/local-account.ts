export type LocalAccountUser = { id: string; email: string; role: "user" | "admin"; isBlocked: false };

const errorStatuses: Record<string, number> = { UNAUTHENTICATED: 401, INVALID_CREDENTIALS: 401, RATE_LIMITED: 429,
  HTTPS_REQUIRED: 503, INVALID_INPUT: 422, AUTH_UNAVAILABLE: 503, SYNTHETIC_EMAIL_REQUIRED: 422 };
export class LocalAccountError extends Error {
  readonly code: string;
  constructor(code: string) { super("Local account request failed"); this.name = "LocalAccountError"; this.code = Object.hasOwn(errorStatuses, code) ? code : "AUTH_UNAVAILABLE"; }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new LocalAccountError("AUTH_UNAVAILABLE");
  return value as Record<string, unknown>;
}
function userView(value: unknown): LocalAccountUser {
  const row = object(value);
  if (Object.keys(row).length !== 4 || typeof row.id !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(row.id) ||
      typeof row.email !== "string" || row.email.length > 254 || !/^[^\s@]+@[^\s@]+\.invalid$/.test(row.email) ||
      !["user", "admin"].includes(row.role as string) || row.isBlocked !== false) throw new LocalAccountError("AUTH_UNAVAILABLE");
  return { id: row.id, email: row.email, role: row.role as "user" | "admin", isBlocked: false };
}
async function request(action: "login" | "session" | "logout", body: unknown): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(`/api/account/${action}`, { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(10000), headers: { "Content-Type": "application/json", "X-Blizhniy-Request": "1" }, body: JSON.stringify(body) });
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
export const localAccount = {
  async login(email: string, password: string): Promise<LocalAccountUser> {
    const payload = await request("login", { email, password });
    if (Object.keys(payload).length !== 2 || payload.status !== "authenticated") throw new LocalAccountError("AUTH_UNAVAILABLE");
    return userView(payload.user);
  },
  async session(): Promise<LocalAccountUser | null> {
    try {
      const payload = await request("session", {});
      if (Object.keys(payload).length !== 1) throw new LocalAccountError("AUTH_UNAVAILABLE");
      return userView(payload.user);
    } catch (error) {
      if (error instanceof LocalAccountError && error.code === "UNAUTHENTICATED") return null;
      throw error;
    }
  },
  async logout(): Promise<void> {
    const payload = await request("logout", {});
    if (Object.keys(payload).length !== 1 || payload.status !== "logged_out") throw new LocalAccountError("AUTH_UNAVAILABLE");
  },
};
