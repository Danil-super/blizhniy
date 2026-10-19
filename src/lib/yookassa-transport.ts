import {YooKassaBoundaryError} from "./yookassa-payment-contract.ts";
const YOOKASSA_REQUEST_BUDGET_MS = 35_000;
const YOOKASSA_MAX_RESPONSE_BYTES = 64 * 1024;
const YOOKASSA_MAX_ATTEMPTS = 3;
export type YooKassaRequestBudget = {
  attempts: number;
  controller: AbortController;
  expired: Promise<never>;
  start: () => void;
  limit: (remainingMs: number) => void;
};


export function createYooKassaTransport(dependencies:{fetch:typeof fetch;monotonicNow:()=>number;setTimeout:typeof setTimeout;clearTimeout:typeof clearTimeout}){
 const {fetch,monotonicNow,setTimeout,clearTimeout}=dependencies;
async function withYooKassaRequestBudget<T>(request: (budget: YooKassaRequestBudget) => Promise<T>) {
  const controller = new AbortController();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let deadlineAt = Infinity;
  function limit(remainingMs: number) {
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
      controller.abort(new YooKassaBoundaryError("YooKassa checkout requires manual verification"));
      controller.signal.throwIfAborted();
    }
    const candidate = monotonicNow() + remainingMs;
    if (candidate >= deadlineAt) return; // Never extend an existing budget.
    deadlineAt = candidate;
    clearTimeout(deadline);
    deadline = setTimeout(() => controller.abort(new YooKassaBoundaryError("YooKassa request timed out")), remainingMs);
  }
  const expired = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
  });
  // The deadline can expire between remote requests while local storage awaits.
  // The next remote operation still fails closed, without an unhandled rejection.
  void expired.catch(() => undefined);
  const budget: YooKassaRequestBudget = {
    attempts: 0, controller, expired,
    start: () => { if (!deadline) limit(YOOKASSA_REQUEST_BUDGET_MS); },
    limit,
  };

  try {
    return await request(budget);
  } finally {
    clearTimeout(deadline);
  }
}

async function readYooKassaJson(response: Response, budget: YooKassaRequestBudget): Promise<unknown> {
  const tooLarge = () => new YooKassaBoundaryError("YooKassa response is too large");
  if (Number(response.headers.get("content-length")) > YOOKASSA_MAX_RESPONSE_BYTES) {
    budget.controller.abort(tooLarge());
    void response.body?.cancel().catch(() => undefined);
    throw budget.controller.signal.reason;
  }
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let chunkCount = 0;
  let complete = false;

  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), budget.expired]);
      if (done) { complete = true; break; }
      bytes += value.byteLength;
      if (bytes > YOOKASSA_MAX_RESPONSE_BYTES || ++chunkCount > 2048) {
        budget.controller.abort(tooLarge());
        throw budget.controller.signal.reason;
      }
      chunks.push(value);
    }
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes))) as unknown;
    } catch {
      if (!response.ok) return null;
      throw new YooKassaBoundaryError("YooKassa returned invalid JSON");
    }
  } finally {
    if (!complete) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function yooKassaHttpError(response: Response, payload: unknown) {
  const errorId = payload && typeof payload === "object" && "id" in payload && typeof payload.id === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(payload.id) ? payload.id : undefined;
  // Provider descriptions and transport error messages may contain sensitive data.
  return new YooKassaBoundaryError(`YooKassa request failed (HTTP ${response.status}${errorId ? `; error id ${errorId}` : ""})`);
}

async function fetchYooKassaJson(
  url: string, init: RequestInit, budget?: YooKassaRequestBudget,
  beforeAttempt?: (budget: YooKassaRequestBudget) => Promise<void>,
): Promise<{ payload: unknown; response: Response }> {
  if (!budget) return withYooKassaRequestBudget((shared) => fetchYooKassaJson(url, init, shared, beforeAttempt));
  budget.start();

  for (let attempt = 1; attempt <= YOOKASSA_MAX_ATTEMPTS; attempt += 1) {
    budget.controller.signal.throwIfAborted();
    if (budget.attempts >= YOOKASSA_MAX_ATTEMPTS) throw new YooKassaBoundaryError("YooKassa request attempt budget exhausted");
    if (beforeAttempt) await Promise.race([beforeAttempt(budget), budget.expired]);
    budget.controller.signal.throwIfAborted();
    budget.attempts += 1;
    try {
      // One deadline covers headers, decoded body and backoff, not each attempt.
      // Source: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch#canceling_a_request
      const response = await Promise.race([fetch(url, { ...init, signal: budget.controller.signal, redirect: "error" }), budget.expired]);
      const payload = await readYooKassaJson(response, budget);
      if (response.status < 500 || budget.attempts === YOOKASSA_MAX_ATTEMPTS) {
        if (!response.ok) throw yooKassaHttpError(response, payload);
        return { payload, response };
      }
    } catch (error) {
      if (error instanceof YooKassaBoundaryError) throw error;
      if (budget.controller.signal.aborted) throw budget.controller.signal.reason;
      if (budget.attempts === YOOKASSA_MAX_ATTEMPTS) throw new YooKassaBoundaryError("YooKassa request failed");
    }
    let backoff: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([new Promise<void>((resolve) => { backoff = setTimeout(resolve, attempt * 500); }), budget.expired]);
    } finally {
      clearTimeout(backoff);
    }
  }
  throw new YooKassaBoundaryError("YooKassa request failed");
}

 return {withYooKassaRequestBudget,fetchYooKassaJson};
}
