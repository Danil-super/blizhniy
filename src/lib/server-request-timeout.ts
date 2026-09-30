/**
 * Bounds the whole lifetime of a server-side request, including consuming its
 * response body. This prevents an unresponsive upstream from retaining a
 * Next.js request indefinitely.
 */
export async function withServerRequestTimeout<T>(
  timeoutMs: number,
  request: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("A positive server request timeout is required");
  }

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await request(controller.signal);
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
