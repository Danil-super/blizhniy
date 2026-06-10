"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { confirmClientPayment } from "@/lib/client-payment-flow";

type PaymentReturnClientProps = {
  paymentId: string;
};

export function PaymentReturnClient({ paymentId }: PaymentReturnClientProps) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    let active = true;

    void confirmClientPayment(paymentId)
      .then(() => {
        if (!active) {
          return;
        }

        setConfirmed(true);
        window.setTimeout(() => {
          if (active) {
            router.replace("/cabinet/oplata");
          }
        }, 600);
      })
      .catch((reason) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : "Не удалось подтвердить платеж.");
        }
      });

    return () => {
      active = false;
    };
  }, [paymentId, router]);

  return (
    <main className="page-container flex min-h-[70vh] items-center justify-center py-10">
      <section className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 text-center shadow-card">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-[#0875d1]">
          {confirmed ? <CheckCircle2 className="h-6 w-6" /> : <Loader2 className="h-6 w-6 animate-spin" />}
        </div>
        <h1 className="mt-4 text-2xl font-black text-[#060b27]">{confirmed ? "Платеж подтвержден" : "Проверяем платеж"}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {confirmed
            ? "Статус заказа обновлен. Сейчас откроем историю платежей."
            : "Пожалуйста, подождите: обновляем статус заказа и связанной публикации."}
        </p>
        {error ? (
          <>
            <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p>
            <Link href="/cabinet/oplata" className="mt-4 inline-flex h-11 items-center justify-center rounded-lg bg-[#0875d1] px-5 text-sm font-bold text-white">
              Открыть платежи
            </Link>
          </>
        ) : null}
      </section>
    </main>
  );
}
