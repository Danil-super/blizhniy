"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { CategoryRow } from "@/lib/category-contract";
import type { Tariff } from "@/lib/types";
import { LocalAdminError, localReferenceAdmin } from "@/lib/local-reference-admin";
import { adminButtonStyle, LocalCategoryEditor, LocalRootOrder, LocalTariffEditor } from "./LocalReferenceEditors";

type References = { categories: CategoryRow[]; tariffs: Tariff[] };
const messages: Record<string, string> = {
  UNAUTHENTICATED: "Войдите в локальный аккаунт администратора.",
  ADMIN_REQUIRED: "Нет действующих прав администратора. Справочники скрыты.",
  NOT_FOUND: "Запись недоступна. Перечитайте справочники.",
  INVALID_INPUT: "Изменения отклонены. Перечитайте данные и проверьте поля.",
  RATE_LIMITED: "Достигнут лимит запросов. Подождите до 15 минут перед повторным чтением.",
};
const unavailable = "Не удалось проверить данные. Если выполнялось сохранение, его результат неизвестен. Не повторяйте запись: сначала перечитайте справочники.";

export function LocalReferenceAdmin() {
  const [data, setData] = useState<References | null>(null);
  const [loading, setLoading] = useState(true);
  const [issue, setIssue] = useState("");
  const [notice, setNotice] = useState("");
  const version = useRef(0);
  const mounted = useRef(false);
  const busy = useRef(false);
  const pendingCheck = useRef(false);
  const alert = useRef<HTMLParagraphElement>(null);
  const refresh = useCallback(async (saved = false) => {
    const current = ++version.current;
    setData(null); setIssue(""); setNotice(""); setLoading(true);
    if (busy.current) { pendingCheck.current = true; return; }
    try {
      const [categories, tariffs] = await Promise.all([localReferenceAdmin.categories(), localReferenceAdmin.tariffs()]);
      if (mounted.current && current === version.current) { setData({ categories, tariffs }); if (saved) setNotice("Изменения сохранены; данные перечитаны с сервера."); }
    } catch (error) {
      if (mounted.current && current === version.current) setIssue(error instanceof LocalAdminError ? messages[error.code] ?? unavailable : unavailable);
    } finally { if (mounted.current && current === version.current) setLoading(false); }
  }, []);
  useEffect(() => {
    mounted.current = true; void refresh();
    const check = () => { void refresh(); };
    const visible = () => { if (document.visibilityState === "visible") check(); };
    const pageshow = (event: PageTransitionEvent) => { if (event.persisted) check(); };
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("blizhniy-local-auth");
    if (channel) channel.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data && typeof event.data === "object" && "type" in event.data && event.data.type === "changed") check();
    };
    window.addEventListener("focus", check); window.addEventListener("pageshow", pageshow); document.addEventListener("visibilitychange", visible);
    return () => { mounted.current = false; version.current += 1; channel?.close(); window.removeEventListener("focus", check); window.removeEventListener("pageshow", pageshow); document.removeEventListener("visibilitychange", visible); };
  }, [refresh]);
  useEffect(() => { if (issue) alert.current?.focus(); }, [issue]);

  async function save(operation: () => Promise<unknown>) {
    if (busy.current) return;
    const current = ++version.current;
    busy.current = true; setData(null); setLoading(true); setIssue(""); setNotice("");
    let completed = false;
    try { await operation(); completed = true; }
    catch (error) { if (mounted.current && current === version.current) setIssue(error instanceof LocalAdminError ? messages[error.code] ?? unavailable : unavailable); }
    finally {
      busy.current = false;
      if (mounted.current) {
        setLoading(false);
        // Only a confirmed write triggers readback. A context switch also requires fresh authority.
        if (completed || pendingCheck.current) { pendingCheck.current = false; void refresh(completed); }
      }
    }
  }
  const invalid = (message: string) => { setNotice(""); setIssue(message); };
  return <main className="page-container py-8 md:py-12" aria-busy={loading}>
    <a href="#local-references" className="sr-only focus:not-sr-only focus:inline-flex focus:min-h-11 focus:items-center">К справочникам</a>
    <h1 className="text-2xl font-bold text-brand-ink">Управление справочниками</h1>
    <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-700">Локальный стенд · PostgreSQL. Не рабочая админка сайта. При смене аккаунта или возврате на вкладку данные и несохранённые черновики сбрасываются; права заново проверяет сервер.</p>
    <nav aria-label="Локальное администрирование" className="my-5 flex flex-wrap items-center gap-4">
      <Link href="/auth/local/login" prefetch={false} className="inline-flex min-h-11 items-center font-semibold text-brand-blue underline">Вход и выход</Link>
      <button type="button" disabled={loading} className={adminButtonStyle} onClick={() => { void refresh(); }}>Перечитать справочники</button>
    </nav>
    <p role="status" className="mb-4 text-sm text-slate-700">{loading ? "Проверяем права и загружаем справочники…" : notice}</p>
    {issue && <p ref={alert} role="alert" tabIndex={-1} className="mb-5 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">{issue}</p>}
    <div id="local-references">{data && <>
      <section aria-labelledby="local-tariffs" className="mb-8">
        <h2 id="local-tariffs" className="mb-4 text-xl font-bold text-brand-ink">Тарифы</h2>
        {data.tariffs.length === 0 ? <p className="text-slate-700">Тарифов пока нет. Автоматическое восстановление цен не выполняется.</p> : <div className="grid gap-4 md:grid-cols-2">{data.tariffs.map(row => <LocalTariffEditor key={row.id} row={row} save={save} invalid={invalid} />)}</div>}
      </section>
      <section aria-labelledby="local-categories">
        <h2 id="local-categories" className="mb-4 text-xl font-bold text-brand-ink">Категории</h2>
        {data.categories.length === 0 ? <p className="text-slate-700">Категорий пока нет. Создание и удаление здесь недоступны.</p> : <>
          <LocalRootOrder rows={data.categories.filter(row => row.parent_id === null)} save={save} />
          <div className="grid gap-4 md:grid-cols-2">{data.categories.map(row => <LocalCategoryEditor key={row.id} row={row} save={save} invalid={invalid} />)}</div>
        </>}
      </section>
    </>}</div>
  </main>;
}
