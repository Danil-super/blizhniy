"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Send } from "lucide-react";
import { LegalLink } from "@/components/LegalConsentCheckbox";
import { useAuthState } from "@/components/auth/useAuthState";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { SpecialistProfile } from "@/lib/types";

type VacancyApplicationButtonProps = {
  targetKind?: "vacancy" | "workRequest";
  targetId?: string;
  targetTitle?: string;
  vacancyId?: string;
  vacancyTitle?: string;
};

type AuthenticatedVacancySession = {
  accessToken: string;
  userId: string;
};

type SessionReader = () => Promise<{
  data: { session: Session | null };
  error: Error | null;
}>;

type AccountBoundState<T> = {
  ownerId: string | null;
  value: T;
};

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

const sessionChangedError = "Сессия изменилась. Войдите в аккаунт повторно и попробуйте откликнуться еще раз.";

function toAuthenticatedVacancySession(session: Session | null | undefined): AuthenticatedVacancySession | null {
  const userId = session?.user?.id;
  const accessToken = session?.access_token;

  if (!userId || !accessToken) {
    return null;
  }

  return { accessToken, userId };
}

async function readAuthenticatedVacancySession(readSession: SessionReader) {
  const { data, error } = await readSession();

  if (error) {
    throw error;
  }

  return toAuthenticatedVacancySession(data.session);
}

function isSameVacancyOwner(originUserId: string, session: AuthenticatedVacancySession | null) {
  return session?.userId === originUserId;
}

async function assertBoundVacancySession(originUserId: string, readSession: SessionReader, isOriginCurrent: () => boolean) {
  if (!isOriginCurrent()) {
    throw new Error(sessionChangedError);
  }

  const session = await readAuthenticatedVacancySession(readSession);

  if (!isOriginCurrent() || !session || !isSameVacancyOwner(originUserId, session)) {
    throw new Error(sessionChangedError);
  }

  return session;
}

/**
 * A vacancy detail page can stay mounted while another account signs in.
 * Keep the submit token and response effects attached to the account that
 * opened the specialist form, while allowing an ordinary token refresh.
 */
export async function submitBoundVacancyApplication<Result>(
  originUserId: string,
  readSession: SessionReader,
  sendApplication: (accessToken: string) => Promise<Result>,
  isOriginCurrent: () => boolean,
) {
  const session = await assertBoundVacancySession(originUserId, readSession, isOriginCurrent);
  const result = await sendApplication(session.accessToken);

  await assertBoundVacancySession(originUserId, readSession, isOriginCurrent);

  return result;
}

export function VacancyApplicationButton({ targetKind = "vacancy", targetId, targetTitle, vacancyId, vacancyTitle }: VacancyApplicationButtonProps) {
  const { state, userId } = useAuthState();
  const mountedRef = useRef(true);
  const [specialistState, setSpecialistState] = useState<AccountBoundState<SpecialistProfile | null>>({ ownerId: null, value: null });
  const [messageState, setMessageState] = useState<AccountBoundState<string>>({ ownerId: null, value: "" });
  const [acceptedOfferState, setAcceptedOfferState] = useState<AccountBoundState<boolean>>({ ownerId: null, value: false });
  const [statusMessageState, setStatusMessageState] = useState<AccountBoundState<string>>({ ownerId: null, value: "" });
  const [submittingState, setSubmittingState] = useState<AccountBoundState<boolean>>({ ownerId: null, value: false });
  const [loadingUserId, setLoadingUserId] = useState<string | null>(null);
  const resolvedTargetId = (targetId ?? vacancyId ?? "").trim();
  const resolvedTargetTitle = targetTitle ?? vacancyTitle ?? "";
  const targetLabel = targetKind === "workRequest" ? "заказ" : "вакансию";
  const ownerLabel = targetKind === "workRequest" ? "Заказчик" : "Работодатель";
  const ownerDativeLabel = targetKind === "workRequest" ? "заказчику" : "работодателю";
  const ownerGenitiveLabel = targetKind === "workRequest" ? "заказчика" : "работодателя";
  const isAuthenticated = state === "signed-in" || state === "admin";
  const specialist = specialistState.ownerId === userId ? specialistState.value : null;
  const message = messageState.ownerId === userId ? messageState.value : "";
  const acceptedOffer = acceptedOfferState.ownerId === userId ? acceptedOfferState.value : false;
  const statusMessage = statusMessageState.ownerId === userId ? statusMessageState.value : "";
  const submitting = submittingState.ownerId === userId ? submittingState.value : false;

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    if (!isAuthenticated || !userId) {
      setSpecialistState({ ownerId: null, value: null });
      setLoadingUserId(null);

      return () => {
        active = false;
      };
    }

    setLoadingUserId(userId);

    void (async () => {
      let specialist: SpecialistProfile | null = null;

      try {
        const session = await readAuthenticatedVacancySession(() => getSupabaseBrowserClient().auth.getSession());

        if (!session || !isSameVacancyOwner(userId, session)) {
          return;
        }

        const response = await fetch("/api/cabinet/specialist", {
          cache: "no-store",
          headers: { Authorization: `Bearer ${session.accessToken}` },
        });

        if (response.ok) {
          const payload = (await response.json().catch(() => null)) as { specialist?: SpecialistProfile } | null;
          const currentSession = await readAuthenticatedVacancySession(() => getSupabaseBrowserClient().auth.getSession());

          if (isSameVacancyOwner(userId, currentSession)) {
            specialist = payload?.specialist?.status === "published" ? payload.specialist : null;
          }
        }
      } catch {
        // The button falls back to the profile-completion state below.
      } finally {
        if (active) {
          setSpecialistState({ ownerId: userId, value: specialist });
          setLoadingUserId((currentUserId) => (currentUserId === userId ? null : currentUserId));
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [isAuthenticated, userId]);

  async function createApplication() {
    if (!isAuthenticated || !userId) {
      return;
    }

    const originUserId = userId;
    setStatusMessageState({ ownerId: originUserId, value: "" });

    if (!acceptedOffer) {
      setStatusMessageState({ ownerId: originUserId, value: "Примите условия публичной оферты, чтобы отправить отклик." });
      return;
    }

    if (!specialist) {
      setStatusMessageState({ ownerId: originUserId, value: "Сначала создайте и опубликуйте анкету специалиста." });
      return;
    }

    if (!isUuidLike(resolvedTargetId)) {
      setStatusMessageState({ ownerId: originUserId, value: `Отклик доступен только для опубликованн${targetKind === "workRequest" ? "ого заказа" : "ой вакансии"}.` });
      return;
    }

    setSubmittingState({ ownerId: originUserId, value: true });

    try {
      const { payload, response } = await submitBoundVacancyApplication(
        originUserId,
        () => getSupabaseBrowserClient().auth.getSession(),
        async (accessToken) => {
          const response = await fetch("/api/applications", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
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

          return { payload, response };
        },
        () => mountedRef.current,
      );

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
      if (mountedRef.current) {
        setStatusMessageState({ ownerId: originUserId, value: error instanceof Error ? error.message : "Не удалось создать отклик." });
      }
    } finally {
      if (mountedRef.current) {
        setSubmittingState({ ownerId: originUserId, value: false });
      }
    }
  }

  const waitingForSpecialist = Boolean(isAuthenticated && userId && (loadingUserId === userId || specialistState.ownerId !== userId));

  if (state === "loading" || waitingForSpecialist) {
    return <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-600">Проверяем возможность отклика...</div>;
  }

  if (!isAuthenticated || !userId) {
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
        onChange={(event) => setMessageState({ ownerId: userId, value: event.target.value.slice(0, 700) })}
        placeholder={`Короткое сообщение на ${targetLabel} «${resolvedTargetTitle}»`}
        className="mt-3 min-h-24 w-full resize-y rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#0875d1]"
        maxLength={700}
      />
      <label className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-2 text-xs font-semibold leading-5 text-slate-700">
        <input type="checkbox" checked={acceptedOffer} onChange={(event) => setAcceptedOfferState({ ownerId: userId, value: event.target.checked })} className="mt-0.5 h-4 w-4 accent-[#0875d1]" />
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
