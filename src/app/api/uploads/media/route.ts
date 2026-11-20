import { LegacyBodyError, readLegacyFormData } from "@/lib/legacy-request-body";
import { getLegacyPhotoNormalizer } from "@/lib/legacy-photo-normalizer";
import { NextResponse } from "next/server";
import { getAuthenticatedRequestUser, isSupabaseServerConfigured } from "@/lib/server-auth";
import { canUploadMediaToStorage, removeUploadedMedia, type UploadFolder, uploadMediaFile, validateMediaFile } from "@/lib/storage-upload";

const allowedFolders = new Set<UploadFolder>(["fair-applications", "listings", "specialists", "vacancies", "work-requests"]);
const maxFilesPerRequest = 10;

type UploadResponse = {
  files: Array<{
    mimeType: string;
    path: string;
    publicUrl: string;
    size: number;
  }>;
};

function isUploadFolder(value: string): value is UploadFolder {
  return allowedFolders.has(value as UploadFolder);
}

export async function POST(request: Request) {
  if (!isSupabaseServerConfigured() || !canUploadMediaToStorage()) {
    return NextResponse.json({ error: "Supabase Storage is not configured" }, { status: 503 });
  }

  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return NextResponse.json({ error: "Войдите или зарегистрируйтесь, чтобы загрузить файлы" }, { status: 401 });
  }

  let formData: FormData;
  try { formData = await readLegacyFormData(request); }
  catch (error) {
    const status = error instanceof LegacyBodyError ? error.status : 400;
    return NextResponse.json({ error: status === 429 ? "Загрузка уже выполняется. Повторите позже." : "Некорректные данные или превышен лимит загрузки" }, { status });
  }

  const folder = String(formData.get("folder") ?? "");

  if (!isUploadFolder(folder)) {
    return NextResponse.json({ error: "Некорректный раздел загрузки" }, { status: 400 });
  }

  const files = formData.getAll("files");

  if (!files.length) {
    return NextResponse.json({ error: "Добавьте хотя бы один файл" }, { status: 400 });
  }

  if (files.length > maxFilesPerRequest) {
    return NextResponse.json({ error: `За один раз можно загрузить не больше ${maxFilesPerRequest} файлов` }, { status: 400 });
  }

  if (!files.every((item): item is File => item instanceof File)) {
    return NextResponse.json({ error: "Выберите фотографии для загрузки." }, { status: 400 });
  }
  try {
    for (const file of files) validateMediaFile(file);
  } catch {
    return NextResponse.json({ error: "Выберите JPEG, PNG, WebP или статический GIF размером до 10 МБ." }, { status: 400 });
  }

  const prepared: File[] = [];
  try {
    const normalizer = await getLegacyPhotoNormalizer();
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30000)]);
    for (const file of files) {
      const image = await normalizer.normalize(new Uint8Array(await file.arrayBuffer()), file.type, signal);
      prepared.push(new File([new Uint8Array(image.bytes)], file.name, { type: image.mimeType }));
    }
    signal.throwIfAborted();
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "INVALID_IMAGE" || code === "IMAGE_TOO_LARGE" || code === "UNSUPPORTED_IMAGE") {
      return NextResponse.json({ error: "Выберите исправное статическое фото JPEG, PNG, WebP или GIF до 10 МБ и 24 Мп." }, { status: 400 });
    }
    if (code === "MEDIA_BUSY") {
      return NextResponse.json({ error: "Обработка фотографий занята. Повторите попытку." }, { status: 429 });
    }
    return NextResponse.json({ error: "Обработка фотографий временно недоступна. Повторите попытку." }, { status: 503 });
  }

  const results = await Promise.allSettled(prepared.map((file) => uploadMediaFile(file, folder, auth.user.id)));
  const uploaded = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
  if (uploaded.length !== files.length) {
    if (uploaded.length) {
      try {
        await removeUploadedMedia(uploaded.map(file => file.path), folder, auth.user.id);
      } catch {
        console.warn("Legacy media batch cleanup failed");
      }
    }
    return NextResponse.json({ error: "Не удалось загрузить фотографии. Повторите попытку." }, { status: 502 });
  }
  const response: UploadResponse = { files: uploaded };
  return NextResponse.json(response, { status: 201 });
}
