"use client";
import { parseListingDraft, parseListingDraftCursor, parseListingDraftId, parseListingDraftRevision } from "./listing-draft-contract";
import type { ListingDraftInput, ListingDraftSnapshot, ListingDraftPage, ListingDraftSummary } from "./listing-draft-contract";

const messages = { UNKNOWN: "Результат операции не подтверждён. Проверьте сохранённую версию перед повтором.",
  UNAUTHENTICATED: "Войдите в аккаунт повторно.", DRAFT_NOT_FOUND: "Черновик недоступен. Проверьте аккаунт.",
  DRAFT_CHANGED: "Черновик изменён. Сверьте сохранённую версию с вашими правками.",
  INVALID_INPUT: "Проверьте данные черновика.", RATE_LIMITED: "Слишком много запросов. Попробуйте позже." };
export class ListingDraftClientError extends Error {
  constructor(readonly code: keyof typeof messages) { super(messages[code]);this.name = "ListingDraftClientError"; }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ListingDraftClientError("UNKNOWN");
  return value as Record<string, unknown>;
}
function view(value: unknown, expectedId?: string): ListingDraftSnapshot {
  const row = object(value), draft = object(row.draft), parsed = parseListingDraft(draft);
  if (Object.keys(row).length !== 3 || Object.keys(draft).length !== 6 ||
      row.id !== parseListingDraftId(row.id) || (expectedId && row.id !== parseListingDraftId(expectedId)) ||
      Object.keys(parsed).some(key => draft[key] !== parsed[key as keyof ListingDraftInput])) throw new ListingDraftClientError("UNKNOWN");
  return { id: row.id as string, revision: parseListingDraftRevision(row.revision), draft: parsed };
}
function pageView(value: unknown): ListingDraftPage {
  const row = object(value);
  if (Object.keys(row).length !== 2 || !Array.isArray(row.items) || row.items.length > 20) throw new ListingDraftClientError("UNKNOWN");
  const items: ListingDraftSummary[] = row.items.map(value => {
    const item = object(value), draft = parseListingDraft({ kind: item.kind, title: item.title, price: item.price });
    if (Object.keys(item).length !== 5 || item.id !== parseListingDraftId(item.id) || item.title !== draft.title || item.price !== draft.price) throw new ListingDraftClientError("UNKNOWN");
    return { id: item.id as string, revision: parseListingDraftRevision(item.revision), kind: draft.kind, title: draft.title, price: draft.price };
  });
  const nextCursor = parseListingDraftCursor(row.nextCursor);
  if (new Set(items.map(item => item.id)).size !== items.length || (nextCursor && (items.length !== 20 || nextCursor.id !== items.at(-1)?.id))) throw new ListingDraftClientError("UNKNOWN");
  return { items, nextCursor };
}
async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body) throw new ListingDraftClientError("UNKNOWN");
  const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "", bytes = 0, complete = false;
  try {
    for (;;) {
      signal.throwIfAborted();const chunk = await reader.read();signal.throwIfAborted();
      if (chunk.done) { complete = true;return JSON.parse(text+decoder.decode()); }
      bytes += chunk.value.byteLength;
      if (bytes > 65536) throw new ListingDraftClientError("UNKNOWN");
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    try { if (!complete) await reader.cancel(); } finally { reader.releaseLock(); }
  }
}
type Options = { signal?: AbortSignal };
async function request(ownerId: string, method: "POST" | "PUT", collection: boolean, body: Record<string, unknown>, options?: Options): Promise<unknown> {
  try {
    options?.signal?.throwIfAborted();
    const owner = parseListingDraftId(ownerId), timeout = AbortSignal.timeout(10000);
    const signal = options?.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
    const response = await fetch(`/api/account/listing-drafts${collection ? "/collection" : ""}`, {
      method, credentials: "same-origin", redirect: "error", cache: "no-store", signal,
      headers: { "Content-Type": "application/json", "X-Blizhniy-Request": "1" }, body: JSON.stringify({ expectedOwnerId: owner, ...body }),
    });
    const payload = await readJson(response, signal);
    if (response.status !== 200) {
      const code = object(object(payload).error).code;
      const statuses = { UNAUTHENTICATED: 401, DRAFT_NOT_FOUND: 404, DRAFT_CHANGED: 409, INVALID_INPUT: 422, RATE_LIMITED: 429 };
      for (const name of Object.keys(statuses) as (keyof typeof statuses)[]) {
        if (code === name && response.status === statuses[name]) throw new ListingDraftClientError(name);
      }
      throw new ListingDraftClientError("UNKNOWN");
    }
    return payload;
  } catch (error) {
    if (error instanceof ListingDraftClientError) throw error;
    throw new ListingDraftClientError("UNKNOWN");
  }
}
async function snapshot(work: () => Promise<unknown>, expectedId?: string): Promise<ListingDraftSnapshot> {
  try { return view(await work(), expectedId); }
  catch (error) { if (error instanceof ListingDraftClientError) throw error;throw new ListingDraftClientError("UNKNOWN"); }
}
/** No browser tokens, identity cache, legacy fallback or automatic retries. */
export const productionDrafts = {
  async list(ownerId: string, cursor: unknown = null, options?: Options): Promise<ListingDraftPage> {
    try { return pageView(await request(ownerId, "POST", true, { cursor: parseListingDraftCursor(cursor) }, options)); }
    catch (error) { if (error instanceof ListingDraftClientError) throw error;throw new ListingDraftClientError("UNKNOWN"); }
  },
  createEmpty: (ownerId: string, key: string, options?: Options) => snapshot(() => request(ownerId, "PUT", true, { creationKey: parseListingDraftId(key) }, options)),
  read: (ownerId: string, id: string, options?: Options) => snapshot(() => request(ownerId, "POST", false, { listingId: parseListingDraftId(id) }, options), id),
  write: (ownerId: string, id: string, revision: string, draft: ListingDraftInput, options?: Options) => snapshot(() => request(ownerId, "PUT", false,
    { listingId: parseListingDraftId(id), expectedRevision: parseListingDraftRevision(revision), draft: parseListingDraft(draft) }, options), id),
};
