import { createConnection } from "node:net";
import { decodeMediaReply, MEDIA_INPUT_TYPES, MEDIA_MAX_INPUT_BYTES, MEDIA_MAX_OUTPUT_BYTES, MEDIA_REPLY_HEADER_BYTES } from "./media-worker-protocol.ts";
import type { NormalizedImage } from "./media-image";

type Code = "INVALID_IMAGE" | "IMAGE_TOO_LARGE" | "UNSUPPORTED_IMAGE" | "MEDIA_BUSY" | "MEDIA_UNAVAILABLE";
export class MediaSocketError extends Error {
  readonly code: Code;
  constructor(code: Code) { super("Media decoder unavailable");this.name = "MediaSocketError";this.code = code; }
}

/** Bounded binary transport only. The caller supplies the trusted socket validator;
 * production factory validates the root-managed path, HTTP authorizes before this call.
 * No native addon, database, raw input logging or automatic retry in this process. */
export function createMediaSocketClient(socketPath: string, validateSocket: () => void, deadlineMs = 10000) {
  if (!socketPath.startsWith("/") || !Number.isInteger(deadlineMs) || deadlineMs < 100 || deadlineMs > 10000) throw new MediaSocketError("MEDIA_UNAVAILABLE");
  let busy = false;
  return {
    async normalize(input: Uint8Array, mimeType: string, signal?: AbortSignal): Promise<NormalizedImage> {
      if (!(input instanceof Uint8Array) || !input.byteLength) throw new MediaSocketError("INVALID_IMAGE");
      if (input.byteLength > MEDIA_MAX_INPUT_BYTES) throw new MediaSocketError("IMAGE_TOO_LARGE");
      const type = MEDIA_INPUT_TYPES.findIndex(value => value === mimeType);
      if (type < 0) throw new MediaSocketError("UNSUPPORTED_IMAGE");
      if (signal?.aborted) throw new MediaSocketError("MEDIA_UNAVAILABLE");
      if (busy) throw new MediaSocketError("MEDIA_BUSY");
      const frame = Buffer.concat([Buffer.from([type]), Buffer.from(input)]);
      busy = true;
      try {
        validateSocket();
        const socket = createConnection({ path: socketPath, allowHalfOpen: true });
        return await new Promise<NormalizedImage>((resolve, reject) => {
          const chunks: Buffer[] = [];let size = 0, ended = false, failed = false;
          const stop = () => { failed = true;socket.destroy(); };
          const timer = setTimeout(stop, deadlineMs);
          signal?.addEventListener("abort", stop, { once: true });
          socket.on("connect", () => { if (signal?.aborted) stop();else socket.end(frame); });
          socket.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > MEDIA_REPLY_HEADER_BYTES+MEDIA_MAX_OUTPUT_BYTES || chunks.length >= 256) { stop();return; }
            chunks.push(chunk);
          });
          socket.on("end", () => { ended = true; });
          socket.on("error", () => { failed = true; });
          socket.on("close", () => {
            clearTimeout(timer);signal?.removeEventListener("abort", stop);
            try {
              if (failed || !ended || signal?.aborted) throw new MediaSocketError("MEDIA_UNAVAILABLE");
              const result = decodeMediaReply(Buffer.concat(chunks, size));
              if ("error" in result) throw new MediaSocketError(result.error);
              resolve(result);
            } catch (error) { reject(error instanceof MediaSocketError ? error : new MediaSocketError("MEDIA_UNAVAILABLE")); }
          });
          if (signal?.aborted) stop();
        });
      } catch (error) { throw error instanceof MediaSocketError ? error : new MediaSocketError("MEDIA_UNAVAILABLE"); }
      finally { frame.fill(0);busy = false; }
    },
  };
}
