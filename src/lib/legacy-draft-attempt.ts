"use client";

type Media = { paths: string[]; images?: string[] };
type Attempt = { owner: string; key: string; upload?: { signature: string; ready: Promise<Media> } };
const attempts = new WeakMap<HTMLFormElement, Attempt>();

// An open form keeps the same creation key even if a write acknowledgement is lost.
export async function prepareLegacyDraftMedia(
  form: HTMLFormElement, owner: string, data: FormData, prepare: () => Promise<Media>,
) {
  if (data.has("photosPreparing")) throw new Error("Дождитесь подготовки фотографий.");
  let attempt = attempts.get(form);
  if (!attempt || attempt.owner !== owner) {
    attempt = { owner, key: crypto.randomUUID() };
    attempts.set(form, attempt);
  }
  const hashes: string[] = [];
  for (const file of data.getAll("photos")) {
    if (typeof file === "string") throw new Error("Выберите фотографии заново.");
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    hashes.push(Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join(""));
  }
  const signature = JSON.stringify([data.getAll("existingPhotos"), data.get("localPhotoOrder"), hashes]);
  const upload = attempt.upload?.signature === signature ? attempt.upload : { signature, ready: prepare() };
  attempt.upload = upload;
  try {
    return { creationKey: attempt.key, ...await upload.ready };
  } catch (error) {
    if (attempt.upload === upload) delete attempt.upload;
    throw error;
  }
}
