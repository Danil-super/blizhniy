"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient, isSupabaseBrowserConfigured } from "@/lib/supabase-browser";
import type { PublicationStatus } from "@/lib/types";

type StatusOption = {
  label: string;
  value: PublicationStatus;
};

type AdminPublicationStatusFormProps = {
  entityType: string;
  id: string;
  onSaved?: () => void;
  status: string;
  options: StatusOption[];
  updateStatusAction?: (formData: FormData) => void | Promise<void>;
};

export function AdminPublicationStatusForm({ entityType, id, onSaved, status, options }: AdminPublicationStatusFormProps) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function getAccessToken() {
    if (!isSupabaseBrowserConfigured()) {
      return "";
    }

    const supabase = getSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();

    return data.session?.access_token ?? "";
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaving(true);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const token = await getAccessToken();

    try {
      const response = await fetch("/api/admin/publications/status", {
        body: JSON.stringify({
          entityType,
          id,
          reason: String(formData.get("reason") ?? ""),
          status: String(formData.get("status") ?? ""),
        }),
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        method: "POST",
      });

      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Не удалось обновить статус");
      }

      const details = form.closest("details");

      if (details) {
        details.open = false;
      }

      onSaved?.();
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Не удалось обновить статус");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-2 rounded-md border-t border-slate-100 px-3 py-2">
      <label className="grid gap-1 text-xs font-semibold text-slate-600">
        Статус
        <select name="status" defaultValue={status} className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs font-bold text-slate-800 outline-none focus:border-[#0875d1]">
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs font-semibold text-slate-600">
        Причина для владельца
        <textarea
          name="reason"
          maxLength={1000}
          className="min-h-20 resize-y rounded-md border border-slate-300 bg-white px-2 py-2 text-xs font-semibold text-slate-800 outline-none focus:border-[#0875d1]"
          placeholder="Например: нарушены правила публикации, неактуальные контакты или требуется исправить описание."
        />
      </label>
      {error ? <p className="rounded-md bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">{error}</p> : null}
      <button type="submit" disabled={saving} className="inline-flex h-8 items-center justify-center rounded-md bg-[#0875d1] px-3 text-xs font-bold text-white transition hover:bg-[#0664b3] disabled:cursor-not-allowed disabled:opacity-60">
        {saving ? "Сохраняю..." : "Сохранить статус"}
      </button>
    </form>
  );
}
