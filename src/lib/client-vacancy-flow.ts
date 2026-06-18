"use client";

import { getSupabaseBrowserClient, isSupabaseBrowserConfigured } from "@/lib/supabase-browser";
import type { JobVacancy, Payment } from "@/lib/types";

type CreateStoredVacancyInput = {
  accessToken?: string;
  address?: string;
  city?: string;
  conditions?: string;
  contactPerson?: string;
  description?: string;
  email?: string;
  employerType?: string;
  inn?: string;
  ogrn?: string;
  ogrnip?: string;
  lat?: number;
  lng?: number;
  mediaPaths?: string[];
  messengerUrl?: string;
  organization?: string;
  placementRightConfirmed?: boolean;
  phone?: string;
  profession?: string;
  requirements?: string;
  responsibilities?: string;
  salary?: string;
  schedule?: string;
  status?: "draft";
  tariffId?: string;
  title?: string;
  website?: string;
  workFormat?: string;
};

type CreateStoredVacancyResponse = {
  payment?: Pick<Payment, "confirmationUrl" | "id" | "provider" | "status">;
  vacancy?: Partial<JobVacancy> & {
    id?: string;
    status?: string;
    title?: string;
  };
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

export async function createStoredVacancyPublication(input: CreateStoredVacancyInput) {
  const { accessToken, ...payloadBody } = input;
  const response = await fetch("/api/vacancies", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders(accessToken)) },
    body: JSON.stringify(payloadBody),
  });
  const payload = (await response.json().catch(() => null)) as (CreateStoredVacancyResponse & { error?: string }) | null;

  if (!response.ok || !payload?.vacancy?.id) {
    throw new Error(payload?.error ?? "Не удалось создать вакансию.");
  }

  return payload;
}
