"use client";

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
  const existingStoragePaths = limitedSources.map((source) => storagePathFromPublicMediaSource(source, folder)).filter(Boolean);
  const sourcesToUpload = limitedSources.filter((source) => !storagePathFromPublicMediaSource(source, folder));
  const imageFiles = (
    await Promise.all(sourcesToUpload.map((source, index) => imageSourceToFile(source, index)))
  ).filter((file): file is File => Boolean(file));

  if (!imageFiles.length) {
    return existingStoragePaths;
  }

  const uploadedPaths: string[] = [];

  for (let index = 0; index < imageFiles.length; index += 10) {
    const formData = new FormData();

    formData.set("folder", folder);
    imageFiles.slice(index, index + 10).forEach((file) => formData.append("files", file));

    const response = await fetch("/api/uploads/media", {
      body: formData,
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      method: "POST",
    });
    const payload = (await response.json().catch(() => null)) as MediaUploadResponse | null;

    if (!response.ok) {
      throw new Error(payload?.error ?? "Не удалось загрузить фото.");
    }

    uploadedPaths.push(...(payload?.files ?? []).map((file) => file.path).filter((path): path is string => Boolean(path)));
  }

  return [...existingStoragePaths, ...uploadedPaths].slice(0, 20);
}
