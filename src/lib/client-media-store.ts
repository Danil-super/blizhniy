"use client";

import {imageDataUrlToBlob} from './image-data-url';

const databaseName = "blizhniy-media-store";
const databaseVersion = 1;
const objectStoreName = "media";
export const storedMediaPrefix = "blizhniy-media:";

type StoredMediaRecord = {
  blob: Blob;
  createdAt: string;
  id: string;
  name: string;
  type: string;
};

let databasePromise: Promise<IDBDatabase> | null = null;
const objectUrlCache = new Map<string, string>();

function mediaId() {
  return `${storedMediaPrefix}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function openMediaDatabase() {
  if (databasePromise) {
    return databasePromise;
  }

  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(databaseName, databaseVersion);

    request.onerror = () => reject(request.error ?? new Error("Не удалось открыть локальное хранилище медиа."));
    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(objectStoreName)) {
        database.createObjectStore(objectStoreName, { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };
      database.onclose = () => { databasePromise = null; };
      resolve(database);
    };
  }).catch(error => {
    databasePromise = null;
    throw error;
  });

  return databasePromise;
}

async function runMediaTransaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => T) {
  const database = await openMediaDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(objectStoreName, mode);
    transaction.onabort = () => reject(transaction.error ?? new Error("Запись была прервана."));
    try {
      const result = action(transaction.objectStore(objectStoreName));
      transaction.oncomplete = () => resolve(result);
    } catch (error) {
      transaction.abort();
      reject(error);
    }
  });
}

export function isStoredMediaReference(value?: string) {
  return Boolean(value?.startsWith(storedMediaPrefix));
}

export async function storeMediaFiles(files: File[]) {
  if (!files.length) return [];
  const records: StoredMediaRecord[] = files.map(file => ({
    blob: file,
    createdAt: new Date().toISOString(),
    id: mediaId(),
    name: file.name || "media",
    type: file.type || "application/octet-stream",
  }));
  try {
    await runMediaTransaction("readwrite", store => {
      for (const record of records) store.add(record);
    });
  } catch (cause) {
    const message = cause instanceof DOMException && cause.name === "QuotaExceededError"
      ? "В хранилище браузера недостаточно места для фотографий. Освободите место и повторите попытку."
      : "Не удалось сохранить фотографии в браузере. Повторите попытку.";
    throw new Error(message, { cause });
  }
  return records.map(record => record.id);
}

export async function storeMediaFile(file: File) {
  const [id] = await storeMediaFiles([file]);
  return id;
}

export async function storeMediaDataUrl(dataUrl: string, name = "media") {
  const blob = imageDataUrlToBlob(dataUrl);
  return storeMediaFile(new File([blob], name, { type: blob.type }));
}

export async function storeFormPhotos(data: FormData, limit: number) {
  if (data.has("photosPreparing")) throw new Error("Дождитесь подготовки фотографий.");
  const existing = data.getAll("existingPhotos");
  if (!existing.every((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)) {
    throw new Error("Проверьте сохранённые фотографии.");
  }
  const files = data.getAll("photos").filter(entry => !(entry instanceof File && !entry.name && !entry.size));
  if (!files.every((entry): entry is File => entry instanceof File && entry.size > 0 && entry.type.startsWith("image/"))) {
    throw new Error("Выберите фотографии заново.");
  }
  const order = data.has("localPhotoOrder") ? String(data.get("localPhotoOrder")).split(",").filter(Boolean)
    : [...existing.map(() => "saved"), ...files.map(() => "new")];
  if (order.length > limit || order.length !== existing.length + files.length ||
      order.filter(kind => kind === "saved").length !== existing.length ||
      order.filter(kind => kind === "new").length !== files.length) {
    throw new Error("Список фотографий изменился. Проверьте выбранные файлы.");
  }
  const stored = await storeMediaFiles(files);
  let nextSaved = 0;
  let nextFile = 0;
  return order.map(kind => kind === "saved" ? existing[nextSaved++] : stored[nextFile++]);
}

async function readMediaRecord(source: string): Promise<StoredMediaRecord | undefined> {
  const request = await runMediaTransaction("readonly", store => store.get(source));
  return request.result;
}

export async function resolveStoredMediaUrl(source: string) {
  if (!isStoredMediaReference(source)) {
    return source;
  }

  const cached = objectUrlCache.get(source);

  if (cached) {
    return cached;
  }

  const record = await readMediaRecord(source);

  if (!record?.blob) {
    return "";
  }

  const objectUrl = URL.createObjectURL(record.blob);
  objectUrlCache.set(source, objectUrl);
  return objectUrl;
}

export async function getStoredMediaFile(source: string) {
  if (!isStoredMediaReference(source)) {
    return undefined;
  }

  const record = await readMediaRecord(source);

  if (!record?.blob) {
    return undefined;
  }

  return new File([record.blob], record.name || "listing-photo.jpg", { type: record.type || record.blob.type || "image/jpeg" });
}
