"use client";

import { croppedPhotoFile } from "@/lib/image-data-url";
import { getStoredMediaFile } from "@/lib/client-media-store";
import type { UploadFolder } from "@/lib/storage-upload";

type MediaUploadResponse = {
  error?: string;
  files?: Array<{ path?: string }>;
};

const publicMediaPathMarker = "/storage/v1/object/public/blizhniy-media/";

export function storagePathFromPublicMediaSource(source: string, folder?: UploadFolder) {
  const cleanSource = source.trim();

  if (folder && cleanSource.toLowerCase().startsWith(`${folder}/`)) {
    return cleanSource;
  }

  const markerIndex = cleanSource.indexOf(publicMediaPathMarker);

  if (markerIndex < 0) {
    return "";
  }

  const encodedPath = cleanSource.slice(markerIndex + publicMediaPathMarker.length).split(/[?#]/)[0] ?? "";

  try {
    return decodeURIComponent(encodedPath);
  } catch {
    return encodedPath;
  }
}

async function imageSourceToFile(source: string, index: number) {
  const storedFile = await getStoredMediaFile(source);

  if (storedFile?.type.startsWith("image/")) {
    return storedFile;
  }

  if (/^data:image\/(?:png|jpeg|webp);base64,/.test(source)) {
    return croppedPhotoFile(source, `publication-photo-${index + 1}`);
  }

  if (!/^(data:image\/|blob:|https?:\/\/)/i.test(source)) {
    return undefined;
  }

  const response = await fetch(source).catch(() => null);

  if (!response?.ok) {
    return undefined;
  }

  const blob = await response.blob();

  if (!blob.type.startsWith("image/")) {
    return undefined;
  }

  const extension = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : blob.type === "image/gif" ? "gif" : "jpg";

  return new File([blob], `publication-photo-${index + 1}.${extension}`, { type: blob.type });
}

export async function uploadPublicationImageSources(sources: string[], folder: UploadFolder, accessToken?: string) {
  const limitedSources = sources.slice(0, 20);
  const paths = limitedSources.map((source) => storagePathFromPublicMediaSource(source, folder));
  const resolved = await Promise.all(limitedSources.map(async (source, index) => {
    if (paths[index]) return;
    const file = await imageSourceToFile(source, index);
    if (!file) throw new Error(`Не удалось открыть фото №${index + 1}. Выберите его заново.`);
    return { index, file };
  }));
  const pending = resolved.filter(entry => entry !== undefined);

  for (let offset = 0; offset < pending.length; offset += 10) {
    const batch = pending.slice(offset, offset + 10);
    const formData = new FormData();
    formData.set("folder", folder);
    for (const { file } of batch) formData.append("files", file);

    const response = await fetch("/api/uploads/media", {
      body: formData,
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      method: "POST",
    });
    const payload = (await response.json().catch(() => null)) as MediaUploadResponse | null;

    if (!response.ok) {
      throw new Error(payload?.error ?? "Не удалось загрузить фото.");
    }

    const uploaded = Array.isArray(payload?.files) ? payload.files.map(entry => entry?.path) : [];
    if (uploaded.length !== batch.length || !uploaded.every((path): path is string => typeof path === "string" && path.trim().length > 0)) {
      throw new Error("Не все фотографии загружены. Повторите попытку.");
    }
    batch.forEach(({ index }, i) => {
      paths[index] = uploaded[i];
    });
  }

  return paths;
}
