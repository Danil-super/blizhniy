"use client";

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

  databasePromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(databaseName, databaseVersion);

    request.onerror = () => reject(request.error ?? new Error("Не удалось открыть локальное хранилище медиа."));
    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(objectStoreName)) {
        database.createObjectStore(objectStoreName, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });

  return databasePromise;
}

function runMediaTransaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  return openMediaDatabase().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(objectStoreName, mode);
        const request = action(transaction.objectStore(objectStoreName));

        request.onerror = () => reject(request.error ?? new Error("Не удалось выполнить операцию с локальным медиа."));
        request.onsuccess = () => resolve(request.result);
      }),
  );
}

export function isStoredMediaReference(value?: string) {
  return Boolean(value?.startsWith(storedMediaPrefix));
}

export async function storeMediaFile(file: File) {
  const id = mediaId();
  const record: StoredMediaRecord = {
    blob: file,
    createdAt: new Date().toISOString(),
    id,
    name: file.name || "media",
    type: file.type || "application/octet-stream",
  };

  await runMediaTransaction("readwrite", (store) => store.put(record));
  return id;
}

export async function storeMediaDataUrl(dataUrl: string, name = "media") {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const id = mediaId();
  const record: StoredMediaRecord = {
    blob,
    createdAt: new Date().toISOString(),
    id,
    name,
    type: blob.type || "application/octet-stream",
  };

  await runMediaTransaction("readwrite", (store) => store.put(record));
  return id;
}

export async function resolveStoredMediaUrl(source: string) {
  if (!isStoredMediaReference(source)) {
    return source;
  }

  const cached = objectUrlCache.get(source);

  if (cached) {
    return cached;
  }

  const record = await runMediaTransaction<StoredMediaRecord | undefined>("readonly", (store) => store.get(source));

  if (!record?.blob) {
    return "";
  }

  const objectUrl = URL.createObjectURL(record.blob);
  objectUrlCache.set(source, objectUrl);
  return objectUrl;
}
