import { NextResponse } from "next/server";
import { getSpecialistProfileCompleteness, getStoredSpecialistProfileForUser, upsertStoredSpecialistProfileForUser, type SpecialistProfileInput } from "@/lib/specialist-profile-store";
import { getAuthenticatedRequestUser, isSupabaseServerConfigured } from "@/lib/server-auth";
import { isSupabaseServiceRoleConfigured } from "@/lib/supabase-rest";
import { validateMediaStoragePathsForUser } from "@/lib/storage-upload";

type PatchBody = SpecialistProfileInput & {
  action?: "save" | "activate" | "deactivate";
};

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function cleanNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function specialistInputFromBody(body: PatchBody): SpecialistProfileInput {
  return {
    address: cleanString(body.address) || undefined,
    city: cleanString(body.city) || "Краснодар",
    description: cleanString(body.description) || undefined,
    email: cleanString(body.email) || undefined,
    lat: cleanNumber(body.lat),
    lng: cleanNumber(body.lng),
    messengerUrl: cleanString(body.messengerUrl) || undefined,
    name: cleanString(body.name) || undefined,
    photoPath: cleanString(body.photoPath) || undefined,
    phone: cleanString(body.phone) || undefined,
    price: cleanString(body.price) || undefined,
    profession: cleanString(body.profession) || undefined,
    skills: cleanString(body.skills) || undefined,
    videoUrl: cleanString(body.videoUrl) || undefined,
  };
}

export async function GET(request: Request) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Auth is not configured" }, { status: 503 });
  }

  if (!isSupabaseServiceRoleConfigured()) {
    return NextResponse.json({ error: "Server storage is not configured" }, { status: 503 });
  }

  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return NextResponse.json({ error: "Войдите, чтобы открыть анкету" }, { status: 401 });
  }

  const specialist = await getStoredSpecialistProfileForUser(
    {
      email: auth.user.email,
      id: auth.user.id,
      name: auth.user.email?.split("@")[0],
    },
    { createDraft: true },
  );

  return NextResponse.json({ completeness: getSpecialistProfileCompleteness(specialist), specialist }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Auth is not configured" }, { status: 503 });
  }

  if (!isSupabaseServiceRoleConfigured()) {
    return NextResponse.json({ error: "Server storage is not configured" }, { status: 503 });
  }

  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return NextResponse.json({ error: "Войдите, чтобы сохранить анкету" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as PatchBody | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const input = specialistInputFromBody(body);

    if (body.photoPath !== undefined) {
      const rawPhotoPath = cleanString(body.photoPath);
      const validPhotoPath = rawPhotoPath ? validateMediaStoragePathsForUser([rawPhotoPath], "specialists", auth.user.id)[0] : "";

      if (rawPhotoPath && !validPhotoPath) {
        return NextResponse.json({ error: "Некорректное фото профиля. Загрузите аватарку заново." }, { status: 400 });
      }

      input.photoPath = validPhotoPath || "";
    }

    const status = body.action === "activate" ? "published" : body.action === "deactivate" ? "draft" : undefined;
    const specialist = await upsertStoredSpecialistProfileForUser(
      {
        email: auth.user.email,
        id: auth.user.id,
        name: input.name || auth.user.email?.split("@")[0],
        phone: input.phone,
      },
      {
        ...input,
        status,
      },
    );

    return NextResponse.json({ completeness: getSpecialistProfileCompleteness(specialist), specialist });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось сохранить анкету" }, { status: 400 });
  }
}
