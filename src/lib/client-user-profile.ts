"use client";

import { createDefaultCabinetProfile, type CabinetProfile } from "@/lib/cabinet-profile";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export { createDefaultCabinetProfile };
export type { CabinetProfile };

export type ClientUserIdentity = {
  accessToken?: string;
  ownerKey: string;
  name: string;
  email: string;
};

const legacyProfilePrefix = "blizhniy-user-profile:";

export function profileStorageKey(ownerKey: string) {
  return legacyProfilePrefix + ownerKey;
}

let cachedIdentity: ClientUserIdentity | null = null;
let cachedIdentityAt = 0;
let identityRequest: Promise<ClientUserIdentity> | null = null;
let authListenerInitialized = false;

const identityCacheTtlMs = 60_000;

function clearCachedIdentity() {
  cachedIdentity = null;
  cachedIdentityAt = 0;
  identityRequest = null;
}

function ensureIdentityAuthListener() {
  if (authListenerInitialized) {
    return;
  }

  authListenerInitialized = true;

  try {
    getSupabaseBrowserClient().auth.onAuthStateChange(() => {
      clearCachedIdentity();
    });
  } catch {
    // Supabase can be unavailable in local/demo modes. Identity resolution still falls back below.
  }
}

async function loadClientUserIdentity(): Promise<ClientUserIdentity> {
  try {
    const supabase = getSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    const email = user?.email ?? "";
    const metadataName = typeof user?.user_metadata?.display_name === "string" ? user.user_metadata.display_name : "";
    const fallbackName = email ? email.split("@")[0] : "Пользователь";

    return {
      accessToken: data.session?.access_token,
      ownerKey: user?.id ?? email ?? "local-user",
      name: metadataName.trim() || fallbackName,
      email,
    };
  } catch {
    return {
      ownerKey: "local-user",
      name: "Пользователь",
      email: "",
    };
  }
}

export async function resolveClientUserIdentity(): Promise<ClientUserIdentity> {
  ensureIdentityAuthListener();

  if (cachedIdentity && Date.now() - cachedIdentityAt < identityCacheTtlMs) {
    return cachedIdentity;
  }

  identityRequest ??= loadClientUserIdentity()
    .then((identity) => {
      cachedIdentity = identity;
      cachedIdentityAt = Date.now();
      return identity;
    })
    .finally(() => {
      identityRequest = null;
    });

  return identityRequest;
}

export async function resolveAuthenticatedClientUserIdentity(): Promise<ClientUserIdentity> {
  const identity = await resolveClientUserIdentity();

  if (!identity.accessToken || identity.ownerKey === "local-user") {
    throw new Error("Войдите или зарегистрируйтесь, чтобы разместить публикацию.");
  }

  return identity;
}

function clearOtherLegacyProfiles(currentKey: string) {
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);

      if (key?.startsWith(legacyProfilePrefix) && key !== currentKey) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Browser storage may be disabled; the server profile still works.
  }
}

function removeLegacyProfile(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Browser storage may be disabled; the server profile still works.
  }
}

export async function readCabinetProfile(identity: ClientUserIdentity): Promise<CabinetProfile> {
  const fallback = createDefaultCabinetProfile(identity);

  if (!identity.accessToken || identity.ownerKey === "local-user") {
    return fallback;
  }

  const legacyKey = profileStorageKey(identity.ownerKey);
  clearOtherLegacyProfiles(legacyKey);

  const response = await fetch("/api/cabinet/profile", {
    headers: { Authorization: "Bearer " + identity.accessToken },
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
    exists?: boolean;
    profile?: CabinetProfile;
  } | null;

  if (!response.ok || !payload?.profile) {
    throw new Error(payload?.error || "Не удалось загрузить профиль.");
  }

  if (payload.exists) {
    removeLegacyProfile(legacyKey);
    return payload.profile;
  }

  let legacy: Partial<CabinetProfile> | null = null;

  try {
    const raw = window.localStorage.getItem(legacyKey);
    const parsed = raw ? JSON.parse(raw) as unknown : null;
    legacy = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Partial<CabinetProfile>
      : null;
  } catch {
    // Corrupted legacy data is not used as a profile.
  }

  if (!legacy) {
    removeLegacyProfile(legacyKey);
    return payload.profile;
  }

  // Transfer a legacy profile only if the account has no server profile yet.
  // Keep the old copy if the upload fails, so a later retry can recover it.
  const saved = await writeCabinetProfile(identity, { ...payload.profile, ...legacy, email: identity.email });
  removeLegacyProfile(legacyKey);
  return saved;
}

export async function writeCabinetProfile(identity: ClientUserIdentity, profile: CabinetProfile): Promise<CabinetProfile> {
  if (!identity.accessToken || identity.ownerKey === "local-user") {
    throw new Error("Войдите в аккаунт, чтобы сохранить профиль.");
  }

  const response = await fetch("/api/cabinet/profile", {
    method: "PUT",
    headers: {
      Authorization: "Bearer " + identity.accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ profile }),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
    profile?: CabinetProfile;
  } | null;

  if (!response.ok || !payload?.profile) {
    throw new Error(payload?.error || "Не удалось сохранить профиль.");
  }

  removeLegacyProfile(profileStorageKey(identity.ownerKey));
  return payload.profile;
}
