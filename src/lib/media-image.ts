import { createHash } from "node:crypto";
import sharp from "sharp";

type MediaImageCode = "INVALID_IMAGE" | "IMAGE_TOO_LARGE" | "UNSUPPORTED_IMAGE" | "MEDIA_BUSY" | "MEDIA_UNAVAILABLE";
const messages: Record<MediaImageCode, string> = {
  INVALID_IMAGE: "Некорректное изображение.",
  IMAGE_TOO_LARGE: "Изображение превышает допустимый размер.",
  UNSUPPORTED_IMAGE: "Формат изображения не поддерживается.",
  MEDIA_BUSY: "Обработка изображений занята. Попробуйте позже.",
  MEDIA_UNAVAILABLE: "Обработка изображений недоступна.",
};

export class MediaImageError extends Error {
  readonly code: MediaImageCode;
  constructor(code: MediaImageCode) {
    super(messages[code]);
    this.name = "MediaImageError";
    this.code = code;
  }
}

export type NormalizedImage = {
  bytes: Buffer;
  mimeType: "image/webp";
  size: number;
  width: number;
  height: number;
  sha256: string;
};

const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_PIXELS = 24_000_000;
const MAX_EDGE = 2048;
let decoding = false;

function detectFormat(bytes: Buffer): "jpeg" | "png" | "webp" | "gif" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    // libvips can expose only the default PNG image, hiding APNG frame metadata.
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = bytes.readUInt32BE(offset);
      const type = bytes.toString("latin1", offset + 4, offset + 8);
      if (type === "acTL") throw new MediaImageError("UNSUPPORTED_IMAGE");
      if (type === "IEND" || length > bytes.length - offset - 12) break;
      offset += length + 12;
    }
    return "png";
  }
  if (bytes.length >= 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") {
    if (bytes.readUInt32LE(4) + 8 !== bytes.length) throw new MediaImageError("INVALID_IMAGE");
    return "webp";
  }
  if (["GIF87a", "GIF89a"].includes(bytes.toString("latin1", 0, 6))) return "gif";
  return null;
}

/**
 * Accepts bytes only; re-encodes static photos and strips source metadata.
 * One decode per module instance, without a queue. Not a native-code sandbox:
 * isolate the future upload worker and impose OS limits before HTTP exposure.
 */
export async function normalizeMediaImage(input: Uint8Array, claimedType: string): Promise<NormalizedImage> {
  if (typeof window !== "undefined") throw new MediaImageError("MEDIA_UNAVAILABLE");
  if (!(input instanceof Uint8Array) || input.byteLength === 0) throw new MediaImageError("INVALID_IMAGE");
  if (input.byteLength > MAX_INPUT_BYTES) throw new MediaImageError("IMAGE_TOO_LARGE");
  if (decoding) throw new MediaImageError("MEDIA_BUSY");
  decoding = true;
  try {
    // Copy before the first await: the caller cannot change bytes after validation.
    const bytes = Buffer.from(input);
    const format = detectFormat(bytes);
    if (!format || claimedType !== `image/${format}`) throw new MediaImageError("UNSUPPORTED_IMAGE");
    const decoder = sharp(bytes, {
      failOn: "warning", limitInputPixels: MAX_PIXELS, limitInputChannels: 4,
      unlimited: false, sequentialRead: true,
    }).timeout({ seconds: 5 });
    const metadata = await decoder.metadata();
    if (metadata.format !== format || (metadata.pages ?? 1) > 1) throw new MediaImageError("UNSUPPORTED_IMAGE");
    const { width, height } = metadata;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || !width || !height || width < 1 || height < 1 || width * height > MAX_PIXELS) {
      throw new MediaImageError("INVALID_IMAGE");
    }
    // metadata() reads headers only; toBuffer() must also decode the actual pixels.
    const output = await decoder.autoOrient()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80, effort: 3 }).toBuffer({ resolveWithObject: true });
    if (output.data.length > MAX_OUTPUT_BYTES) throw new MediaImageError("IMAGE_TOO_LARGE");
    if (!output.data.length || output.info.format !== "webp" || output.info.width < 1 || output.info.height < 1 || output.info.width > MAX_EDGE || output.info.height > MAX_EDGE) {
      throw new MediaImageError("INVALID_IMAGE");
    }
    return {
      bytes: output.data, mimeType: "image/webp", size: output.data.length,
      width: output.info.width, height: output.info.height,
      sha256: createHash("sha256").update(output.data).digest("hex"),
    };
  } catch (error) {
    // Native decoder messages can contain source details. Do not retain a cause.
    if (error instanceof MediaImageError) throw error;
    throw new MediaImageError("INVALID_IMAGE");
  } finally {
    decoding = false;
  }
}
