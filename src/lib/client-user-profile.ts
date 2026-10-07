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

/** Captured before an async action; requests keep this identity's bearer. */
export type ClientUserOperation = {
  identity: ClientUserIdentity;
  assertCurrentSession: () => Promise<void>;
};

const legacyProfilePrefix = "blizhniy-user-profile:";

export function profileStorageKey(ownerKey: string) {
  return legacyProfilePrefix + ownerKey;
}

let cachedIdentity: ClientUserIdentity | null = null;
let cachedIdentityAt = 0;
let identityRequest: Promise<ClientUserIdentity> | null = null;
let authListenerInitialized = false;
let identityGeneration = 0;
let operationGeneration = 0;
let sessionOwnerKey: string | null | undefined;

const sessionChangedError = "Сессия изменилась. Войдите в аккаунт повторно и повторите действие.";

const identityCacheTtlMs = 60_000;

function clearCachedIdentity() {
  identityGeneration += 1;
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
    getSupabaseBrowserClient().auth.onAuthStateChange((event, session) => {
      const ownerKey = session?.user?.id ?? null;
      const previousOwner = sessionOwnerKey === undefined ? cachedIdentity?.ownerKey : sessionOwnerKey;
      // INITIAL_SESSION establishes the initial owner; a normal same-owner
      // token refresh invalidates the cache but does not cancel operations.
      if (event !== "INITIAL_SESSION" && (previousOwner !== undefined
        ? previousOwner !== ownerKey
        : event !== "TOKEN_REFRESHED")) {
        operationGeneration += 1;
      }
      sessionOwnerKey = ownerKey;
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

  if (identityRequest) {
    return identityRequest;
  }

  const generation = identityGeneration;
  const request = loadClientUserIdentity()
    .then((identity) => {
      // An Auth event can arrive while getSession is pending. Its old result
      // must neither repopulate the cache nor be returned to the next account.
      if (generation !== identityGeneration) {
        return resolveClientUserIdentity();
      }

      cachedIdentity = identity;
      cachedIdentityAt = Date.now();
      return identity;
    })
    .finally(() => {
      if (identityRequest === request) identityRequest = null;
    });

  identityRequest = request;
  return request;
}

export async function resolveAuthenticatedClientUserIdentity(): Promise<ClientUserIdentity> {
  const identity = await resolveClientUserIdentity();

  if (!identity.accessToken || identity.ownerKey === "local-user") {
    throw new Error("Войдите или зарегистрируйтесь, чтобы разместить публикацию.");
  }

  return identity;
}

/**
 * Capture the account-transition generation before the first Auth await. A
 * pending identity lookup may correctly resolve B after A switches accounts,
 * but that does not authorize an action which started with A's private data.
 */
export async function captureClientUserOperation(expectedOwnerKey?: string): Promise<ClientUserOperation> {
  ensureIdentityAuthListener();
  const generation = operationGeneration;
  const identity = await resolveClientUserIdentity();
  if (generation !== operationGeneration || (expectedOwnerKey !== undefined && identity.ownerKey !== expectedOwnerKey)) {
    throw new Error(sessionChangedError);
  }
  sessionOwnerKey ??= identity.accessToken ? identity.ownerKey : null;

  const assertCurrentSession = async () => {
    if (generation !== operationGeneration) throw new Error(sessionChangedError);
    const current = await loadClientUserIdentity();
    if (generation !== operationGeneration || current.ownerKey !== identity.ownerKey) {
      throw new Error(sessionChangedError);
    }
  };

  return { identity, assertCurrentSession };
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

export async function readCabinetProfile(identity: ClientUserIdentity, options?: { signal?: AbortSignal }): Promise<CabinetProfile> {
  options?.signal?.throwIfAborted();
  const fallback = createDefaultCabinetProfile(identity);

  if (!identity.accessToken || identity.ownerKey === "local-user") {
    return fallback;
  }

  const legacyKey = profileStorageKey(identity.ownerKey);
  clearOtherLegacyProfiles(legacyKey);

  const response = await fetch("/api/cabinet/profile", {
    headers: { Authorization: "Bearer " + identity.accessToken },
    cache: "no-store",
    signal: options?.signal,
  });
  options?.signal?.throwIfAborted();
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
    exists?: boolean;
    profile?: CabinetProfile;
  } | null;
  options?.signal?.throwIfAborted();

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
  const saved = await writeCabinetProfile(identity, { ...payload.profile, ...legacy, email: identity.email }, options);
  options?.signal?.throwIfAborted();
  removeLegacyProfile(legacyKey);
  return saved;
}

export async function writeCabinetProfile(identity: ClientUserIdentity, profile: CabinetProfile, options?: { signal?: AbortSignal }): Promise<CabinetProfile> {
  options?.signal?.throwIfAborted();
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
    signal: options?.signal,
  });
  options?.signal?.throwIfAborted();
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
    profile?: CabinetProfile;
  } | null;
  options?.signal?.throwIfAborted();

  if (!response.ok || !payload?.profile) {
    throw new Error(payload?.error || "Не удалось сохранить профиль.");
  }

  removeLegacyProfile(profileStorageKey(identity.ownerKey));
  return payload.profile;
}
