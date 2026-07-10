import { isSupabaseServiceRoleConfigured } from "@/lib/supabase-rest";

export const mediaBucketName = "blizhniy-media";

const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const maxFileSizeBytes = 10 * 1024 * 1024;

export type UploadFolder = "fair-applications" | "listings" | "specialists" | "vacancies" | "work-requests";

export type UploadedMedia = {
  mimeType: string;
  path: string;
  publicUrl: string;
  size: number;
};

function getSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") ?? "";
}

function getServiceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
}

export function canUploadMediaToStorage() {
  return Boolean(getSupabaseUrl() && isSupabaseServiceRoleConfigured());
}

export function validateMediaFile(file: File) {
  if (!allowedMimeTypes.has(file.type)) {
    throw new Error("Можно загрузить только JPG, PNG, WEBP или GIF");
  }

  if (file.size <= 0) {
    throw new Error("Файл пустой");
  }

  if (file.size > maxFileSizeBytes) {
    throw new Error("Размер файла не должен превышать 10 МБ");
  }
}

function extensionForMimeType(mimeType: string) {
  if (mimeType === "image/png") {
    return "png";
  }

  if (mimeType === "image/webp") {
    return "webp";
  }

  if (mimeType === "image/gif") {
    return "gif";
  }

  return "jpg";
}

function buildObjectPath(folder: UploadFolder, userId: string, file: File) {
  const extension = extensionForMimeType(file.type);
  const date = new Date().toISOString().slice(0, 10);

  return `${folder}/${userId}/${date}/${crypto.randomUUID()}.${extension}`;
}

export function publicMediaUrl(path: string) {
  const baseUrl = getSupabaseUrl();
  const cleanPath = path.split("/").map(encodeURIComponent).join("/");

  return `${baseUrl}/storage/v1/object/public/${mediaBucketName}/${cleanPath}`;
}

export function validateMediaStoragePathsForUser(paths: string[], folder: UploadFolder, userId: string) {
  const ownerPrefix = `${folder}/${userId}/`;
  const safePathPattern = /^[A-Za-z0-9/_-]+\.(jpe?g|png|webp|gif)$/i;

  return paths.map((path) => path.trim()).filter((path) => {
    if (!path || path.length > 500 || path.startsWith("/") || path.includes("..")) {
      return false;
    }

    return path.startsWith(ownerPrefix) && safePathPattern.test(path);
  });
}

export async function uploadMediaFile(file: File, folder: UploadFolder, userId: string): Promise<UploadedMedia> {
  if (!canUploadMediaToStorage()) {
    throw new Error("Supabase Storage is not configured");
  }

  validateMediaFile(file);

  const baseUrl = getSupabaseUrl();
  const serviceRoleKey = getServiceRoleKey();
  const path = buildObjectPath(folder, userId, file);
  const uploadUrl = `${baseUrl}/storage/v1/object/${mediaBucketName}/${path}`;
  const response = await fetch(uploadUrl, {
    body: await file.arrayBuffer(),
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Cache-Control": "31536000",
      "Content-Type": file.type,
      "x-upsert": "false",
    },
    method: "POST",
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;
    throw new Error(payload?.message ?? payload?.error ?? "Не удалось загрузить файл в Supabase Storage");
  }

  return {
    mimeType: file.type,
    path,
    publicUrl: publicMediaUrl(path),
    size: file.size,
  };
}
