import { LegacyBodyError, readLegacyFormData } from "@/lib/legacy-request-body";
import { detectMediaImageFormat } from "@/lib/media-image";
import { NextResponse } from "next/server";
import { getAuthenticatedRequestUser, isSupabaseServerConfigured } from "@/lib/server-auth";
import { canUploadMediaToStorage, type UploadFolder, uploadMediaFile, validateMediaFile } from "@/lib/storage-upload";

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
    for (const file of files) {
      validateMediaFile(file);
      const format = detectMediaImageFormat(Buffer.from(await file.arrayBuffer()));
      if (!format || file.type !== `image/${format}`) {
        return NextResponse.json({ error: "Формат файла не соответствует изображению." }, { status: 400 });
      }
    }
  } catch {
    return NextResponse.json({ error: "Выберите JPEG, PNG, WebP или статический GIF размером до 10 МБ." }, { status: 400 });
  }

  try {
    const uploaded = await Promise.all(files.map((file) => uploadMediaFile(file, folder, auth.user.id)));
    const response: UploadResponse = { files: uploaded };

    return NextResponse.json(response, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Не удалось загрузить фотографии. Повторите попытку." }, { status: 502 });
  }
}
