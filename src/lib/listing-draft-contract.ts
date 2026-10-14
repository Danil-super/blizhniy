import type { ListingKind } from "./types";

export class ListingDraftInputError extends Error {
  constructor() { super("Invalid listing draft input"); this.name = "ListingDraftInputError"; }
}
export type ListingDraftInput = {
  kind: ListingKind;
  title: string;
  description: string;
  categoryId: string | null;
  cityId: string | null;
  /** Exact RUB decimal with two fractional digits, never a floating-point number. */
  price: string | null;
};
export type ListingDraftSnapshot = { id: string; revision: string; draft: ListingDraftInput };

export function parseListingDraftId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)) throw new ListingDraftInputError();
  return value.toLowerCase();
}
export function parseListingDraftRevision(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,18}$/.test(value) || BigInt(value) > BigInt("9223372036854775807")) {
    throw new ListingDraftInputError();
  }
  return value;
}

/** Replacement of the editable core only. Billing, ownership and other feature fields are not input. */
export function parseListingDraft(value: unknown): ListingDraftInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ListingDraftInputError();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new ListingDraftInputError();
  const input = value as Record<string, unknown>;
  const allowed = ["kind", "title", "description", "categoryId", "cityId", "price"];
  if (Reflect.ownKeys(input).some(key => typeof key !== "string" || !allowed.includes(key))) throw new ListingDraftInputError();
  const kind = input.kind;
  if (kind !== "prodam" && kind !== "kuplyu" && kind !== "otdam-darom" && kind !== "arenda") throw new ListingDraftInputError();
  const text = (field: "title" | "description", limit: number, multiline: boolean) => {
    if (!Object.hasOwn(input, field)) return "";
    const result = input[field];
    const controls = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/;
    if (typeof result !== "string" || result.length > limit || !result.isWellFormed() || controls.test(result)) throw new ListingDraftInputError();
    return multiline ? result : result.trim();
  };
  const reference = (field: "categoryId" | "cityId") => !Object.hasOwn(input, field) || input[field] === null
    ? null : parseListingDraftId(input[field]);
  let price: string | null = null;
  if (Object.hasOwn(input, "price") && input.price !== null) {
    if (typeof input.price !== "string" || !/^(0|[1-9][0-9]{0,9})(?:\.[0-9]{1,2})?$/.test(input.price)) throw new ListingDraftInputError();
    const [whole, fraction = ""] = input.price.split(".");
    price = `${whole}.${fraction.padEnd(2, "0")}`;
  }
  return { kind, title: text("title", 160, false), description: text("description", 10000, true),
    categoryId: reference("categoryId"), cityId: reference("cityId"), price };
}
