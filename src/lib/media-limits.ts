const bytesInMegabyte = 1024 * 1024;

export const maxListingImageFileSize = 10 * bytesInMegabyte;
export const maxListingVideoFileSize = 80 * bytesInMegabyte;
export const maxListingMediaTotalSize = 160 * bytesInMegabyte;
export const maxFormPhotoFileSize = 8 * bytesInMegabyte;

export function formatFileSize(bytes: number) {
  if (bytes >= bytesInMegabyte) {
    return `${Math.round(bytes / bytesInMegabyte)} МБ`;
  }

  return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}

export function listingMediaLimitText() {
  return `Фото до ${formatFileSize(maxListingImageFileSize)}, видео до ${formatFileSize(maxListingVideoFileSize)}, всего до ${formatFileSize(maxListingMediaTotalSize)}.`;
}

export function formPhotoLimitText() {
  return `Фото до ${formatFileSize(maxFormPhotoFileSize)}.`;
}

function fileLimitForType(file: File) {
  if (file.type.startsWith("video/")) {
    return maxListingVideoFileSize;
  }

  return maxListingImageFileSize;
}

export function isAllowedListingMediaType(file: File) {
  return file.type.startsWith("image/") || file.type.startsWith("video/");
}

export function isAllowedFormPhotoType(file: File) {
  return file.type.startsWith("image/");
}

export function filterListingMediaFiles(files: File[], currentTotalSize = 0) {
  const accepted: File[] = [];
  const rejectedMessages: string[] = [];
  let totalSize = currentTotalSize;

  files.forEach((file) => {
    if (!isAllowedListingMediaType(file)) {
      rejectedMessages.push(`${file.name}: поддерживаются только фото и видео.`);
      return;
    }

    const fileLimit = fileLimitForType(file);

    if (file.size > fileLimit) {
      rejectedMessages.push(`${file.name}: файл больше ${formatFileSize(fileLimit)}.`);
      return;
    }

    if (totalSize + file.size > maxListingMediaTotalSize) {
      rejectedMessages.push(`${file.name}: общий объем медиа больше ${formatFileSize(maxListingMediaTotalSize)}.`);
      return;
    }

    totalSize += file.size;
    accepted.push(file);
  });

  return { accepted, rejectedMessages, totalSize };
}

export function filterFormPhotoFiles(files: File[]) {
  const accepted: File[] = [];
  const rejectedMessages: string[] = [];

  files.forEach((file) => {
    if (!isAllowedFormPhotoType(file)) {
      rejectedMessages.push(`${file.name}: поддерживаются только фото.`);
      return;
    }

    if (file.size > maxFormPhotoFileSize) {
      rejectedMessages.push(`${file.name}: фото больше ${formatFileSize(maxFormPhotoFileSize)}.`);
      return;
    }

    accepted.push(file);
  });

  return { accepted, rejectedMessages };
}
