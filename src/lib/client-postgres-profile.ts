"use client";
import type { CabinetProfile } from "./cabinet-profile";

const messages = { UNKNOWN: "Результат сохранения не подтверждён. Обновите профиль перед повторной попыткой.",
  SESSION_CHANGED: "Сессия изменилась. Проверьте вход и обновите профиль.", UNAUTHENTICATED: "Войдите в аккаунт повторно.",
  PROFILE_CHANGED: "Профиль изменён в другой вкладке. Скопируйте несохранённые изменения и обновите профиль.",
  INVALID_INPUT: "Проверьте данные профиля.", RATE_LIMITED: "Слишком много запросов. Попробуйте позже." };
type ErrorCode = keyof typeof messages;
export class CookieProfileError extends Error {
  constructor(readonly code: ErrorCode) { super(messages[code]); this.name = "CookieProfileError"; }
}
const stringLimits = { name: 120, phone: 40, city: 80, email: 254, avatarDataUrl: 409623, verifiedPhone: 0,
  organizationName: 120, organizationInn: 12, organizationOgrn: 15, organizationAddress: 160,
  organizationWebsite: 120, organizationDescription: 500 };
const ranges = { avatarZoom: [1,5], avatarPositionX: [0,100], avatarPositionY: [0,100] };
const booleans = ["phoneVerified", "notifyBookings", "notifyMessages", "notifyPayments", "notifyPublicationStatus",
  "notifySystem", "emailNotifications", "pushNotifications"];
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CookieProfileError("UNKNOWN");
  return value as Record<string, unknown>;
}
function profileView(value: unknown): CabinetProfile {
  const row = object(value);
  if (Object.keys(row).length !== Object.keys(stringLimits).length+Object.keys(ranges).length+booleans.length) throw new CookieProfileError("UNKNOWN");
  for (const [key, limit] of Object.entries(stringLimits)) {
    if (typeof row[key] !== "string" || row[key].length > limit) throw new CookieProfileError("UNKNOWN");
  }
  for (const [key, [min,max]] of Object.entries(ranges)) {
    if (typeof row[key] !== "number" || !Number.isFinite(row[key]) || row[key] < min || row[key] > max) throw new CookieProfileError("UNKNOWN");
  }
  if (booleans.some(key => typeof row[key] !== "boolean") || row.phoneVerified !== false || row.verifiedPhone !== "" ||
      (row.avatarDataUrl && !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(row.avatarDataUrl as string))) throw new CookieProfileError("UNKNOWN");
  return row as CabinetProfile;
}
async function readJson(response: Response, signal: AbortSignal): Promise<Record<string, unknown>> {
  if (!response.body) throw new CookieProfileError("UNKNOWN");
  const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "", size = 0, complete = false;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) { complete = true; return object(JSON.parse(text+decoder.decode())); }
      size += value.byteLength;
      if (size > 500000) throw new CookieProfileError("UNKNOWN");
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
type ProfileSnapshot = { profile: CabinetProfile; revision: string | null };
async function request(ownerId: string, method: "POST" | "PUT", profile?: CabinetProfile, expectedRevision?: string | null, options?: { signal?: AbortSignal }): Promise<ProfileSnapshot> {
  options?.signal?.throwIfAborted();
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(ownerId)) throw new CookieProfileError("SESSION_CHANGED");
  if (method === "PUT" && expectedRevision !== null &&
      (typeof expectedRevision !== "string" || !/^[a-f0-9]{64}$/.test(expectedRevision))) throw new CookieProfileError("INVALID_INPUT");
  const timeout = AbortSignal.timeout(10000), signal = options?.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
  try {
    const response = await fetch("/api/account/profile", { method, credentials: "same-origin", redirect: "error", cache: "no-store", signal,
      headers: { "Content-Type": "application/json", "X-Blizhniy-Request": "1" },
      body: JSON.stringify({ expectedOwnerId: ownerId, ...(method === "PUT" ? { profile, expectedRevision } : {}) }) });
    const payload = await readJson(response, signal);
    if (!response.ok) {
      const code = object(payload.error).code;
      const statuses = { SESSION_CHANGED: 409, PROFILE_CHANGED: 409, UNAUTHENTICATED: 401, INVALID_INPUT: 422, RATE_LIMITED: 429 };
      if (typeof code === "string" && Object.hasOwn(statuses, code) && response.status === statuses[code as keyof typeof statuses]) {
        throw new CookieProfileError(code as keyof typeof statuses);
      }
      throw new CookieProfileError("UNKNOWN");
    }
    if (response.status !== 200 || Object.keys(payload).length !== (method === "POST" ? 3 : 2) ||
        (method === "POST" && (typeof payload.exists !== "boolean" || payload.exists !== (payload.revision !== null))) ||
        (payload.revision === null ? method !== "POST" || payload.exists !== false
          : typeof payload.revision !== "string" || !/^[a-f0-9]{64}$/.test(payload.revision))) throw new CookieProfileError("UNKNOWN");
    return { profile: profileView(payload.profile), revision: payload.revision as string | null };
  } catch (error) {
    if (error instanceof CookieProfileError) throw error;
    throw new CookieProfileError("UNKNOWN");
  }
}
/** Browser-owned HttpOnly cookie only. No identity cache, localStorage migration or automatic write retry. */
export const productionProfile = {
  read: (ownerId: string, options?: { signal?: AbortSignal }) => request(ownerId, "POST", undefined, undefined, options),
  write: (ownerId: string, profile: CabinetProfile, expectedRevision: string | null, options?: { signal?: AbortSignal }) => request(ownerId, "PUT", profile, expectedRevision, options),
};
