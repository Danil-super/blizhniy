"use client";

import { getSupabaseBrowserClient, isSupabaseBrowserConfigured } from "@/lib/supabase-browser";
import type { ListingKind, Payment } from "@/lib/types";

type CreateStoredListingInput = {
  address?: string;
  categorySlug?: string;
  city?: string;
  description?: string;
  kind?: ListingKind;
  lat?: number;
  lng?: number;
  messengerUrl?: string;
  phone?: string;
  price?: string;
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

async function getAuthHeaders(): Promise<Record<string, string>> {
  if (!isSupabaseBrowserConfigured()) {
    return {};
  }

  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function createStoredListingPublication(input: CreateStoredListingInput) {
  const response = await fetch("/api/listings", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify(input),
  });
  const payload = (await response.json().catch(() => null)) as (CreateStoredListingResponse & { error?: string }) | null;

  if (!response.ok || !payload?.listing?.id) {
    throw new Error(payload?.error ?? "Не удалось создать объявление.");
  }

  return payload;
}
