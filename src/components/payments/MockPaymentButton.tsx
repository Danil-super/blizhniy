"use client";

import { useState } from "react";
import { BackLink } from "@/components/BackLink";
import { LegalLink } from "@/components/LegalConsentCheckbox";
import { confirmClientPayment, createClientPayment } from "@/lib/client-payment-flow";

type PaymentState = "idle" | "loading" | "success" | "error";

type MockPaymentButtonProps = {
  paymentId?: string;
  tariffId: string;
  returnHref: string;
};

export function MockPaymentButton({ paymentId, tariffId, returnHref }: MockPaymentButtonProps) {
  const [state, setState] = useState<PaymentState>("idle");
  const [message, setMessage] = useState("Заказ сформирован. Нажмите кнопку, чтобы перейти к оплате.");
  const [acceptedOffer, setAcceptedOffer] = useState(false);

  async function handlePayment() {
    if (!acceptedOffer) {
      setState("error");
      setMessage("Примите условия публичной оферты, чтобы перейти к оплате");
      return;
    }

    setState("loading");
    setMessage("Создаем заказ и проводим оплату...");

    try {
      let payableId = paymentId;

      if (!payableId) {
        const payment = await createClientPayment({ tariffId });

        if (payment.confirmationUrl) {
          window.location.href = payment.confirmationUrl;
          return;
        }

        payableId = payment.id;
      }

      const confirmPayload = await confirmClientPayment(payableId);

      setState("success");
      setMessage(confirmPayload.nextStatus === "sent" ? "Оплата прошла. Отклик отправлен работодателю." : "Оплата прошла. Заявка опубликована.");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Оплата не прошла");
    }
  }

  return (
    <div className="mt-6 space-y-4">
      <label className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold leading-6 text-slate-700">
        <input
          type="checkbox"
          checked={acceptedOffer}
          onChange={(event) => setAcceptedOffer(event.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 accent-[#0875d1]"
        />
        <span className="min-w-0 [overflow-wrap:anywhere]">
          Я принимаю условия <LegalLink href="/legal/offer">Публичной оферты</LegalLink> и понимаю, что оплачиваю услугу на сайте БЛИЖНИЙ.
        </span>
      </label>
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
