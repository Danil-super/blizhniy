import type { PublicationStatus } from "@/lib/types";

const statusLabels: Record<PublicationStatus | "created" | "pending" | "succeeded" | "failed" | "sent", string> = {
  draft: "Черновик",
  pending_payment: "Ожидает оплату",
  paid: "Оплачено",
  published: "Опубликовано",
  archived: "Архив",
  expired: "Истек срок",
  rejected: "Отклонено",
  created: "Создан",
  pending: "В ожидании",
  succeeded: "Успешно",
  failed: "Ошибка",
  sent: "Отправлен",
};

export function StatusBadge({ status }: { status: keyof typeof statusLabels }) {
  const tone =
    status === "published" || status === "succeeded" || status === "sent"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : status === "pending_payment" || status === "created" || status === "pending"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-slate-200 bg-slate-50 text-slate-600";

  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold ${tone}`}>{statusLabels[status]}</span>;
}
