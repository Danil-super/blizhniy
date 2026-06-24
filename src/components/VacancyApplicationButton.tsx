"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Send } from "lucide-react";
import { LegalLink } from "@/components/LegalConsentCheckbox";
import { useAuthState } from "@/components/auth/useAuthState";
import { getSupabaseBrowserClient, isSupabaseBrowserConfigured } from "@/lib/supabase-browser";
import type { SpecialistProfile } from "@/lib/types";

type VacancyApplicationButtonProps = {
  targetKind?: "vacancy" | "workRequest";
  targetId?: string;
  targetTitle?: string;
  vacancyId?: string;
  vacancyTitle?: string;
};

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  if (!isSupabaseBrowserConfigured()) {
    return {};
  }

  const { data } = await getSupabaseBrowserClient().auth.getSession();
  const token = data.session?.access_token;

  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function VacancyApplicationButton({ targetKind = "vacancy", targetId, targetTitle, vacancyId, vacancyTitle }: VacancyApplicationButtonProps) {
  const { state } = useAuthState();
  const [specialist, setSpecialist] = useState<SpecialistProfile | null>(null);
  const [message, setMessage] = useState("");
  const [acceptedOffer, setAcceptedOffer] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const resolvedTargetId = (targetId ?? vacancyId ?? "").trim();
  const resolvedTargetTitle = targetTitle ?? vacancyTitle ?? "";
  const targetLabel = targetKind === "workRequest" ? "заказ" : "вакансию";
  const ownerLabel = targetKind === "workRequest" ? "Заказчик" : "Работодатель";
  const ownerDativeLabel = targetKind === "workRequest" ? "заказчику" : "работодателю";
  const ownerGenitiveLabel = targetKind === "workRequest" ? "заказчика" : "работодателя";

  useEffect(() => {
    let active = true;

    void getAuthHeaders()
      .then((headers) =>
        Object.keys(headers).length
          ? fetch("/api/cabinet/specialist", {
              cache: "no-store",
              headers,
            })
          : null,
      )
      .then(async (response) => {
        if (!active || !response?.ok) {
          return;
        }

        const payload = (await response.json().catch(() => null)) as { specialist?: SpecialistProfile } | null;
        setSpecialist(payload?.specialist?.status === "published" ? payload.specialist : null);
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  async function createApplication() {
    setStatusMessage("");

    if (!acceptedOffer) {
      setStatusMessage("Примите условия публичной оферты, чтобы отправить отклик.");
      return;
    }

    if (!specialist) {
      setStatusMessage("Сначала создайте и опубликуйте анкету специалиста.");
      return;
    }

    if (!isUuidLike(resolvedTargetId)) {
      setStatusMessage(`Отклик доступен только для опубликованн${targetKind === "workRequest" ? "ого заказа" : "ой вакансии"}.`);
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
        body: JSON.stringify({
          message,
          tariffId: "job-response",
          ...(targetKind === "workRequest" ? { workRequestId: resolvedTargetId } : { vacancyId: resolvedTargetId }),
          snapshot: {
            email: specialist.email,
            messengerUrl: specialist.messengerUrl,
            name: specialist.name,
            phone: specialist.phone,
            price: specialist.price,
            profession: specialist.profession,
            skills: specialist.skills,
          },
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        application?: { paymentId?: string; paymentStatus?: string };
        error?: string;
        payment?: { confirmationUrl?: string; id?: string };
      } | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Не удалось создать отклик.");
      }

      if (payload?.payment?.confirmationUrl) {
        window.location.href = payload.payment.confirmationUrl;
        return;
      }

      if (payload?.application?.paymentId && payload.application.paymentStatus !== "succeeded") {
        window.location.href = `/oplata/${payload.application.paymentId}`;
        return;
      }

      window.location.href = "/cabinet/otkliki";
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Не удалось создать отклик.");
      setSubmitting(false);
    }
  }

  if (state === "loading" || loading) {
    return <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-600">Проверяем возможность отклика...</div>;
  }

  if (state === "signed-out") {
    return (
      <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm leading-6 text-slate-700">
        <p className="font-bold text-[#060b27]">Отклик на {targetLabel}</p>
        <p className="mt-1">Войдите, чтобы отправить {ownerDativeLabel} анкету специалиста.</p>
        <Link href={`/auth?returnTo=${encodeURIComponent(targetKind === "workRequest" ? `/rabota/zakazy/${resolvedTargetId}` : `/vakansiya/${resolvedTargetId}`)}`} className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-lg bg-[#0875d1] px-4 font-bold text-white">
          Войти и откликнуться
        </Link>
      </div>
    );
  }

  if (!specialist) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
        <p className="font-bold text-[#060b27]">Отклик на {targetLabel}</p>
        <p className="mt-1">Для отклика нужна опубликованная анкета специалиста.</p>
        <Link href="/cabinet/specialist" className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-lg bg-[#0875d1] px-4 font-bold text-white">
          Заполнить анкету
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-[#0aa337] shadow-sm">
          <Send className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="font-bold text-[#060b27]">Откликнуться</p>
          <p className="mt-1 text-sm leading-5 text-slate-700">
            {ownerLabel} получит вашу анкету: {specialist.name}. Контакты {ownerGenitiveLabel} не раскрываются до его решения.
          </p>
        </div>
      </div>
      <textarea
        value={message}
        onChange={(event) => setMessage(event.target.value.slice(0, 700))}
        placeholder={`Короткое сообщение на ${targetLabel} «${resolvedTargetTitle}»`}
        className="mt-3 min-h-24 w-full resize-y rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#0875d1]"
        maxLength={700}
      />
      <label className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-2 text-xs font-semibold leading-5 text-slate-700">
        <input type="checkbox" checked={acceptedOffer} onChange={(event) => setAcceptedOffer(event.target.checked)} className="mt-0.5 h-4 w-4 accent-[#0875d1]" />
        <span>
          Принимаю <LegalLink href="/legal/offer">Публичную оферту</LegalLink> перед оплатой отклика.
        </span>
      </label>
      {statusMessage ? <p className="mt-2 rounded-lg bg-white/75 px-3 py-2 text-xs font-bold text-rose-700">{statusMessage}</p> : null}
      <button
        type="button"
        onClick={createApplication}
        disabled={submitting}
        className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#0aa337] px-4 font-bold text-white transition hover:bg-[#078a2e] disabled:cursor-wait disabled:bg-slate-300"
      >
        <Send className="h-4 w-4" />
        {submitting ? "Создаем отклик..." : "Откликнуться и оплатить"}
      </button>
    </div>
  );
}
