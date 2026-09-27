"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { CheckCircle2, Loader2 } from "lucide-react";
import { confirmClientPayment } from "@/lib/client-payment-flow";
import { readCabinetProfile } from "@/lib/client-user-profile";
import { addSiteNotification, type AddSiteNotificationInput } from "@/lib/site-notifications";
import { getSupabaseBrowserClient, isSupabaseBrowserConfigured } from "@/lib/supabase-browser";

type PaymentReturnClientProps = {
  paymentId: string;
};

type AuthenticatedPaymentSession = {
  accessToken: string;
  email: string;
  name: string;
  userId: string;
};

type SessionReader = () => Promise<{
  data: { session: Session | null };
  error: Error | null;
}>;

const sessionChangedError = "Сессия изменилась. Войдите в аккаунт повторно и проверьте платеж еще раз.";

function toAuthenticatedPaymentSession(session: Session | null | undefined): AuthenticatedPaymentSession | null {
  const userId = session?.user?.id;
  const accessToken = session?.access_token;

  if (!userId || !accessToken) {
    return null;
  }

  const email = session.user.email ?? "";

  return {
    accessToken,
    email,
    name: email ? email.split("@")[0] : "Пользователь",
    userId,
  };
}

async function readAuthenticatedPaymentSession(readSession: SessionReader) {
  const { data, error } = await readSession();

  if (error) {
    throw error;
  }

  return toAuthenticatedPaymentSession(data.session);
}

function isSamePaymentOwner(left: AuthenticatedPaymentSession, right: AuthenticatedPaymentSession | null) {
  return Boolean(right && left.userId === right.userId);
}

async function assertBoundPaymentSession(
  origin: AuthenticatedPaymentSession,
  readSession: SessionReader,
  isOriginCurrent: () => boolean,
) {
  // The request itself keeps origin.accessToken. These checks intentionally
  // compare only the owner, so an ordinary TOKEN_REFRESHED event for A does
  // not interrupt a payment return or turn it into a B-owned operation.
  if (!isOriginCurrent() || !isSamePaymentOwner(origin, await readAuthenticatedPaymentSession(readSession))) {
    throw new Error(sessionChangedError);
  }
}

/**
 * The payment return URL can stay open while a different account signs in.
 * Keep every request and client-side effect tied to the session that opened it.
 */
export async function confirmBoundPaymentReturn<Result>(
  origin: AuthenticatedPaymentSession,
  readSession: SessionReader,
  confirmPayment: (accessToken: string, assertCurrentSession: () => Promise<void>) => Promise<Result>,
  isOriginCurrent: () => boolean,
) {
  const assertCurrentSession = () => assertBoundPaymentSession(origin, readSession, isOriginCurrent);

  await assertCurrentSession();
  const result = await confirmPayment(origin.accessToken, assertCurrentSession);
  await assertCurrentSession();

  return result;
}

/**
 * Do not resolve a "current user" after a payment return: that could turn an
 * A-originated confirmation into a notification for B. The profile and write
 * stay bound to A and are checked again after the profile request.
 */
export async function addBoundPaymentNotification<Profile>(
  origin: AuthenticatedPaymentSession,
  readSession: SessionReader,
  loadProfile: (session: AuthenticatedPaymentSession) => Promise<Profile>,
  writeNotification: (ownerKey: string, profile: Profile, input: AddSiteNotificationInput) => unknown,
  input: AddSiteNotificationInput,
  isOriginCurrent: () => boolean,
) {
  await assertBoundPaymentSession(origin, readSession, isOriginCurrent);
  const profile = await loadProfile(origin);
  await assertBoundPaymentSession(origin, readSession, isOriginCurrent);

  return writeNotification(origin.userId, profile, input);
}

function paymentNotificationInput(
  payload: { payment?: { id?: string; status?: string; targetTitle?: string } },
  paymentId: string,
): AddSiteNotificationInput {
  if (payload.payment?.status === "succeeded") {
    return {
      category: "payment",
      title: "Оплата прошла",
      message: payload.payment.targetTitle
        ? `${payload.payment.targetTitle}: публикация активирована.`
        : "Платеж подтвержден, публикация активирована.",
      tone: "success",
      dedupeKey: `payment:${payload.payment.id ?? paymentId}:succeeded`,
    };
  }

  return {
    category: "payment",
    title: "Платеж ожидает подтверждения",
    message: payload.payment?.targetTitle
      ? `${payload.payment.targetTitle}: банк или ЮKassa еще не прислали финальный статус.`
      : "Платеж создан, ожидаем финальный статус от платежного провайдера.",
    tone: "warning",
    dedupeKey: `payment:${payload.payment?.id ?? paymentId}:pending`,
  };
}

function cabinetHrefForPayment(targetType?: string) {
  if (targetType === "listing") {
    return "/cabinet/obyavleniya";
  }

  if (targetType === "fair_application") {
    return "/cabinet/fair-applications";
  }

  if (targetType === "vacancy") {
    return "/cabinet/vakansii";
  }

  if (targetType === "workRequest") {
    return "/cabinet/zakazy";
  }

  if (targetType === "specialist") {
    return "/cabinet/specialist";
  }

  if (targetType === "application") {
    return "/cabinet/otkliki";
  }

  if (targetType === "ad_marquee") {
    return "/reklama/begushchaya-stroka";
  }

  return "/cabinet";
}

export function PaymentReturnClient({ paymentId }: PaymentReturnClientProps) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [returnHref, setReturnHref] = useState("/cabinet");
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    let active = true;
    let origin: AuthenticatedPaymentSession | null = null;
    let sessionChanged = false;
    let unsubscribe = () => {};

    const applyConfirmation = async (
      payload: Awaited<ReturnType<typeof confirmClientPayment>>,
      assertCurrentSession?: () => Promise<void>,
    ) => {
      await assertCurrentSession?.();

      if (!active) {
        return;
      }

      const nextHref = cabinetHrefForPayment(payload.payment?.targetType);
      setReturnHref(nextHref);

      if (payload.payment?.status !== "succeeded") {
        setError("Платеж еще ожидает подтверждения от ЮKassa. Публикация обновится автоматически после финального статуса.");
        return;
      }

      setConfirmed(true);
      window.setTimeout(() => {
        if (!active) {
          return;
        }

        if (!assertCurrentSession) {
          router.replace(nextHref);
          return;
        }

        void assertCurrentSession()
          .then(() => {
            if (active) {
              router.replace(nextHref);
            }
          })
          .catch(() => {
            // An auth transition already reset the result shown on this page.
          });
      }, 600);
    };

    const reportError = (reason: unknown) => {
      if (active) {
        setError(reason instanceof Error ? reason.message : "Не удалось подтвердить платеж.");
      }
    };

    if (!isSupabaseBrowserConfigured()) {
      void confirmClientPayment(paymentId)
        .then((payload) => applyConfirmation(payload))
        .catch(reportError);

      return () => {
        active = false;
      };
    }

    const supabase = getSupabaseBrowserClient();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!origin || isSamePaymentOwner(origin, toAuthenticatedPaymentSession(nextSession))) {
        return;
      }

      sessionChanged = true;

      if (active) {
        setConfirmed(false);
        setReturnHref("/cabinet");
        setError(sessionChangedError);
      }
    });
    unsubscribe = () => listener.subscription.unsubscribe();

    void (async () => {
      const initialSession = await readAuthenticatedPaymentSession(() => supabase.auth.getSession());

      if (!initialSession) {
        throw new Error("Войдите в аккаунт повторно, чтобы подтвердить платеж.");
      }

      origin = initialSession;
      const isOriginSessionCurrent = () => !sessionChanged;
      const isOriginCurrent = () => active && isOriginSessionCurrent();
      const assertCurrentSession = () => assertBoundPaymentSession(origin!, () => supabase.auth.getSession(), isOriginCurrent);
      const payload = await confirmBoundPaymentReturn(
        origin,
        () => supabase.auth.getSession(),
        (accessToken, assertSession) => confirmClientPayment(paymentId, {
          authorizationToken: accessToken,
          assertCurrentSession: assertSession,
          notify: false,
        }),
        isOriginCurrent,
      );

      await applyConfirmation(payload, assertCurrentSession);

      void addBoundPaymentNotification(
        origin,
        () => supabase.auth.getSession(),
        (session) => readCabinetProfile({
          accessToken: session.accessToken,
          email: session.email,
          name: session.name,
          ownerKey: session.userId,
        }),
        addSiteNotification,
        paymentNotificationInput(payload, paymentId),
        // The component can unmount after its redirect, but a stable A session
        // may still finish this optional write. Fresh session checks inside the
        // helper still prevent it from landing in B's notification list.
        isOriginSessionCurrent,
      ).catch(() => {
        // Notifications are optional. A session switch must leave no trace in the next account.
      });
    })().catch(reportError);

    return () => {
      active = false;
      unsubscribe();
    };
  }, [paymentId, router]);

  return (
    <main className="page-container flex min-h-[70vh] items-center justify-center py-10">
      <section className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 text-center shadow-card">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-[#0875d1]">
          {confirmed ? <CheckCircle2 className="h-6 w-6" /> : <Loader2 className="h-6 w-6 animate-spin" />}
        </div>
        <h1 className="mt-4 text-xl font-bold text-[#060b27]">{confirmed ? "Платеж подтвержден" : "Проверяем платеж"}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {confirmed
            ? "Статус заказа обновлен. Сейчас откроем нужный раздел кабинета."
            : "Пожалуйста, подождите: обновляем статус заказа и связанной публикации."}
        </p>
        {error ? (
          <>
            <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p>
            <Link href={returnHref} className="mt-4 inline-flex h-11 items-center justify-center rounded-lg bg-[#0875d1] px-5 text-sm font-bold text-white">
              Открыть кабинет
            </Link>
          </>
        ) : null}
      </section>
    </main>
  );
}
