"use client";

import { FormEvent, useEffect, useState } from "react";
import { getSupabaseBrowserClient, isSupabaseBrowserConfigured } from "@/lib/supabase-browser";
import type { Tariff } from "@/lib/types";

type Payload = { tariffs?: Tariff[]; error?: string };

async function token() {
  if (!isSupabaseBrowserConfigured()) {
    return "";
  }

  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session?.access_token ?? "";
}

function tariffFormKey(tariff: Tariff) {
  return `${tariff.id}:${tariff.name}:${tariff.price}:${tariff.durationDays ?? "once"}:${tariff.active}`;
}

export function AdminTariffsClient({
  initialMessage = "Готово к работе с тарифами.",
  initialTariffs,
}: {
  initialMessage?: string;
  initialTariffs: Tariff[];
}) {
  const [tariffs, setTariffs] = useState(initialTariffs);
  const [message, setMessage] = useState(initialMessage);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const authToken = await token();
      const response = await fetch("/api/admin/tariffs", { headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined });
      const payload = (await response.json()) as Payload;
      if (!response.ok) throw new Error(payload.error ?? "Не удалось загрузить данные");
      setTariffs(payload.tariffs ?? []);
      setMessage("Данные загружены из базы.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка загрузки");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("Сохраняем тариф...");

    const form = new FormData(event.currentTarget);
    const durationRaw = String(form.get("durationDays") ?? "").trim();

    try {
      const authToken = await token();
      const response = await fetch("/api/admin/tariffs", {
        method: "PATCH",
        headers: { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), "Content-Type": "application/json" },
        body: JSON.stringify({
          active: form.get("active") === "1",
          durationDays: durationRaw ? Number(durationRaw) : null,
          id: String(form.get("id") ?? ""),
          name: String(form.get("name") ?? ""),
          price: Number(form.get("price")),
        }),
      });
      const payload = (await response.json()) as Payload;
      if (!response.ok) throw new Error(payload.error ?? "Не удалось сохранить тариф");
      setTariffs(payload.tariffs ?? tariffs);
      setMessage("Тариф сохранен.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    setSaving(true);
    setMessage("Сбрасываем тарифы...");
    try {
      const authToken = await token();
      const response = await fetch("/api/admin/tariffs", {
        method: "POST",
        headers: { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset" }),
      });
      const payload = (await response.json()) as Payload;
      if (!response.ok) throw new Error(payload.error ?? "Не удалось сбросить тарифы");
      setTariffs(payload.tariffs ?? tariffs);
      setMessage("Тарифы сброшены.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка сброса");
    } finally {
      setSaving(false);
    }
  }

  const activeCount = tariffs.filter((tariff) => tariff.active).length;
  const minPrice = tariffs.reduce((min, tariff) => Math.min(min, tariff.price), Number.POSITIVE_INFINITY);

  return (
    <>
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
          <p className="text-[11px] font-bold text-slate-500 sm:text-xs">Активные</p>
          <p className="mt-1 text-xl font-bold text-[#060b27]">{activeCount}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
          <p className="text-[11px] font-bold text-slate-500 sm:text-xs">Всего</p>
          <p className="mt-1 text-xl font-bold text-[#060b27]">{tariffs.length}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
          <p className="text-[11px] font-bold text-slate-500 sm:text-xs">От</p>
          <p className="mt-1 text-xl font-bold text-[#060b27]">{Number.isFinite(minPrice) ? minPrice : 0} ₽</p>
        </div>
      </div>

      <section className="mt-6 rounded-lg border border-blue-100 bg-blue-50/50 p-3 sm:p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-[#060b27]">Редактирование тарифов</h2>
            <p className="text-xs leading-5 text-slate-600 sm:text-sm">Сохранение идет через защищенный API и Supabase. Новые цены применяются только к новым оплатам.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
            <button type="button" onClick={load} className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold">Обновить</button>
            <button type="button" onClick={reset} disabled={saving} className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold disabled:opacity-60">Сбросить</button>
          </div>
        </div>
        <p className="mt-3 text-sm font-semibold text-slate-600">{message}</p>
        <div className="mt-4 grid gap-2 xl:grid-cols-2">
          {tariffs.map((tariff) => (
            <form key={tariffFormKey(tariff)} onSubmit={save} className="grid gap-2 rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm sm:p-3">
              <input type="hidden" name="id" value={tariff.id} />
              <label className="grid gap-1 text-[11px] font-bold text-slate-600 sm:text-xs">
                Название
                <input name="name" defaultValue={tariff.name} className="h-9 rounded-lg border border-slate-300 px-3 text-sm font-bold text-[#060b27] outline-none focus:border-[#0875d1]" />
              </label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_auto_auto]">
                <label className="grid gap-1 text-[11px] font-bold text-slate-600 sm:text-xs">
                  Цена
                  <input type="number" min={0} step={1} name="price" defaultValue={tariff.price} className="h-9 rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-[#0875d1]" />
                </label>
                <label className="grid gap-1 text-[11px] font-bold text-slate-600 sm:text-xs">
                  Дней
                  <input type="number" min={0} step={1} name="durationDays" placeholder="Разово" defaultValue={tariff.durationDays ?? ""} className="h-9 rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-[#0875d1]" />
                </label>
                <label className="col-span-1 flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 text-[11px] font-bold text-slate-700 sm:px-3 sm:text-xs">
                  <input type="checkbox" name="active" value="1" defaultChecked={tariff.active} className="h-4 w-4 shrink-0 accent-[#0875d1]" />
                  Активен
                </label>
                <button type="submit" disabled={saving} className="h-9 rounded-lg bg-[#0875d1] px-2 text-[11px] font-bold text-white disabled:opacity-60 sm:px-3 sm:text-xs">
                  Сохранить
                </button>
              </div>
            </form>
          ))}
        </div>
      </section>
    </>
  );
}
