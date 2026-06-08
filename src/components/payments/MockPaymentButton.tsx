"use client";

import { useState } from "react";
import { BackLink } from "@/components/BackLink";

type PaymentState = "idle" | "loading" | "success" | "error";

type MockPaymentButtonProps = {
  paymentId?: string;
  tariffId: string;
  returnHref: string;
};

export function MockPaymentButton({ paymentId, tariffId, returnHref }: MockPaymentButtonProps) {
  const [state, setState] = useState<PaymentState>("idle");
  const [message, setMessage] = useState("Заказ сформирован. Нажмите кнопку, чтобы перейти к оплате.");

  async function handlePayment() {
    setState("loading");
    setMessage("Создаем заказ и проводим оплату...");

    try {
      let payableId = paymentId;

      if (!payableId) {
        const createResponse = await fetch("/api/payments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tariffId }),
        });

        if (!createResponse.ok) {
          throw new Error("Не удалось создать платеж");
        }

        const createPayload = await createResponse.json();
        payableId = createPayload.payment?.id;

        if (!payableId) {
          throw new Error("API не вернул payment id");
        }
      }

      const confirmResponse = await fetch(`/api/payments/${payableId}/confirm`, { method: "POST" });

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
        <BackLink fallbackHref={returnHref} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-white font-bold text-[#0aa337]">
          Вернуться в историю
        </BackLink>
      ) : null}
    </div>
  );
}
