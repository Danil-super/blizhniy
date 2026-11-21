import type { Metadata } from "next";
import { isPublicPhotoPath } from "./public-photo-retry";
import { publicMediaUrl } from "./storage-upload";

function previewImage(images: readonly string[]): string {
  const bucket = publicMediaUrl("");
  const legacyPhoto = /^(?:listings|vacancies|work-requests|specialists)\/[\w/-]+\.(?:jpe?g|png|gif|webp)$/i;
  return images.find(image => isPublicPhotoPath(image) ||
    (image.startsWith(bucket) && legacyPhoto.test(image.slice(bucket.length)))) ?? "/brand/logo.jpg";
}

export function publicationOpenGraph(title: string, description: string, url: string, images: readonly string[] = []): Metadata["openGraph"] {
  return { type: "website", locale: "ru_RU", siteName: "БЛИЖНИЙ", title, description, url, images: [previewImage(images)] };
}
