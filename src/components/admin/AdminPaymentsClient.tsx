"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, CreditCard, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient, isSupabaseBrowserConfigured } from "@/lib/supabase-browser";
import type { Payment } from "@/lib/types";

const visiblePaymentsLimit = 500;

const paymentStatusLabels: Record<Payment["status"], string> = {
  created: "Создан",
  failed: "Ошибка",
  pending: "Ожидает",
  succeeded: "Оплачен",
};

const paymentTargetLabels: Record<Payment["targetType"], string> = {
  ad_marquee: "Реклама",
  application: "Отклик",
  fair_application: "Ярмарка",
  listing: "Объявление",
  specialist: "Анкета",
  vacancy: "Вакансия",
  workRequest: "Заказ",
};

type PaymentsPayload = {
  error?: string;
  payments?: Payment[];
};

function money(value: number) {
  return `${new Intl.NumberFormat("ru-RU").format(value)} ₽`;
}

function formatDate(value?: string) {
  if (!value) {
    return "Не указано";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function shortId(value?: string) {
  if (!value) {
    return "—";
  }

  return value.length <= 14 ? value : `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function statusClassName(status: Payment["status"]) {
  if (status === "succeeded") {
    return "border-emerald-200 bg-emerald-50 text-[#0a8f32]";
  }

  if (status === "failed") {
    return "border-red-200 bg-red-50 text-red-700";
  }

  return "border-amber-200 bg-amber-50 text-amber-700";
}

function PaymentStatusBadge({ status }: { status: Payment["status"] }) {
  return (
    <span className={`inline-flex min-h-7 w-fit items-center rounded-full border px-3 text-xs font-bold ${statusClassName(status)}`}>
      {paymentStatusLabels[status]}
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

function PaymentsTable({ payments }: { payments: Payment[] }) {
  return (
    <div data-testid="payments-table-scroll" className="max-h-[65dvh] min-w-0 max-w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm sm:max-h-[560px]">
      <table data-testid="payments-table" className="w-full min-w-[1180px] table-fixed text-left text-sm">
        <colgroup>
          <col className="w-[170px]" />
          <col className="w-[125px]" />
          <col />
          <col className="w-[115px]" />
          <col className="w-[120px]" />
          <col className="w-[135px]" />
          <col className="w-[150px]" />
          <col className="w-[120px]" />
        </colgroup>
        <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-bold uppercase tracking-normal text-slate-500 shadow-[0_1px_0_rgba(226,232,240,1)]">
          <tr>
            <th className="px-4 py-3">ID платежа</th>
            <th className="px-4 py-3">Тип</th>
            <th className="px-4 py-3">Назначение</th>
            <th className="px-4 py-3">Сумма</th>
            <th className="px-4 py-3">Провайдер</th>
            <th className="px-4 py-3">Статус</th>
            <th className="px-4 py-3">Дата</th>
            <th className="px-4 py-3">Действие</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {payments.map((payment) => (
            <tr key={payment.id} className="align-top transition hover:bg-blue-50/40">
              <td className="px-4 py-4">
                <span className="block truncate font-mono text-xs font-semibold text-slate-600" title={payment.id}>
                  {shortId(payment.id)}
                </span>
              </td>
              <td className="px-4 py-4 text-xs font-bold text-slate-700">{paymentTargetLabels[payment.targetType]}</td>
              <td className="px-4 py-4">
                <p className="line-clamp-2 font-bold text-[#060b27] [overflow-wrap:anywhere]">{payment.targetTitle}</p>
                {payment.targetId ? (
                  <p className="mt-1 truncate font-mono text-[11px] font-semibold text-slate-400" title={payment.targetId}>
                    {shortId(payment.targetId)}
                  </p>
                ) : null}
              </td>
              <td className="px-4 py-4 font-bold text-[#060b27]">{money(payment.amount)}</td>
              <td className="px-4 py-4 text-xs font-bold text-slate-600">{payment.provider === "yookassa" ? "ЮKassa" : "Оплата"}</td>
              <td className="px-4 py-4">
                <PaymentStatusBadge status={payment.status} />
              </td>
              <td className="px-4 py-4 text-xs font-semibold leading-5 text-slate-600">
                <div>{formatDate(payment.createdAt)}</div>
                {payment.paidAt ? <div className="text-slate-400">Оплачен: {formatDate(payment.paidAt)}</div> : null}
              </td>
              <td className="px-4 py-4">
                <Link href={`/oplata/${payment.id}`} className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-800 transition hover:border-blue-200 hover:text-[#0875d1]">
                  Открыть
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RefundProcessInfo() {
  return (
    <section className="grid gap-3 rounded-lg border border-blue-100 bg-blue-50/50 p-3 sm:p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-[#0875d1] ring-1 ring-blue-100">
          <RotateCcw className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-[#060b27]">Как должны работать возвраты</h2>
          <p className="mt-1 text-sm leading-6 text-slate-700">
            Возврат не должен быть просто кнопкой в тарифах. Это финансовая операция с основанием, суммой, статусом у провайдера и решением по публикации.
          </p>
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex items-center gap-2 font-bold text-[#060b27]">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            Основание
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-600">Админ фиксирует причину: дубль оплаты, техническая ошибка, отказ до публикации или спорный случай.</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex items-center gap-2 font-bold text-[#060b27]">
            <CreditCard className="h-4 w-4 text-[#0875d1]" />
            Провайдер
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-600">Для ЮKassa возврат должен создаваться через API возвратов ЮKassa по `providerPaymentId`, а не локально в интерфейсе.</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex items-center gap-2 font-bold text-[#060b27]">
            <CheckCircle2 className="h-4 w-4 text-[#0aa337]" />
            Последствия
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-600">После успешного возврата платеж помечается возвращенным, а публикация снимается или остается по решению администратора.</p>
        </div>
      </div>
    </section>
  );
}

export function AdminPaymentsClient() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadPayments() {
      setState("loading");
      setError("");

      try {
        const token = await getAccessToken();
        const response = await fetch("/api/admin/payments", {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        const payload = (await response.json().catch(() => null)) as PaymentsPayload | null;

        if (!response.ok) {
          throw new Error(payload?.error ?? "Не удалось загрузить платежи");
        }

        if (active) {
          setPayments(payload?.payments ?? []);
          setState("ready");
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить платежи");
          setState("error");
        }
      }
    }

    loadPayments();

    return () => {
      active = false;
    };
  }, []);

  const visiblePayments = payments.slice(0, visiblePaymentsLimit);
  const { pendingCount, totalSucceeded } = useMemo(
    () => ({
      pendingCount: payments.filter((payment) => payment.status === "created" || payment.status === "pending").length,
      totalSucceeded: payments.filter((payment) => payment.status === "succeeded").reduce((sum, payment) => sum + payment.amount, 0),
    }),
    [payments],
  );

  if (state === "loading") {
    return <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm font-semibold text-slate-600 shadow-sm">Загружаем платежи...</div>;
  }

  if (state === "error") {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm font-semibold text-red-700 shadow-sm">{error}</div>;
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
          <p className="text-[11px] font-bold text-slate-500 sm:text-xs">Оплачено</p>
          <p className="mt-1 text-xl font-bold text-[#060b27]">{money(totalSucceeded)}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
          <p className="text-[11px] font-bold text-slate-500 sm:text-xs">Ожидают</p>
          <p className="mt-1 text-xl font-bold text-[#060b27]">{pendingCount}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
          <p className="text-[11px] font-bold text-slate-500 sm:text-xs">Всего</p>
          <p className="mt-1 text-xl font-bold text-[#060b27]">{payments.length}</p>
        </div>
      </div>

      <div className="mt-5">
        <RefundProcessInfo />
      </div>

      <section className="mt-5">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-[#060b27]">Финансовый журнал</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Показаны последние {Math.min(payments.length, visiblePaymentsLimit)} из {payments.length}. Финансовые записи не удаляем автоматически из базы; для очистки интерфейса ограничиваем выдачу, а старые платежи нужно архивировать отдельной задачей.
            </p>
          </div>
        </div>
        <div className="grid gap-3">
          {payments.length ? (
            <>
              <PaymentsTable payments={visiblePayments} />
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold leading-6 text-amber-800">
                Автоочистку лучше делать как архивирование, а не удаление: например, переносить платежи старше 3-5 лет в архивную таблицу/экспорт, оставляя возвраты и спорные операции в основной базе до закрытия вопроса.
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm font-semibold text-slate-500 shadow-sm">
              Платежей пока нет или база временно недоступна.
            </div>
          )}
        </div>
      </section>
    </>
  );
}
