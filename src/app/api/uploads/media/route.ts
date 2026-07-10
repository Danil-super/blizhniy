import { NextResponse } from "next/server";
import { getAuthenticatedRequestUser, isSupabaseServerConfigured } from "@/lib/server-auth";
import { canUploadMediaToStorage, type UploadFolder, uploadMediaFile } from "@/lib/storage-upload";

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

  const formData = await request.formData().catch(() => null);

  if (!formData) {
    return NextResponse.json({ error: "Некорректные данные загрузки" }, { status: 400 });
  }

  const folder = String(formData.get("folder") ?? "");

  if (!isUploadFolder(folder)) {
    return NextResponse.json({ error: "Некорректный раздел загрузки" }, { status: 400 });
  }

  const files = formData.getAll("files").filter((item): item is File => item instanceof File && item.size > 0);

  if (!files.length) {
    return NextResponse.json({ error: "Добавьте хотя бы один файл" }, { status: 400 });
  }

  if (files.length > maxFilesPerRequest) {
    return NextResponse.json({ error: `За один раз можно загрузить не больше ${maxFilesPerRequest} файлов` }, { status: 400 });
  }

  try {
    const uploaded = await Promise.all(files.map((file) => uploadMediaFile(file, folder, auth.user.id)));
    const response: UploadResponse = { files: uploaded };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить файлы" }, { status: 400 });
  }
}
