"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { AdminAuthGate } from "@/components/auth/AdminAuthGate";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { Payment, Tariff } from "@/lib/types";

type Payload = { payments: Payment[]; tariffs: Tariff[]; error?: string };

async function token() {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session?.access_token) throw new Error("Нужно войти как администратор");
  return data.session.access_token;
}

function money(value: number) {
  return `${new Intl.NumberFormat("ru-RU").format(value)} ₽`;
}

function Badge({ value }: { value: string }) {
  const good = ["active", "succeeded"].includes(value);
  const bad = ["failed", "archive"].includes(value);
  const className = good
    ? "border-emerald-200 bg-emerald-50 text-[#0a8f32]"
    : bad
      ? "border-red-200 bg-red-50 text-red-700"
      : "border-amber-200 bg-amber-50 text-amber-700";

  return <span className={`inline-flex min-h-7 items-center rounded-full border px-3 text-xs font-bold ${className}`}>{value}</span>;
}

export function AdminTariffsClient({ initialPayments, initialTariffs }: { initialPayments: Payment[]; initialTariffs: Tariff[] }) {
  const [tariffs, setTariffs] = useState(initialTariffs);
  const [payments, setPayments] = useState(initialPayments);
  const [message, setMessage] = useState("Готово к работе с тарифами.");
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const authToken = await token();
      const response = await fetch("/api/admin/tariffs", { headers: { Authorization: `Bearer ${authToken}` } });
      const payload = (await response.json()) as Payload;
      if (!response.ok) throw new Error(payload.error ?? "Не удалось загрузить данные");
      setTariffs(payload.tariffs);
      setPayments(payload.payments);
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
        headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
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
      setTariffs(payload.tariffs);
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
        headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset" }),
      });
      const payload = (await response.json()) as Payload;
      if (!response.ok) throw new Error(payload.error ?? "Не удалось сбросить тарифы");
      setTariffs(payload.tariffs);
      setMessage("Тарифы сброшены.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка сброса");
    } finally {
      setSaving(false);
    }
  }

  const activeCount = tariffs.filter((tariff) => tariff.active).length;

  return (
    <AdminAuthGate>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-bold text-slate-500">Активные</p><p className="text-2xl font-black text-[#060b27]">{activeCount}</p></div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-bold text-slate-500">Всего тарифов</p><p className="text-2xl font-black text-[#060b27]">{tariffs.length}</p></div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-bold text-slate-500">Платежи</p><p className="text-2xl font-black text-[#060b27]">{payments.length}</p></div>
      </div>

      <section className="mt-6 rounded-lg border border-blue-100 bg-blue-50/50 p-3 sm:p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="text-xl font-black text-[#060b27]">Редактирование тарифов</h2><p className="text-sm text-slate-600">Сохранение идет через защищенный API и Supabase.</p></div>
          <div className="flex gap-2"><button type="button" onClick={load} className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold">Обновить</button><button type="button" onClick={reset} disabled={saving} className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold">Сбросить</button></div>
        </div>
        <p className="mt-3 text-sm font-semibold text-slate-600">{message}</p>
        <div className="mt-4 grid gap-2 xl:grid-cols-2">
          {tariffs.map((tariff) => (
            <form key={tariff.id} onSubmit={save} className="grid gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
              <input type="hidden" name="id" value={tariff.id} />
              <input name="name" defaultValue={tariff.name} className="h-9 rounded-lg border border-slate-300 px-3 text-sm font-bold" />
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
                <input type="number" min={0} step={1} name="price" defaultValue={tariff.price} className="h-9 rounded-lg border border-slate-300 px-3 text-sm" />
                <input type="number" min={0} step={1} name="durationDays" placeholder="Дней" defaultValue={tariff.durationDays ?? ""} className="h-9 rounded-lg border border-slate-300 px-3 text-sm" />
                <label className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-bold"><input type="checkbox" name="active" value="1" defaultChecked={tariff.active} />Активен</label>
                <button type="submit" disabled={saving} className="h-9 rounded-lg bg-[#0875d1] px-3 text-xs font-bold text-white">Сохранить</button>
              </div>
            </form>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-4 text-2xl font-black text-[#060b27]">История платежей</h2>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="bg-slate-50 text-slate-500"><tr><th className="p-4">ID</th><th className="p-4">Назначение</th><th className="p-4">Сумма</th><th className="p-4">Провайдер</th><th className="p-4">Статус</th><th className="p-4">Действия</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {payments.length ? payments.map((payment) => <tr key={payment.id}><td className="p-4 font-mono text-xs">{payment.id}</td><td className="p-4">{payment.targetTitle}</td><td className="p-4 font-bold">{money(payment.amount)}</td><td className="p-4">{payment.provider}</td><td className="p-4"><Badge value={payment.status} /></td><td className="p-4"><Link href={`/oplata/${payment.id}`} className="font-bold text-[#0875d1]">Открыть</Link></td></tr>) : <tr><td colSpan={6} className="p-8 text-center font-semibold text-slate-500">Платежей пока нет.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </AdminAuthGate>
  );
}
