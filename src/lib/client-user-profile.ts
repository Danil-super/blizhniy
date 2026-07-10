"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export type ClientUserIdentity = {
  accessToken?: string;
  ownerKey: string;
  name: string;
  email: string;
};

export type CabinetProfile = {
  name: string;
  avatarDataUrl: string;
  avatarZoom: number;
  avatarPositionX: number;
  avatarPositionY: number;
  phone: string;
  phoneVerified: boolean;
  verifiedPhone: string;
  email: string;
  city: string;
  notifyBookings: boolean;
  notifyMessages: boolean;
  notifyPayments: boolean;
  notifyPublicationStatus: boolean;
  notifySystem: boolean;
  emailNotifications: boolean;
  pushNotifications: boolean;
  organizationName: string;
  organizationInn: string;
  organizationOgrn: string;
  organizationAddress: string;
  organizationWebsite: string;
  organizationDescription: string;
};

export function profileStorageKey(ownerKey: string) {
  return `blizhniy-user-profile:${ownerKey}`;
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

export function createDefaultCabinetProfile(identity: ClientUserIdentity): CabinetProfile {
  return {
    name: identity.name,
    avatarDataUrl: "",
    avatarZoom: 1,
    avatarPositionX: 50,
    avatarPositionY: 50,
    phone: "",
    phoneVerified: false,
    verifiedPhone: "",
    email: identity.email,
    city: "Краснодар",
    notifyBookings: true,
    notifyMessages: true,
    notifyPayments: true,
    notifyPublicationStatus: true,
    notifySystem: true,
    emailNotifications: true,
    pushNotifications: false,
    organizationName: "",
    organizationInn: "",
    organizationOgrn: "",
    organizationAddress: "",
    organizationWebsite: "",
    organizationDescription: "",
  };
}

export function readCabinetProfile(ownerKey: string, fallback: CabinetProfile): CabinetProfile {
  try {
    const stored = window.localStorage.getItem(profileStorageKey(ownerKey));
    const parsed = stored ? (JSON.parse(stored) as Partial<CabinetProfile>) : null;

    if (parsed && typeof parsed === "object") {
      return {
        ...fallback,
        ...parsed,
        name: String(parsed.name ?? fallback.name),
        avatarDataUrl: String(parsed.avatarDataUrl ?? fallback.avatarDataUrl),
        avatarZoom: Number(parsed.avatarZoom ?? fallback.avatarZoom),
        avatarPositionX: Number(parsed.avatarPositionX ?? fallback.avatarPositionX),
        avatarPositionY: Number(parsed.avatarPositionY ?? fallback.avatarPositionY),
        phone: String(parsed.phone ?? fallback.phone),
        phoneVerified: Boolean(parsed.phoneVerified ?? fallback.phoneVerified),
        verifiedPhone: String(parsed.verifiedPhone ?? fallback.verifiedPhone),
        email: String(parsed.email ?? fallback.email),
        city: String(parsed.city ?? fallback.city),
        notifyBookings: Boolean(parsed.notifyBookings ?? fallback.notifyBookings),
        notifyMessages: Boolean(parsed.notifyMessages ?? fallback.notifyMessages),
        notifyPayments: Boolean(parsed.notifyPayments ?? fallback.notifyPayments),
        notifyPublicationStatus: Boolean(parsed.notifyPublicationStatus ?? fallback.notifyPublicationStatus),
        notifySystem: Boolean(parsed.notifySystem ?? fallback.notifySystem),
        emailNotifications: Boolean(parsed.emailNotifications ?? fallback.emailNotifications),
        pushNotifications: Boolean(parsed.pushNotifications ?? fallback.pushNotifications),
        organizationName: String(parsed.organizationName ?? fallback.organizationName),
        organizationInn: String(parsed.organizationInn ?? fallback.organizationInn),
        organizationOgrn: String(parsed.organizationOgrn ?? fallback.organizationOgrn),
        organizationAddress: String(parsed.organizationAddress ?? fallback.organizationAddress),
        organizationWebsite: String(parsed.organizationWebsite ?? fallback.organizationWebsite),
        organizationDescription: String(parsed.organizationDescription ?? fallback.organizationDescription),
      };
    }
  } catch {
    return fallback;
  }

  return fallback;
}

export function writeCabinetProfile(ownerKey: string, profile: CabinetProfile, options: { notify?: boolean } = {}) {
  window.localStorage.setItem(profileStorageKey(ownerKey), JSON.stringify(profile));

  if (options.notify !== false) {
    window.dispatchEvent(new Event("blizhniy-profile-updated"));
  }
}
