import { NextResponse } from "next/server";
import { createDefaultCabinetProfile, type CabinetProfile } from "@/lib/cabinet-profile";
import { getAuthenticatedRequestUser } from "@/lib/server-auth";
import { isSupabaseServiceRoleConfigured, supabaseRest } from "@/lib/supabase-rest";

type AuthProfileUser = {
  email?: string;
  id: string;
  phone?: string;
  phone_confirmed_at?: string | null;
  user_metadata?: Record<string, unknown>;
};

type StoredProfile = {
  profile: unknown;
};

const noStore = { "Cache-Control": "private, no-store" };

function phoneDigits(value: string) {
  return value.replace(/\D/g, "").replace(/^8(?=\d{10}$)/, "7");
}

function defaultProfile(user: AuthProfileUser) {
  const email = user.email ?? "";
  const displayName = user.user_metadata?.display_name;
  const name = typeof displayName === "string" && displayName.trim()
    ? displayName.trim()
    : email.split("@")[0] || "Пользователь";

  return createDefaultCabinetProfile({ name, email });
}

function cleanText(value: unknown, fallback: string, limit: number) {
  return typeof value === "string" ? value.trim().slice(0, limit) : fallback;
}

function cleanBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function cleanNumber(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function normalizeProfile(value: unknown, user: AuthProfileUser): CabinetProfile {
  const fallback = defaultProfile(user);
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const rawAvatar = typeof input.avatarDataUrl === "string" ? input.avatarDataUrl : "";

  if (rawAvatar.length > 400000 || (rawAvatar && !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(rawAvatar))) {
    throw new Error("Аватар должен быть JPG, PNG или WebP размером до 300 КБ.");
  }

  const phone = cleanText(input.phone, fallback.phone, 40);
  const verified = Boolean(
    phone &&
    user.phone &&
    user.phone_confirmed_at &&
    phoneDigits(phone) === phoneDigits(user.phone),
  );

  return {
    name: cleanText(input.name, fallback.name, 120) || fallback.name,
    avatarDataUrl: rawAvatar,
    avatarZoom: cleanNumber(input.avatarZoom, fallback.avatarZoom, 1, 5),
    avatarPositionX: cleanNumber(input.avatarPositionX, fallback.avatarPositionX, 0, 100),
    avatarPositionY: cleanNumber(input.avatarPositionY, fallback.avatarPositionY, 0, 100),
    phone,
    phoneVerified: verified,
    verifiedPhone: verified ? phone : "",
    email: user.email ?? "",
    city: cleanText(input.city, fallback.city, 80),
    notifyBookings: cleanBoolean(input.notifyBookings, fallback.notifyBookings),
    notifyMessages: cleanBoolean(input.notifyMessages, fallback.notifyMessages),
    notifyPayments: cleanBoolean(input.notifyPayments, fallback.notifyPayments),
    notifyPublicationStatus: cleanBoolean(input.notifyPublicationStatus, fallback.notifyPublicationStatus),
    notifySystem: cleanBoolean(input.notifySystem, fallback.notifySystem),
    emailNotifications: cleanBoolean(input.emailNotifications, fallback.emailNotifications),
    pushNotifications: cleanBoolean(input.pushNotifications, fallback.pushNotifications),
    organizationName: cleanText(input.organizationName, "", 120),
    organizationInn: cleanText(input.organizationInn, "", 12).replace(/\D/g, ""),
    organizationOgrn: cleanText(input.organizationOgrn, "", 15).replace(/\D/g, ""),
    organizationAddress: cleanText(input.organizationAddress, "", 160),
    organizationWebsite: cleanText(input.organizationWebsite, "", 120),
    organizationDescription: cleanText(input.organizationDescription, "", 500),
  };
}

async function authenticatedUser(request: Request) {
  if (!isSupabaseServiceRoleConfigured()) {
    return null;
  }

  const auth = await getAuthenticatedRequestUser(request);
  return auth?.user as AuthProfileUser | undefined;
}

export async function GET(request: Request) {
  if (!isSupabaseServiceRoleConfigured()) {
    return NextResponse.json({ error: "Профиль временно недоступен." }, { status: 503, headers: noStore });
  }

  try {
    const user = await authenticatedUser(request);

    if (!user) {
      return NextResponse.json({ error: "Требуется вход в аккаунт." }, { status: 401, headers: noStore });
    }

    const rows = await supabaseRest<StoredProfile[]>(
      "/rest/v1/cabinet_private_profiles?select=profile&user_id=eq." + encodeURIComponent(user.id) + "&limit=1",
    );
    const exists = rows.length > 0;
    const profile = normalizeProfile(exists ? rows[0].profile : null, user);

    return NextResponse.json({ exists, profile }, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "Не удалось загрузить профиль. Повторите позже." }, { status: 503, headers: noStore });
  }
}

export async function PUT(request: Request) {
  if (!isSupabaseServiceRoleConfigured()) {
    return NextResponse.json({ error: "Профиль временно недоступен." }, { status: 503, headers: noStore });
  }

  try {
    const user = await authenticatedUser(request);

    if (!user) {
      return NextResponse.json({ error: "Требуется вход в аккаунт." }, { status: 401, headers: noStore });
    }

    const raw = await request.text();

    if (raw.length > 500000) {
      return NextResponse.json({ error: "Профиль слишком большой." }, { status: 413, headers: noStore });
    }

    let payload: { profile?: unknown };

    try {
      payload = JSON.parse(raw) as { profile?: unknown };
    } catch {
      return NextResponse.json({ error: "Неверный формат профиля." }, { status: 400, headers: noStore });
    }

    if (!payload?.profile || typeof payload.profile !== "object" || Array.isArray(payload.profile)) {
      return NextResponse.json({ error: "Неверный формат профиля." }, { status: 400, headers: noStore });
    }

    let profile: CabinetProfile;

    try {
      profile = normalizeProfile(payload.profile, user);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Неверные данные профиля." },
        { status: 400, headers: noStore },
      );
    }

    if (
      (profile.organizationInn && ![10, 12].includes(profile.organizationInn.length)) ||
      (profile.organizationOgrn && ![13, 15].includes(profile.organizationOgrn.length))
    ) {
      return NextResponse.json({ error: "Проверьте ИНН и ОГРН организации." }, { status: 400, headers: noStore });
    }

    await supabaseRest<StoredProfile[]>(
      "/rest/v1/cabinet_private_profiles?on_conflict=user_id",
      {
        method: "POST",
        body: { user_id: user.id, profile, updated_at: new Date().toISOString() },
        prefer: "resolution=merge-duplicates,return=minimal",
      },
    );

    return NextResponse.json({ profile }, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "Не удалось сохранить профиль. Повторите позже." }, { status: 503, headers: noStore });
  }
}
