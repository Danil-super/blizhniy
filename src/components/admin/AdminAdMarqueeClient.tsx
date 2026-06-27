"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, Megaphone, XCircle } from "lucide-react";
import { maxActiveAdMarqueePlacements, type AdMarqueePlacement, type AdMarqueePlacementStatus } from "@/lib/ad-marquee-store";
import { getSupabaseBrowserClient, isSupabaseBrowserConfigured } from "@/lib/supabase-browser";

type Payload = {
  error?: string;
  placement?: AdMarqueePlacement;
  placements?: AdMarqueePlacement[];
};

const statusLabels: Record<AdMarqueePlacementStatus, string> = {
  active: "Показывается",
  archived: "Архив",
  expired: "Истек срок",
  paid: "Оплачено, в очереди",
  pending_payment: "Одобрено, ждет оплаты",
  pending_review: "На проверке",
  rejected: "Отклонено",
};

async function token() {
  if (!isSupabaseBrowserConfigured()) {
    return "";
  }

  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? "";
}

function formatDate(value?: string) {
  return value ? new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value)) : "—";
}

export function AdminAdMarqueeClient({ initialPlacements }: { initialPlacements: AdMarqueePlacement[] }) {
  const [placements, setPlacements] = useState(initialPlacements);
  const [message, setMessage] = useState("Готово к модерации бегущей строки.");
  const [savingId, setSavingId] = useState("");
  const [loading, setLoading] = useState(false);

  const stats = useMemo(
    () => ({
      active: placements.filter((item) => item.status === "active").length,
      paid: placements.filter((item) => item.status === "paid").length,
      review: placements.filter((item) => item.status === "pending_review").length,
    }),
    [placements],
  );

  async function load() {
    setLoading(true);

    try {
      const authToken = await token();
      const response = await fetch("/api/admin/ad-marquee", { headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined });
      const payload = (await response.json().catch(() => null)) as Payload | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Не удалось загрузить заявки");
      }

      setPlacements(payload?.placements ?? []);
      setMessage("Данные обновлены.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function update(placement: AdMarqueePlacement, status: "pending_payment" | "rejected" | "archived") {
    const comment = window.prompt(status === "rejected" ? "Причина отклонения" : "Комментарий администратора", placement.adminComment ?? "") ?? "";
    setSavingId(placement.id);
    setMessage("Сохраняем статус...");

    try {
      const authToken = await token();
      const response = await fetch("/api/admin/ad-marquee", {
        method: "PATCH",
        headers: { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), "Content-Type": "application/json" },
        body: JSON.stringify({
          adminComment: comment,
          id: placement.id,
          sortOrder: placement.sortOrder,
          status,
        }),
      });
      const payload = (await response.json().catch(() => null)) as Payload | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Не удалось сохранить статус");
      }

      setPlacements(payload?.placements ?? placements);
      setMessage("Статус сохранен.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка сохранения");
    } finally {
      setSavingId("");
    }
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
          <p className="text-xs font-bold text-slate-500">На проверке</p>
          <p className="mt-1 text-xl font-bold text-[#060b27]">{stats.review}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
          <p className="text-xs font-bold text-slate-500">Активные слоты</p>
          <p className="mt-1 text-xl font-bold text-[#060b27]">{stats.active}/{maxActiveAdMarqueePlacements}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
          <p className="text-xs font-bold text-slate-500">Очередь</p>
          <p className="mt-1 text-xl font-bold text-[#060b27]">{stats.paid}</p>
        </div>
      </div>

      <section className="mt-5 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-lg font-bold text-[#060b27]">
              <Megaphone className="h-5 w-5 text-[#0875d1]" />
              Заявки бегущей строки
            </h2>
            <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">{message}</p>
          </div>
          <button onClick={load} disabled={loading} className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-bold disabled:opacity-60">
            {loading ? "Обновляем..." : "Обновить"}
          </button>
        </div>
        <div className="mt-4 grid gap-3">
          {placements.map((placement) => (
            <article key={placement.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-700">{statusLabels[placement.status]}</span>
                    <span className="text-xs font-semibold text-slate-500">Создано: {formatDate(placement.createdAt)}</span>
                    {placement.endsAt ? <span className="text-xs font-semibold text-slate-500">До: {formatDate(placement.endsAt)}</span> : null}
                  </div>
                  <p className="mt-3 text-base font-bold leading-7 text-[#060b27]">{placement.text}</p>
                  {placement.href ? <p className="mt-1 break-all text-sm font-semibold text-[#0875d1]">{placement.href}</p> : null}
                  <p className="mt-2 text-xs font-semibold text-slate-500">Пользователь: {placement.userId}</p>
                  {placement.adminComment ? <p className="mt-2 rounded-lg bg-white px-3 py-2 text-sm font-semibold leading-6 text-slate-700">{placement.adminComment}</p> : null}
                </div>
                <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex">
                  {placement.status === "pending_review" ? (
                    <>
                      <button
                        onClick={() => void update(placement, "pending_payment")}
                        disabled={savingId === placement.id}
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#0aa337] px-3 text-xs font-bold text-white disabled:opacity-60"
                      >
                        {savingId === placement.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                        Одобрить
                      </button>
                      <button
                        onClick={() => void update(placement, "rejected")}
                        disabled={savingId === placement.id}
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-rose-600 px-3 text-xs font-bold text-white disabled:opacity-60"
                      >
                        <XCircle className="h-4 w-4" />
                        Отклонить
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => void update(placement, "archived")}
                      disabled={savingId === placement.id || placement.status === "archived"}
                      className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 disabled:opacity-60"
                    >
                      В архив
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
          {!placements.length ? (
            <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm font-semibold text-slate-500">
              Заявок для бегущей строки пока нет.
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}
