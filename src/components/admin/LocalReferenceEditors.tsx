"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import type { CategoryRow } from "@/lib/category-contract";
import type { Tariff } from "@/lib/types";
import { localReferenceAdmin, parseAdminDuration, parseAdminPrice } from "@/lib/local-reference-admin";

export const adminButtonStyle = "min-h-11 min-w-11 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-brand-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue disabled:opacity-50";
const inputStyle = "mt-1 min-h-11 w-full rounded-lg border border-slate-400 bg-white px-3 py-2 text-brand-ink focus:outline-none focus:ring-2 focus:ring-brand-blue";
type Actions = { save: (operation: () => Promise<unknown>) => void; invalid: (message: string) => void };

export function LocalCategoryEditor({ row, save, invalid }: Actions & { row: CategoryRow }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    const order = String(data.get("order") ?? "");
    if (!name || name.length > 200 || !/^\d{1,7}$/.test(order) || Number(order) > 1000000) { invalid("Проверьте название и целый порядок от 0 до 1000000."); return; }
    save(() => localReferenceAdmin.updateCategory({ id: row.id, name, sortOrder: Number(order), active: data.get("active") === "on" }));
  }
  return <form onSubmit={submit} aria-label={`Категория ${row.name}`} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
    <p className="break-all text-sm text-slate-600">{row.parent_id ? "Подкатегория" : "Раздел"} · {row.slug} · {row.active ? "Видна" : "Скрыта"}</p>
    <label className="block text-sm font-semibold text-brand-ink">Название категории
      <input name="name" defaultValue={row.name} maxLength={200} required className={inputStyle} />
    </label>
    <label className="block text-sm font-semibold text-brand-ink">Порядок
      <input name="order" type="number" min={0} max={1000000} step={1} defaultValue={row.sort_order ?? 0} required className={inputStyle} />
    </label>
    <label className="flex min-h-11 items-center gap-3 text-sm text-brand-ink"><input name="active" type="checkbox" defaultChecked={row.active} className="h-5 w-5" />Категория видна</label>
    <button type="submit" className={adminButtonStyle}>Сохранить категорию</button>
  </form>;
}

export function LocalTariffEditor({ row, save, invalid }: Actions & { row: Tariff }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      const name = String(data.get("name") ?? "").trim();
      const price = parseAdminPrice(String(data.get("price") ?? ""));
      const durationDays = parseAdminDuration(String(data.get("duration") ?? ""));
      if (!name || name.length > 200) throw new Error("Invalid name");
      save(() => localReferenceAdmin.updateTariff({ id: row.id, name, price, durationDays, active: data.get("active") === "on" }));
    } catch { invalid("Проверьте название, неотрицательную цену (до двух знаков после запятой) и срок от 1 до 3650 дней или пустой срок."); }
  }
  return <form onSubmit={submit} aria-label={`Тариф ${row.name}`} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
    <p className="break-all text-sm text-slate-600">{row.id} · {row.active ? "Активен" : "Отключён"}</p>
    <label className="block text-sm font-semibold text-brand-ink">Название тарифа<input name="name" defaultValue={row.name} maxLength={200} required className={inputStyle} /></label>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="block text-sm font-semibold text-brand-ink">Цена, ₽<input name="price" inputMode="decimal" maxLength={13} defaultValue={row.price.toFixed(2)} required className={inputStyle} /></label>
      <label className="block text-sm font-semibold text-brand-ink">Срок, дней<input name="duration" inputMode="numeric" maxLength={4} defaultValue={row.durationDays ?? ""} className={inputStyle} /><span className="mt-1 block font-normal text-slate-600">Пусто — без срока</span></label>
    </div>
    <label className="flex min-h-11 items-center gap-3 text-sm text-brand-ink"><input name="active" type="checkbox" defaultChecked={row.active} className="h-5 w-5" />Тариф активен</label>
    <button type="submit" className={adminButtonStyle}>Сохранить тариф</button>
  </form>;
}

export function LocalRootOrder({ rows, save }: { rows: CategoryRow[]; save: Actions["save"] }) {
  const [order, setOrder] = useState(rows);
  function move(index: number, direction: number) {
    setOrder(previous => { const next = [...previous]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next; });
  }
  const changed = order.some((row, index) => row.id !== rows[index].id);
  return <div className="mb-6 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
    <h3 className="font-semibold text-brand-ink">Порядок разделов</h3>
    <p className="text-sm text-slate-600">Стрелки меняют только черновик. Сохранение отправит полный порядок, включая скрытые разделы.</p>
    <ol className="space-y-2">{order.map((row, index) => <li key={row.id} className="flex flex-wrap items-center gap-2">
      <span className="min-w-0 flex-1 break-words text-sm text-brand-ink">{index + 1}. {row.name}{!row.active && " · скрыт"}</span>
      <button type="button" className={adminButtonStyle} disabled={index === 0} aria-label={`Выше: ${row.name}`} onClick={() => move(index, -1)}>↑</button>
      <button type="button" className={adminButtonStyle} disabled={index === order.length - 1} aria-label={`Ниже: ${row.name}`} onClick={() => move(index, 1)}>↓</button>
    </li>)}</ol>
    <button type="button" className={adminButtonStyle} disabled={!changed} onClick={() => { save(() => localReferenceAdmin.reorder(order.map(row => row.id))); }}>Сохранить порядок разделов</button>
  </div>;
}
