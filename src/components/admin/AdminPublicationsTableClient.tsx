"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type MouseEvent } from "react";
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
  cellClassName?: string;
  key: string;
  label: string;
  render?: (row: AdminRow) => React.ReactNode;
  widthClassName?: string;
};

type ApiResponse = {
  error?: string;
  rows?: AdminRow[];
};

type OpenMenu = {
  left: number;
  rowId: string;
  top: number;
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
      { key: "id", label: "ID", cellClassName: "font-mono text-xs text-slate-500", widthClassName: "w-[180px]" },
      { key: "title", label: "Название", widthClassName: "w-[260px]" },
      { key: "category", label: "Категория", widthClassName: "w-[190px]" },
      { key: "city", label: "Город", widthClassName: "w-[150px]" },
      { key: "district", label: "Район/адрес", widthClassName: "w-[230px]" },
      { key: "status", label: "Статус", render: (row) => <StatusBadge status={String(row.status)} />, widthClassName: "w-[150px]" },
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

function primaryAction(row: AdminRow) {
  if (row.status === "published" && row.href) {
    return { href: row.href, label: "Открыть" };
  }

  if (row.editHref) {
    return { href: row.editHref, label: "Редактировать" };
  }

  if (row.href) {
    return { href: row.href, label: "Открыть" };
  }

  return undefined;
}

function editHref(row: AdminRow) {
  if (row.editHref) {
    return row.editHref;
  }
}

export function AdminPublicationsTableClient({ type }: { type: PublicationType }) {
  const columns = useMemo(() => columnsForType(type), [type]);
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [openMenu, setOpenMenu] = useState<OpenMenu | null>(null);

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

  useEffect(() => {
    if (!openMenu) {
      return;
    }

    function closeOnOutsideClick(event: globalThis.MouseEvent) {
      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      if (target.closest("[data-admin-actions-menu]") || target.closest("[data-admin-actions-trigger]")) {
        return;
      }

      setOpenMenu(null);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenMenu(null);
      }
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openMenu]);

  useEffect(() => {
    setOpenMenu(null);
  }, [rows, type]);

  function toggleMenu(rowId: string, event: MouseEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 224;
    const menuHeight = 360;
    const viewportPadding = 12;
    const left = Math.max(viewportPadding, Math.min(window.innerWidth - menuWidth - viewportPadding, rect.right - menuWidth));
    const preferredTop = rect.bottom + 8;
    const top = preferredTop + menuHeight > window.innerHeight
      ? Math.max(viewportPadding, rect.top - menuHeight - 8)
      : Math.max(viewportPadding, preferredTop);

    setOpenMenu((current) => (current?.rowId === rowId ? null : { left, rowId, top }));
  }

  if (state === "loading") {
    return <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm font-semibold text-slate-600 shadow-card">Загружаем публикации...</div>;
  }

  if (state === "error") {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm font-semibold text-red-700 shadow-card">{error}</div>;
  }

  const tableMinWidth = type === "listings" ? "min-w-[1340px]" : type === "vacancies" || type === "workRequests" ? "min-w-[1280px]" : "min-w-[1080px]";
  const openMenuRow = openMenu ? rows.find((row) => row.id === openMenu.rowId) : undefined;
  const mobileColumns = columns.filter((column) => !["id", "images", "status"].includes(column.key));
  const openMenuEditHref = openMenuRow ? editHref(openMenuRow) : undefined;

  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white shadow-card">
      <div className="hidden max-h-[65dvh] min-w-0 max-w-full overflow-auto rounded-xl lg:block">
        <table className={`w-full ${tableMinWidth} table-fixed border-collapse text-left text-sm`}>
          <thead className="bg-slate-50 text-sm text-slate-500">
            <tr>
              {columns.map((column) => (
                <th className={`border-b border-slate-200 px-4 py-3 font-bold sm:px-5 sm:py-4 ${column.widthClassName ?? ""}`} key={column.key}>
                  {column.label}
                </th>
              ))}
              <th className="w-[210px] border-b border-slate-200 px-4 py-3 font-bold sm:px-5 sm:py-4">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length ? (
              rows.map((row) => (
                <tr className="text-slate-700" key={row.id}>
                  {columns.map((column) => (
                    <td className={`px-4 py-3 align-top sm:px-5 sm:py-4 ${column.cellClassName ?? ""}`} key={column.key}>
                      <div className="max-w-full break-words [overflow-wrap:anywhere]">
                        {column.render ? column.render(row) : String(row[column.key] ?? "")}
                      </div>
                    </td>
                  ))}
                  <td className="px-4 py-3 align-top sm:px-5 sm:py-4">
                    <div className="flex max-w-full flex-wrap items-start gap-2">
                      {primaryAction(row) ? (
                        <Link href={primaryAction(row)!.href} className="inline-flex h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700">
                          {primaryAction(row)!.label}
                        </Link>
                      ) : null}
                      <button
                        type="button"
                        data-admin-actions-trigger
                        aria-expanded={openMenu?.rowId === row.id}
                        className="inline-flex h-9 items-center rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-[#0875d1]"
                        onClick={(event) => toggleMenu(row.id, event)}
                      >
                        Изменить
                      </button>
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
      <div className="grid gap-3 p-3 lg:hidden">
        {rows.length ? (
          rows.map((row) => (
            <article className="rounded-lg border border-slate-200 bg-white p-3" key={row.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words text-base font-bold text-[#060b27]">
                    {String(row.title ?? row.name ?? row.organization ?? row.participantName ?? row.id)}
                  </p>
                  <p className="mt-1 break-all font-mono text-xs text-slate-500">{row.id}</p>
                </div>
                <StatusBadge status={String(row.status)} />
              </div>
              <dl className="mt-3 grid gap-2 text-sm">
                {mobileColumns.slice(0, 5).map((column) => (
                  <div className="grid gap-0.5" key={column.key}>
                    <dt className="text-xs font-bold text-slate-500">{column.label}</dt>
                    <dd className="min-w-0 break-words font-semibold text-slate-700">
                      {column.render ? column.render(row) : String(row[column.key] ?? "")}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="mt-3 flex flex-wrap gap-2">
                {primaryAction(row) ? (
                  <Link href={primaryAction(row)!.href} className="inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700">
                    {primaryAction(row)!.label}
                  </Link>
                ) : null}
                <button
                  type="button"
                  data-admin-actions-trigger
                  aria-expanded={openMenu?.rowId === row.id}
                  className="inline-flex h-10 items-center rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-[#0875d1]"
                  onClick={(event) => toggleMenu(row.id, event)}
                >
                  Изменить
                </button>
              </div>
            </article>
          ))
        ) : (
          <p className="px-1 py-5 text-sm font-semibold text-slate-500">Публикаций пока нет.</p>
        )}
      </div>
      {openMenu && openMenuRow ? (
        <div
          data-admin-actions-menu
          className="fixed z-[300] max-h-[calc(100dvh-1.5rem)] w-56 max-w-[calc(100vw-3rem)] overflow-auto rounded-lg border border-slate-200 bg-white p-1 text-left shadow-xl shadow-slate-900/10"
          style={{ left: openMenu.left, top: openMenu.top }}
        >
          {openMenuEditHref ? (
            <Link href={openMenuEditHref} className="block rounded-md px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-blue-50 hover:text-[#0875d1]">
              Редактировать карточку
            </Link>
          ) : null}
          <AdminPublicationStatusForm
            entityType={String(openMenuRow.statusEntityType ?? "")}
            id={String(openMenuRow.statusTargetId ?? openMenuRow.id)}
            onSaved={() => setOpenMenu(null)}
            status={String(openMenuRow.status ?? "published")}
            options={moderationStatusOptions}
          />
        </div>
      ) : null}
    </div>
  );
}
