export const mediaUploadTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export const normalizedImageByteLimit = 2 * 1024 * 1024;
export type UploadedImage = { id: string; mimeType: "image/webp"; width: number; height: number; size: number };
export class MediaInputError extends Error {
  constructor() { super("Invalid media input");this.name = "MediaInputError"; }
}
export function parseMediaId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)) throw new MediaInputError();
  return value;
}
export function parseUploadedImage(value: unknown): UploadedImage {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MediaInputError();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join() !== "height,id,mimeType,size,width" || row.mimeType !== "image/webp" ||
      ![row.width, row.height].every(size => typeof size === "number" && Number.isInteger(size) && size >= 1 && size <= 2048) ||
      typeof row.size !== "number" || !Number.isInteger(row.size) || row.size < 12 || row.size > normalizedImageByteLimit) throw new MediaInputError();
  return { id: parseMediaId(row.id), mimeType: "image/webp", width: row.width as number, height: row.height as number, size: row.size };
}
