// Public CAPTCHA transport bounds are independent of the authenticated JSON API.
// Keep one admission count across route bundles and development reloads.
const runtime = globalThis as typeof globalThis & { __blizhniyTurnstileBodies?: { inFlight: number } };
const state = runtime.__blizhniyTurnstileBodies ??= { inFlight: 0 };
const maximumBytes = 16 * 1024; // Includes 2048 token characters escaped as JSON \uXXXX.
const maximumEmptyChunks = 1024;
const maximumConcurrentBodies = 16;

export class TurnstileBodyError extends Error {
  readonly status: number;
  constructor(status: number) { super('Invalid CAPTCHA request'); this.name = 'TurnstileBodyError'; this.status = status; }
}

export async function readTurnstileJson(request: Request, deadlineMs = 2000): Promise<unknown> {
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 2000) throw new Error('Invalid CAPTCHA body deadline');
  if (request.method !== 'POST') throw new TurnstileBodyError(405);
  const rejectBody = (status: number): never => {
    // Cancellation is cleanup, never part of the response deadline.
    if (request.body && !request.body.locked) void request.body.cancel().catch(() => undefined);
    throw new TurnstileBodyError(status);
  };
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximumBytes)) return rejectBody(413);
  if (!request.body) return rejectBody(400);
  if (state.inFlight >= maximumConcurrentBodies) return rejectBody(429);
  const reader = request.body.getReader();
  state.inFlight++;
  const deadline = performance.now() + deadlineMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let complete = false;
  try {
    return await Promise.race([
      (async () => {
        const decoder = new TextDecoder('utf-8', { fatal: true });
        let size = 0, emptyChunks = 0, text = '';
        for (;;) {
          if (performance.now() >= deadline) throw new TurnstileBodyError(408);
          const part = await reader.read();
          if (performance.now() >= deadline) throw new TurnstileBodyError(408);
          if (part.done) { complete = true; return JSON.parse(text + decoder.decode()) as unknown; }
          size += part.value.byteLength;
          if (size > maximumBytes || (part.value.byteLength === 0 && ++emptyChunks > maximumEmptyChunks)) throw new TurnstileBodyError(413);
          text += decoder.decode(part.value, { stream: true });
        }
      })(),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new TurnstileBodyError(408)), deadlineMs); }),
    ]);
  } catch (error) {
    if (error instanceof TurnstileBodyError) throw error;
    throw new TurnstileBodyError(400);
  } finally {
    if (timer) clearTimeout(timer);
    if (!complete) void reader.cancel().catch(() => undefined);
    state.inFlight--;
    reader.releaseLock();
  }
}
