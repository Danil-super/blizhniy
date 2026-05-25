"use client";

import Link from "next/link";
import { useState } from "react";

type PaymentState = "idle" | "loading" | "success" | "error";

type MockPaymentButtonProps = {
  tariffId: string;
  returnHref: string;
};

export function MockPaymentButton({ tariffId, returnHref }: MockPaymentButtonProps) {
  const [state, setState] = useState<PaymentState>("idle");
  const [message, setMessage] = useState("Заказ сформирован. Нажмите кнопку, чтобы перейти к оплате.");

  async function handlePayment() {
    setState("loading");
    setMessage("Создаем заказ и проводим оплату...");

    try {
      const createResponse = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tariffId }),
      });

      if (!createResponse.ok) {
        throw new Error("Не удалось создать платеж");
      }

      const createPayload = await createResponse.json();
      const paymentId = createPayload.payment?.id;

      if (!paymentId) {
        throw new Error("API не вернул payment id");
      }

      const confirmResponse = await fetch(`/api/payments/${paymentId}/confirm`, { method: "POST" });

      if (!confirmResponse.ok) {
        throw new Error("Не удалось подтвердить платеж");
      }

      const confirmPayload = await confirmResponse.json();

      setState("success");
      setMessage(confirmPayload.nextStatus === "sent" ? "Оплата прошла. Отклик отправлен работодателю." : "Оплата прошла. Заявка опубликована.");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Оплата не прошла");
    }
  }

  return (
    <div className="mt-6 space-y-4">
      <button
        type="button"
        onClick={handlePayment}
        disabled={state === "loading" || state === "success"}
        className="inline-flex h-12 w-full items-center justify-center rounded-lg bg-[#0aa337] font-bold text-white transition hover:bg-[#078a2e] disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {state === "loading" ? "Проводим оплату..." : state === "success" ? "Оплата прошла" : "Оплатить"}
      </button>
      <p className={state === "error" ? "text-sm font-semibold text-rose-600" : "text-sm leading-6 text-slate-600"}>{message}</p>
      {state === "success" ? (
        <Link href={returnHref} className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-emerald-200 bg-white font-bold text-[#0aa337]">
          Вернуться в историю
        </Link>
      ) : null}
    </div>
  );
}
