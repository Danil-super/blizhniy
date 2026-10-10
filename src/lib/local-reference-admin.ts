import type { CategoryRow } from "./category-contract";
import type { Tariff } from "./types";

const statuses: Record<string, number> = { UNAUTHENTICATED: 401, ADMIN_REQUIRED: 403, NOT_FOUND: 404,
  INVALID_INPUT: 422, RATE_LIMITED: 429, ADMIN_UNAVAILABLE: 503 };
export class LocalAdminError extends Error {
  readonly code: string;
  constructor(code = "ADMIN_UNAVAILABLE") {
    super("Local administration request failed"); this.name = "LocalAdminError";
    this.code = Object.hasOwn(statuses, code) ? code : "ADMIN_UNAVAILABLE";
  }
}
export function parseAdminPrice(text: string): number {
  const value = text.trim().replace(",", ".");
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(value) || Number(value) > 9999999999.99) throw new LocalAdminError("INVALID_INPUT");
  return Number(value);
}
export function parseAdminDuration(text: string): number | null {
  const value = text.trim();
  if (!value) return null;
  if (!/^\d{1,4}$/.test(value) || Number(value) < 1 || Number(value) > 3650) throw new LocalAdminError("INVALID_INPUT");
  return Number(value);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new LocalAdminError();
  return value as Record<string, unknown>;
}
function shape(value: unknown, keys: string[]): Record<string, unknown> {
  const row = object(value);
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))) throw new LocalAdminError();
  return row;
}
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
function name(value: unknown): boolean { return typeof value === "string" && value.length > 0 && value.length <= 200 && value.isWellFormed() && !/[\x00-\x1f\x7f]/.test(value); }
function category(value: unknown): CategoryRow {
  const row = shape(value, ["id", "parent_id", "slug", "name", "sort_order", "active"]);
  if (typeof row.id !== "string" || !uuid.test(row.id) || (row.parent_id !== null && (typeof row.parent_id !== "string" || !uuid.test(row.parent_id))) ||
      typeof row.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.slug) || !name(row.name) || typeof row.active !== "boolean" ||
      typeof row.sort_order !== "number" || !Number.isSafeInteger(row.sort_order) || row.sort_order < 0 || row.sort_order > 1000000) throw new LocalAdminError();
  return row as CategoryRow;
}
function tariff(value: unknown): Tariff {
  const row = shape(value, ["id", "action", "name", "price", "durationDays", "active"]);
  if (typeof row.id !== "string" || row.id.length > 100 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.id) || !name(row.name) ||
      !["listing_publication", "vacancy_publication", "work_request_publication", "specialist_publication", "job_response", "fair_participation", "ad_marquee"].includes(row.action as string) ||
      typeof row.price !== "number" || !Number.isFinite(row.price) || row.price < 0 || row.price > 9999999999.99 || !/^\d{1,10}(?:\.\d{1,2})?$/.test(String(row.price)) ||
      (row.durationDays !== null && (typeof row.durationDays !== "number" || !Number.isSafeInteger(row.durationDays) || row.durationDays < 1 || row.durationDays > 3650)) || typeof row.active !== "boolean") throw new LocalAdminError();
  return row as Tariff;
}
async function request(resource: "categories" | "tariffs" | "category-order", method: "POST" | "PATCH", body: unknown): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(`/api/admin/local/${resource}`, { method, credentials: "same-origin", cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(10000), headers: { "Content-Type": "application/json", "X-Blizhniy-Request": "1" }, body: JSON.stringify(body) });
    const payload = object(await response.json());
    if (!response.ok) {
      const error = object(payload.error);
      if (typeof error.code !== "string" || statuses[error.code] !== response.status) throw new LocalAdminError();
      throw new LocalAdminError(error.code);
    }
    if (response.status !== 200) throw new LocalAdminError();
    return payload;
  } catch (error) { if (error instanceof LocalAdminError) throw error; throw new LocalAdminError(); }
}
function list<T>(payload: unknown, key: string, parse: (row: unknown) => T): T[] {
  const rows = shape(payload, [key])[key];
  if (!Array.isArray(rows) || rows.length > 2000) throw new LocalAdminError();
  const parsed = rows.map(parse);
  if (new Set(parsed.map(row => (row as { id: string }).id)).size !== parsed.length) throw new LocalAdminError();
  return parsed;
}
function saved(payload: unknown): void { if (shape(payload, ["status"]).status !== "saved") throw new LocalAdminError(); }

// HttpOnly cookie is handled by the browser. No tokens, identity cache, retries or legacy fallback.
export const localReferenceAdmin = {
  async categories(): Promise<CategoryRow[]> { return list(await request("categories", "POST", {}), "categories", category); },
  async tariffs(): Promise<Tariff[]> { return list(await request("tariffs", "POST", {}), "tariffs", tariff); },
  async updateCategory(input: { id: string; name?: string; active?: boolean; sortOrder?: number }): Promise<CategoryRow> {
    return category(shape(await request("categories", "PATCH", input), ["category"]).category);
  },
  async updateTariff(input: { id: string; name?: string; price?: number; durationDays?: number | null; active?: boolean }): Promise<void> {
    saved(await request("tariffs", "PATCH", input));
  },
  async reorder(ids: string[]): Promise<void> { saved(await request("category-order", "PATCH", { ids })); },
};
