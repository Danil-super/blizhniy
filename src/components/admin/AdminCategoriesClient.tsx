"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, RotateCcw } from "lucide-react";
import { getSupabaseBrowserClient, isSupabaseBrowserConfigured } from "@/lib/supabase-browser";
import type { AdminCategoryRow } from "@/lib/category-store";

type CategoriesResponse = {
  categories?: AdminCategoryRow[];
  error?: string;
};

async function getAccessToken() {
  if (!isSupabaseBrowserConfigured()) {
    return "";
  }

  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();

  return data.session?.access_token ?? "";
}

function moveItem(items: AdminCategoryRow[], id: string, direction: -1 | 1) {
  const currentIndex = items.findIndex((item) => item.id === id);
  const nextIndex = currentIndex + direction;

  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= items.length) {
    return items;
  }

  const nextItems = [...items];
  const [item] = nextItems.splice(currentIndex, 1);
  nextItems.splice(nextIndex, 0, item);
  return nextItems;
}

function moveItemToEdge(items: AdminCategoryRow[], id: string, edge: "start" | "end") {
  const currentIndex = items.findIndex((item) => item.id === id);

  if (currentIndex < 0) {
    return items;
  }

  const nextItems = [...items];
  const [item] = nextItems.splice(currentIndex, 1);

  if (edge === "start") {
    nextItems.unshift(item);
  } else {
    nextItems.push(item);
  }

  return nextItems;
}

function CategoryStatusBadge({ active }: { active: boolean }) {
  return (
    <span className={`inline-flex min-h-7 w-fit items-center rounded-full border px-3 text-xs font-bold ${active ? "border-emerald-200 bg-emerald-50 text-[#0a8f32]" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
      {active ? "Активна" : "Скрыта"}
    </span>
  );
}

export function AdminCategoriesClient() {
  const [categories, setCategories] = useState<AdminCategoryRow[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const activeCount = useMemo(() => categories.filter((category) => category.active).length, [categories]);
  const childCount = useMemo(() => categories.reduce((sum, category) => sum + category.children.length, 0), [categories]);

  useEffect(() => {
    let active = true;

    async function loadCategories() {
      setState("loading");
      setError("");

      try {
        const token = await getAccessToken();
        const response = await fetch("/api/admin/categories", {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        const payload = (await response.json().catch(() => null)) as CategoriesResponse | null;

        if (!response.ok) {
          throw new Error(payload?.error ?? "Не удалось загрузить категории");
        }

        if (active) {
          setCategories(payload?.categories ?? []);
          setState("ready");
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить категории");
          setState("error");
        }
      }
    }

    loadCategories();

    return () => {
      active = false;
    };
  }, []);

  async function patchCategories(body: Record<string, unknown>, nextMessage: string, savingTarget = "order") {
    setSavingId(savingTarget);
    setError("");
    setMessage("");

    try {
      const token = await getAccessToken();
      const response = await fetch("/api/admin/categories", {
        body: JSON.stringify(body),
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        method: "PATCH",
      });
      const payload = (await response.json().catch(() => null)) as CategoriesResponse | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Не удалось сохранить категории");
      }

      setCategories(payload?.categories ?? categories);
      setMessage(nextMessage);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Не удалось сохранить категории");
    } finally {
      setSavingId("");
    }
  }

  function applyOrder(nextCategories: AdminCategoryRow[]) {
    setCategories(nextCategories);
    patchCategories({ ids: nextCategories.map((category) => category.id) }, "Порядок сохранен в базе");
  }

  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <article className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-3.5">
          <p className="text-xs font-bold leading-4 text-slate-500">Категории</p>
          <p className="mt-1.5 text-xl font-bold leading-tight text-[#060b27]">{categories.length}</p>
          <p className="mt-1 text-xs leading-4 text-slate-600">{activeCount} активных</p>
        </article>
        <article className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-3.5">
          <p className="text-xs font-bold leading-4 text-slate-500">Подразделы</p>
          <p className="mt-1.5 text-xl font-bold leading-tight text-[#060b27]">{childCount}</p>
          <p className="mt-1 text-xs leading-4 text-slate-600">Из таблицы categories</p>
        </article>
        <article className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-3.5">
          <p className="text-xs font-bold leading-4 text-slate-500">Источник</p>
          <p className="mt-1.5 text-xl font-bold leading-tight text-[#060b27]">БД</p>
          <p className="mt-1 text-xs leading-4 text-slate-600">Supabase sort_order</p>
        </article>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white shadow-card">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-3 sm:flex-row sm:items-start sm:justify-between sm:p-4">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-[#060b27]">Рубрикатор</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
              Порядок, активность и названия сохраняются в таблице Supabase `categories`.
            </p>
          </div>
          <button
            type="button"
            disabled={savingId === "reload"}
            onClick={() => patchCategories({ ids: categories.map((category) => category.id) }, "Порядок пересохранен", "reload")}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-[#0875d1] disabled:opacity-60"
          >
            <RotateCcw className="h-4 w-4" />
            Сохранить порядок
          </button>
        </div>

        {state === "loading" ? <p className="px-4 py-8 text-sm font-semibold text-slate-500">Загружаем категории...</p> : null}
        {state === "error" ? <p className="px-4 py-8 text-sm font-semibold text-red-700">{error}</p> : null}

        {state === "ready" ? (
          <>
            <div className="hidden max-h-[65dvh] overflow-auto lg:block">
              <table className="w-full min-w-[1040px] table-fixed border-collapse text-left text-sm">
                <thead className="bg-slate-50 text-sm text-slate-500">
                  <tr>
                    <th className="w-[70px] border-b border-slate-200 px-5 py-4 font-bold">N</th>
                    <th className="w-[260px] border-b border-slate-200 px-5 py-4 font-bold">Категория</th>
                    <th className="w-[210px] border-b border-slate-200 px-5 py-4 font-bold">Slug</th>
                    <th className="border-b border-slate-200 px-5 py-4 font-bold">Подразделы</th>
                    <th className="w-[130px] border-b border-slate-200 px-5 py-4 font-bold">Статус</th>
                    <th className="w-[260px] border-b border-slate-200 px-5 py-4 font-bold">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {categories.map((category, index) => (
                    <tr className="align-top text-slate-700" key={category.id}>
                      <td className="px-5 py-4 font-mono text-xs font-semibold text-slate-500">{index + 1}</td>
                      <td className="px-5 py-4">
                        <input
                          defaultValue={category.name}
                          onBlur={(event) => {
                            if (event.target.value.trim() !== category.name) {
                              patchCategories({ id: category.id, name: event.target.value }, "Название сохранено", category.id);
                            }
                          }}
                          className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-[#060b27] outline-none focus:border-[#0875d1]"
                        />
                      </td>
                      <td className="px-5 py-4">
                        <Link href={category.href} className="break-all font-mono text-xs font-semibold text-[#0875d1]">
                          {category.slug}
                        </Link>
                      </td>
                      <td className="px-5 py-4 text-xs font-semibold leading-5 text-slate-600">
                        {category.children.length ? category.children.map((child) => child.name).join(", ") : "Нет подразделов"}
                      </td>
                      <td className="px-5 py-4">
                        <CategoryStatusBadge active={category.active} />
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap gap-2">
                          <button type="button" disabled={index === 0 || Boolean(savingId)} onClick={() => applyOrder(moveItem(categories, category.id, -1))} className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold text-slate-700 disabled:opacity-40">
                            <ArrowUp className="h-3.5 w-3.5" />
                            Выше
                          </button>
                          <button type="button" disabled={index === categories.length - 1 || Boolean(savingId)} onClick={() => applyOrder(moveItem(categories, category.id, 1))} className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold text-slate-700 disabled:opacity-40">
                            <ArrowDown className="h-3.5 w-3.5" />
                            Ниже
                          </button>
                          <button type="button" disabled={Boolean(savingId)} onClick={() => patchCategories({ active: !category.active, id: category.id }, category.active ? "Категория скрыта" : "Категория активна", category.id)} className="inline-flex h-9 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-[#0875d1] disabled:opacity-40">
                            {category.active ? "Скрыть" : "Включить"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid gap-3 p-3 lg:hidden">
              {categories.map((category, index) => (
                <article className="rounded-lg border border-slate-200 bg-white p-3" key={category.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words text-base font-bold text-[#060b27]">{category.name}</p>
                      <p className="mt-1 break-all font-mono text-xs text-slate-500">{category.slug}</p>
                    </div>
                    <CategoryStatusBadge active={category.active} />
                  </div>
                  <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">
                    {category.children.length ? category.children.map((child) => child.name).join(", ") : "Нет подразделов"}
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button type="button" disabled={index === 0 || Boolean(savingId)} onClick={() => applyOrder(moveItem(categories, category.id, -1))} className="inline-flex h-10 items-center justify-center gap-1 rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold text-slate-700 disabled:opacity-40">
                      <ArrowUp className="h-3.5 w-3.5" />
                      Выше
                    </button>
                    <button type="button" disabled={index === categories.length - 1 || Boolean(savingId)} onClick={() => applyOrder(moveItem(categories, category.id, 1))} className="inline-flex h-10 items-center justify-center gap-1 rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold text-slate-700 disabled:opacity-40">
                      <ArrowDown className="h-3.5 w-3.5" />
                      Ниже
                    </button>
                    <button type="button" disabled={Boolean(savingId)} onClick={() => applyOrder(moveItemToEdge(categories, category.id, "start"))} className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold text-slate-700 disabled:opacity-40">
                      В начало
                    </button>
                    <button type="button" disabled={Boolean(savingId)} onClick={() => applyOrder(moveItemToEdge(categories, category.id, "end"))} className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold text-slate-700 disabled:opacity-40">
                      В конец
                    </button>
                    <button type="button" disabled={Boolean(savingId)} onClick={() => patchCategories({ active: !category.active, id: category.id }, category.active ? "Категория скрыта" : "Категория активна", category.id)} className="col-span-2 inline-flex h-10 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-[#0875d1] disabled:opacity-40">
                      {category.active ? "Скрыть категорию" : "Включить категорию"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : null}

        {error && state !== "error" ? <p className="px-4 py-3 text-sm font-semibold text-red-700">{error}</p> : null}
        {message ? <p className="px-4 py-3 text-sm font-semibold text-[#0a8f32]">{message}</p> : null}
      </section>
    </div>
  );
}
