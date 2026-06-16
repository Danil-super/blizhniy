"use client";

import { getSupabaseBrowserClient, isSupabaseBrowserConfigured } from "@/lib/supabase-browser";
import type { ListingKind, Payment } from "@/lib/types";

type CreateStoredListingInput = {
  accessToken?: string;
  address?: string;
  categorySlug?: string;
  city?: string;
  description?: string;
  kind?: ListingKind;
  lat?: number;
  lng?: number;
  mediaPaths?: string[];
  messengerUrl?: string;
  phone?: string;
  price?: string;
  status?: "draft" | "pending_payment";
  subcategory?: string;
  tariffId?: string;
  title?: string;
};

type CreateStoredListingResponse = {
  listing?: {
    id?: string;
    slug?: string;
    status?: string;
    title?: string;
  };
  payment?: Pick<Payment, "confirmationUrl" | "id" | "provider" | "status">;
};

async function getAuthHeaders(accessToken?: string): Promise<Record<string, string>> {
  if (accessToken) {
    return { Authorization: `Bearer ${accessToken}` };
  }

  if (!isSupabaseBrowserConfigured()) {
    return {};
  }

  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function createStoredListingPublication(input: CreateStoredListingInput) {
  const { accessToken, ...payloadBody } = input;
  const endpoint = payloadBody.status === "draft" ? "/api/listings/draft" : "/api/listings";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders(accessToken)) },
    body: JSON.stringify(payloadBody),
  });
  const payload = (await response.json().catch(() => null)) as (CreateStoredListingResponse & { error?: string }) | null;

  if (!response.ok || !payload?.listing?.id) {
    throw new Error(payload?.error ?? "Не удалось создать объявление.");
  }

  return payload;
}
