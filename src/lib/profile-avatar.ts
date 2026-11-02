import { ProfileInputError } from "./postgres-profile";
import { decodeMediaReply, encodeMediaReply } from "./media-worker-protocol";
import type { NormalizedImage } from "./media-image";

type Normalizer = { normalize(bytes: Uint8Array, mime: string, signal?: AbortSignal): Promise<NormalizedImage> };
const maxBytes = 300 * 1024;

/** Server composition only. No native decoder, remote URL or raw-source fallback here. */
export async function normalizeProfileAvatar(avatar: string, getNormalizer: () => Promise<Normalizer>, signal?: AbortSignal): Promise<string> {
  if (typeof window !== "undefined") throw new Error("Avatar processing unavailable");
  if (typeof avatar !== "string" || avatar.length > 409623) throw new ProfileInputError();
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(avatar);
  if (!match) throw new ProfileInputError();
  const input = Buffer.from(match[2], "base64");
  if (!input.length || input.length > maxBytes || input.toString("base64") !== match[2]) throw new ProfileInputError();
  try {
    signal?.throwIfAborted();
    const normalizer = await getNormalizer();
    signal?.throwIfAborted();
    const output = await normalizer.normalize(input, match[1], signal);
    signal?.throwIfAborted();
    if (!(output?.bytes instanceof Uint8Array) || output.mimeType !== "image/webp") throw new Error("Invalid avatar reply");
    if (output.bytes.byteLength > maxBytes) throw new ProfileInputError();
    const image = decodeMediaReply(encodeMediaReply(output));
    if ("error" in image) throw new Error("Invalid avatar reply");
    return `data:image/webp;base64,${image.bytes.toString("base64")}`;
  } catch (error) {
    if (error instanceof ProfileInputError) throw error;
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    if (typeof code === "string" && ["INVALID_IMAGE", "UNSUPPORTED_IMAGE", "IMAGE_TOO_LARGE"].includes(code)) throw new ProfileInputError();
    // Do not retain native errors, input bytes, paths or abort reasons.
    throw new Error("Avatar processing unavailable");
  } finally { input.fill(0); }
}
