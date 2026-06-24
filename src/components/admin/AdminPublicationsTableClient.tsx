"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AdminPublicationStatusForm } from "@/components/AdminPublicationStatusForm";
import { VacancyThumbnail } from "@/components/VacancyMedia";
import { getSupabaseBrowserClient, isSupabaseBrowserConfigured } from "@/lib/supabase-browser";
import type { PublicationStatus } from "@/lib/types";

type PublicationType = "fairApplications" | "listings" | "specialists" | "vacancies" | "workRequests";
type StatusTone = "green" | "blue" | "amber" | "slate" | "red" | "violet";

type AdminRow = Record<string, unknown> & {
  editHref?: string;
  href?: string;
  id: string;
  status?: string;
  statusEntityType?: string;
  statusTargetId?: string;
};

type Column = {
  key: string;
  label: string;
  render?: (row: AdminRow) => React.ReactNode;
};

type ApiResponse = {
  error?: string;
  rows?: AdminRow[];
};

const statusLabels: Record<string, string> = {
  archived: "Архив",
  draft: "Черновик",
  expired: "Истек срок",
  failed: "Ошибка",
  paid: "Оплачен",
  pending: "Ожидает",
  pending_payment: "Ждет оплату",
  published: "Опубликовано",
  rejected: "Отклонено",
  sold: "Продано",
  succeeded: "Успешно",
};

const statusTones: Record<string, StatusTone> = {
  archived: "slate",
  draft: "slate",
  expired: "amber",
  failed: "red",
  paid: "green",
  pending: "amber",
  pending_payment: "amber",
  published: "blue",
  rejected: "red",
  sold: "slate",
  succeeded: "green",
};

const moderationStatusOptions: Array<{ label: string; value: PublicationStatus }> = [
  { label: "Опубликовано", value: "published" },
  { label: "Черновик", value: "draft" },
  { label: "Ждет оплату", value: "pending_payment" },
  { label: "Архив", value: "archived" },
  { label: "Отклонено", value: "rejected" },
  { label: "Истек срок", value: "expired" },
  { label: "Продано", value: "sold" },
];

function StatusBadge({ status }: { status: string }) {
  const tone = statusTones[status] ?? "slate";
  const classes: Record<StatusTone, string> = {
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    blue: "border-blue-200 bg-blue-50 text-[#0875d1]",
    green: "border-emerald-200 bg-emerald-50 text-[#0a8f32]",
    red: "border-red-200 bg-red-50 text-red-700",
    slate: "border-slate-200 bg-slate-50 text-slate-600",
    violet: "border-violet-200 bg-violet-50 text-violet-700",
  };

  return (
    <span className={`inline-flex min-h-7 items-center rounded-full border px-3 text-xs font-bold ${classes[tone]}`}>
      {statusLabels[status] ?? status}
    </span>
  );
}

async function getAccessToken() {
  if (!isSupabaseBrowserConfigured()) {
    return "";
  }

  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();

  return data.session?.access_token ?? "";
}

function columnsForType(type: PublicationType): Column[] {
  if (type === "listings") {
    return [
      { key: "id", label: "ID" },
      { key: "title", label: "Название" },
      { key: "category", label: "Категория" },
      { key: "city", label: "Город" },
      { key: "district", label: "Район/адрес" },
      { key: "status", label: "Статус", render: (row) => <StatusBadge status={String(row.status)} /> },
    ];
  }

  if (type === "vacancies") {
    return [
      { key: "id", label: "ID" },
      { key: "images", label: "Фото", render: (row) => <VacancyThumbnail images={row.images as string[] | undefined} title={String(row.title ?? "Вакансия")} /> },
      { key: "organization", label: "Компания" },
      { key: "title", label: "Вакансия" },
      { key: "city", label: "Город" },
      { key: "address", label: "Точный адрес" },
      { key: "status", label: "Статус", render: (row) => <StatusBadge status={String(row.status)} /> },
    ];
  }

  if (type === "workRequests") {
    return [
      { key: "id", label: "ID" },
      { key: "author", label: "Заказчик" },
      { key: "title", label: "Задача" },
      { key: "profession", label: "Профессия" },
      { key: "city", label: "Город" },
      { key: "budget", label: "Бюджет" },
      { key: "status", label: "Статус", render: (row) => <StatusBadge status={String(row.status)} /> },
    ];
  }

  if (type === "fairApplications") {
    return [
      { key: "id", label: "ID" },
      { key: "participantName", label: "Участник" },
      { key: "category", label: "Категория" },
      { key: "city", label: "Город" },
      { key: "paymentStatus", label: "Оплата", render: (row) => <StatusBadge status={String(row.paymentStatus)} /> },
      { key: "status", label: "Статус", render: (row) => <StatusBadge status={String(row.status)} /> },
    ];
  }

  return [
    { key: "id", label: "ID" },
    { key: "name", label: "Имя" },
    { key: "profession", label: "Профессия" },
    { key: "city", label: "Город" },
    { key: "district", label: "Зона" },
    { key: "status", label: "Статус", render: (row) => <StatusBadge status={String(row.status)} /> },
  ];
}

function actionHref(row: AdminRow) {
  return row.href || row.editHref || "/admin";
}

function editHref(row: AdminRow) {
  if (row.editHref) {
    return row.editHref;
  }

  const href = actionHref(row);
  return href.includes("?") ? `${href}&edit=1` : `${href}?edit=1`;
}

export function AdminPublicationsTableClient({ type }: { type: PublicationType }) {
  const columns = useMemo(() => columnsForType(type), [type]);
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadRows() {
      setState("loading");
      setError("");

      try {
        const token = await getAccessToken();
        const response = await fetch(`/api/admin/publications?type=${type}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        const payload = (await response.json().catch(() => null)) as ApiResponse | null;

        if (!response.ok) {
          throw new Error(payload?.error ?? "Не удалось загрузить публикации");
        }

        if (active) {
          setRows(payload?.rows ?? []);
          setState("ready");
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить публикации");
          setState("error");
        }
      }
    }

    loadRows();

    return () => {
      active = false;
    };
  }, [type]);

  if (state === "loading") {
    return <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm font-semibold text-slate-600 shadow-card">Загружаем публикации...</div>;
  }

  if (state === "error") {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm font-semibold text-red-700 shadow-card">{error}</div>;
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-card">
      <div className="overflow-x-auto overflow-y-visible">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <thead className="bg-slate-50 text-sm text-slate-500">
            <tr>
              {columns.map((column) => (
                <th className="border-b border-slate-200 px-4 py-3 font-bold sm:px-5 sm:py-4" key={column.key}>
                  {column.label}
                </th>
              ))}
              <th className="border-b border-slate-200 px-4 py-3 font-bold sm:px-5 sm:py-4">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length ? (
              rows.map((row) => (
                <tr className="text-sm text-slate-700" key={row.id}>
                  {columns.map((column) => (
                    <td className="px-4 py-3 align-middle sm:px-5 sm:py-4" key={column.key}>
                      {column.render ? column.render(row) : String(row[column.key] ?? "")}
                    </td>
                  ))}
                  <td className="px-4 py-3 sm:px-5 sm:py-4">
                    <div className="flex flex-wrap items-start gap-2">
                      <Link href={actionHref(row)} className="inline-flex h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700">
                        Открыть
                      </Link>
                      <details className="group relative">
                        <summary className="inline-flex h-9 list-none cursor-pointer items-center rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-[#0875d1] marker:content-none">
                          Изменить
                        </summary>
                        <div className="absolute right-0 top-[calc(100%+0.25rem)] z-[200] min-w-56 rounded-lg border border-slate-200 bg-white p-1 shadow-xl shadow-slate-900/10">
                          <Link href={editHref(row)} className="block rounded-md px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-blue-50 hover:text-[#0875d1]">
                            Редактировать карточку
                          </Link>
                          <AdminPublicationStatusForm
                            entityType={String(row.statusEntityType ?? "")}
                            id={String(row.statusTargetId ?? row.id)}
                            status={String(row.status ?? "published")}
                            options={moderationStatusOptions}
                          />
                        </div>
                      </details>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-4 py-8 text-sm font-semibold text-slate-500 sm:px-5" colSpan={columns.length + 1}>
                  Публикаций пока нет.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
