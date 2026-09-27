"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { CheckCircle2, Clock3, Loader2, Send, WalletCards } from "lucide-react";
import { readCabinetProfile } from "@/lib/client-user-profile";
import { addSiteNotification, type AddSiteNotificationInput } from "@/lib/site-notifications";
import { getSupabaseBrowserClient, isSupabaseBrowserConfigured } from "@/lib/supabase-browser";
import type { AdMarqueePlacement, AdMarqueePlacementStatus } from "@/lib/ad-marquee-store";
import type { Tariff } from "@/lib/types";

type Payload = {
  error?: string;
  placement?: AdMarqueePlacement;
  placements?: AdMarqueePlacement[];
};

type CreatedPayment = {
  confirmationUrl?: string;
  id: string;
};

type AuthenticatedAdMarqueeSession = {
  accessToken: string;
  email: string;
  name: string;
  userId: string;
};

type SessionReader = () => Promise<{
  data: { session: Session | null };
  error: Error | null;
}>;

const sessionChangedError = "Сессия изменилась. Войдите в аккаунт повторно и повторите действие.";

const statusLabels: Record<AdMarqueePlacementStatus, string> = {
  active: "Показывается",
  archived: "В архиве",
  expired: "Завершено",
  paid: "Оплачено, ждет свободное место",
  pending_payment: "Одобрено, ждет оплаты",
  pending_review: "На модерации",
  rejected: "Отклонено",
};

function toAuthenticatedAdMarqueeSession(session: Session | null | undefined): AuthenticatedAdMarqueeSession | null {
  const userId = session?.user?.id;
  const accessToken = session?.access_token;

  if (!userId || !accessToken) {
    return null;
  }

  const email = session.user.email ?? "";
  const displayName = typeof session.user.user_metadata?.display_name === "string" ? session.user.user_metadata.display_name.trim() : "";

  return {
    accessToken,
    email,
    name: displayName || (email ? email.split("@")[0] : "Пользователь"),
    userId,
  };
}

async function readAuthenticatedAdMarqueeSession(readSession: SessionReader) {
  const { data, error } = await readSession();

  if (error) {
    throw error;
  }

  return toAuthenticatedAdMarqueeSession(data.session);
}

function isSameAdMarqueeOwner(left: AuthenticatedAdMarqueeSession, right: AuthenticatedAdMarqueeSession | null) {
  return Boolean(right && left.userId === right.userId);
}

async function assertBoundAdMarqueeSession(
  origin: AuthenticatedAdMarqueeSession,
  readSession: SessionReader,
  isOriginCurrent: () => boolean,
) {
  // The request keeps the token captured for this screen. Compare owners here
  // so a normal refresh of A's token does not become an A → B transition.
  if (!isOriginCurrent() || !isSameAdMarqueeOwner(origin, await readAuthenticatedAdMarqueeSession(readSession))) {
    throw new Error(sessionChangedError);
  }
}

/**
 * This page is public and can outlive an account switch in another tab. Keep
 * each request tied to the owner and access token that started it, and refuse
 * to apply the result if that owner is no longer active.
 */
export async function runBoundAdMarqueeRequest<Result>(
  origin: AuthenticatedAdMarqueeSession,
  readSession: SessionReader,
  sendRequest: (accessToken: string) => Promise<Result>,
  isOriginCurrent: () => boolean,
) {
  await assertBoundAdMarqueeSession(origin, readSession, isOriginCurrent);
  const result = await sendRequest(origin.accessToken);
  await assertBoundAdMarqueeSession(origin, readSession, isOriginCurrent);

  return result;
}

/**
 * Do not resolve a new "current user" after creating a payment. The profile
 * lookup and notification write stay bound to the account that started it.
 */
export async function addBoundAdMarqueePaymentNotification<Profile>(
  origin: AuthenticatedAdMarqueeSession,
  readSession: SessionReader,
  loadProfile: (session: AuthenticatedAdMarqueeSession) => Promise<Profile>,
  writeNotification: (ownerKey: string, profile: Profile, input: AddSiteNotificationInput) => unknown,
  input: AddSiteNotificationInput,
  isOriginCurrent: () => boolean,
) {
  await assertBoundAdMarqueeSession(origin, readSession, isOriginCurrent);
  const profile = await loadProfile(origin);
  await assertBoundAdMarqueeSession(origin, readSession, isOriginCurrent);

  return writeNotification(origin.userId, profile, input);
}

function formatDate(value?: string) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

export function AdMarqueePlacementClient({ tariff }: { tariff?: Tariff }) {
  const [placements, setPlacements] = useState<AdMarqueePlacement[]>([]);
  const [message, setMessage] = useState("Отправьте короткий текст. Оплата станет доступна после одобрения администратора.");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [payingId, setPayingId] = useState("");
  const [text, setText] = useState("");
  const [href, setHref] = useState("");
  const mounted = useRef(false);
  const sessionGeneration = useRef(0);
  const latestLoadRequest = useRef(0);
  const authenticatedSession = useRef<AuthenticatedAdMarqueeSession | null>(null);

  const stats = useMemo(
    () => ({
      active: placements.filter((item) => item.status === "active").length,
      review: placements.filter((item) => item.status === "pending_review").length,
      waitingPayment: placements.filter((item) => item.status === "pending_payment").length,
    }),
    [placements],
  );

  const resetPrivateState = useCallback(() => {
    sessionGeneration.current += 1;
    latestLoadRequest.current += 1;
    authenticatedSession.current = null;
    setPlacements([]);
    setPayingId("");
    setSubmitting(false);
    setText("");
    setHref("");
    setLoading(true);
    setMessage("Проверяем вход...");
  }, []);

  const isOriginCurrent = useCallback((origin: AuthenticatedAdMarqueeSession, generation: number) => (
      mounted.current &&
      generation === sessionGeneration.current &&
      authenticatedSession.current?.userId === origin.userId
  ), []);

  const load = useCallback(async (providedSession?: Session | null) => {
    const requestId = ++latestLoadRequest.current;
    const generation = sessionGeneration.current;
    const isLoadCurrent = () => (
      mounted.current && requestId === latestLoadRequest.current && generation === sessionGeneration.current
    );

    if (!mounted.current) {
      return;
    }

    setLoading(true);

    try {
      if (!isSupabaseBrowserConfigured()) {
        if (isLoadCurrent()) {
          authenticatedSession.current = null;
          setPlacements([]);
          setMessage("Войдите в аккаунт, чтобы управлять размещениями.");
        }
        return;
      }

      const supabase = getSupabaseBrowserClient();
      const origin = providedSession === undefined
        ? await readAuthenticatedAdMarqueeSession(() => supabase.auth.getSession())
        : toAuthenticatedAdMarqueeSession(providedSession);

      if (!isLoadCurrent()) {
        return;
      }

      if (!origin) {
        authenticatedSession.current = null;
        setPlacements([]);
        setMessage("Войдите в аккаунт, чтобы управлять размещениями.");
        return;
      }

      // The Auth event normally gets here first. This guard also covers an
      // out-of-order getSession result from a browser tab switch.
      if (authenticatedSession.current && authenticatedSession.current.userId !== origin.userId) {
        resetPrivateState();
        void load();
        return;
      }

      authenticatedSession.current = origin;
      const { response, payload } = await runBoundAdMarqueeRequest(
        origin,
        () => supabase.auth.getSession(),
        async (accessToken) => {
          const response = await fetch("/api/ad-marquee", {
            cache: "no-store",
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          const payload = (await response.json().catch(() => null)) as Payload | null;

          return { response, payload };
        },
        () => isOriginCurrent(origin, generation),
      );

      if (!isLoadCurrent() || !isOriginCurrent(origin, generation)) {
        return;
      }

      if (!response.ok) {
        throw new Error(payload?.error ?? "Не удалось загрузить заявки");
      }

      setPlacements(payload?.placements ?? []);
      setMessage("Данные обновлены.");
    } catch (error) {
      if (isLoadCurrent()) {
        setPlacements([]);
        setMessage(error instanceof Error ? error.message : "Ошибка загрузки");
      }
    } finally {
      if (isLoadCurrent()) {
        setLoading(false);
      }
    }
  }, [isOriginCurrent, resetPrivateState]);

  useEffect(() => {
    mounted.current = true;

    if (!isSupabaseBrowserConfigured()) {
      void load();

      return () => {
        mounted.current = false;
        sessionGeneration.current += 1;
        latestLoadRequest.current += 1;
      };
    }

    const supabase = getSupabaseBrowserClient();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      const next = toAuthenticatedAdMarqueeSession(nextSession);
      const current = authenticatedSession.current;

      if (current && next && isSameAdMarqueeOwner(current, next)) {
        // Keep the view mounted for a regular token refresh, but use its new
        // token for subsequent requests.
        authenticatedSession.current = next;
        return;
      }

      resetPrivateState();
      window.setTimeout(() => {
        if (mounted.current) {
          void load(nextSession);
        }
      }, 0);
    });

    void load();

    return () => {
      mounted.current = false;
      sessionGeneration.current += 1;
      latestLoadRequest.current += 1;
      authenticatedSession.current = null;
      listener.subscription.unsubscribe();
    };
  }, [load, resetPrivateState]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const origin = authenticatedSession.current;
    const generation = sessionGeneration.current;

    if (!origin || !isOriginCurrent(origin, generation)) {
      setMessage("Войдите в аккаунт повторно, чтобы отправить заявку.");
      return;
    }

    setSubmitting(true);
    setMessage("Отправляем текст на модерацию...");

    try {
      const supabase = getSupabaseBrowserClient();
      const submittedText = text;
      const submittedHref = href;
      const { response, payload } = await runBoundAdMarqueeRequest(
        origin,
        () => supabase.auth.getSession(),
        async (accessToken) => {
          const response = await fetch("/api/ad-marquee", {
            body: JSON.stringify({ href: submittedHref, text: submittedText }),
            cache: "no-store",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            method: "POST",
          });
          const payload = (await response.json().catch(() => null)) as Payload | null;

          return { response, payload };
        },
        () => isOriginCurrent(origin, generation),
      );

      if (!response.ok || !payload?.placement) {
        throw new Error(payload?.error ?? "Не удалось создать заявку");
      }

      if (!isOriginCurrent(origin, generation)) {
        throw new Error(sessionChangedError);
      }

      setText("");
      setHref("");
      setPlacements((current) => [payload.placement as AdMarqueePlacement, ...current]);
      setMessage("Заявка отправлена. После проверки появится кнопка оплаты.");
    } catch (error) {
      if (isOriginCurrent(origin, generation)) {
        setMessage(error instanceof Error ? error.message : "Ошибка отправки");
      }
    } finally {
      if (isOriginCurrent(origin, generation)) {
        setSubmitting(false);
      }
    }
  }

  async function pay(placement: AdMarqueePlacement) {
    if (!tariff) {
      setMessage("Тариф бегущей строки сейчас недоступен.");
      return;
    }

    const origin = authenticatedSession.current;
    const generation = sessionGeneration.current;

    if (!origin || !isOriginCurrent(origin, generation)) {
      setMessage("Войдите в аккаунт повторно, чтобы создать платеж.");
      return;
    }

    setPayingId(placement.id);
    setMessage("Создаем платеж...");

    try {
      const supabase = getSupabaseBrowserClient();
      const targetTitle = `Бегущая строка: ${placement.text}`;
      const payment = await runBoundAdMarqueeRequest(
        origin,
        () => supabase.auth.getSession(),
        async (accessToken) => {
          const response = await fetch("/api/payments", {
            body: JSON.stringify({
              tariffId: tariff.id,
              targetId: placement.id,
              targetTitle,
              targetType: "ad_marquee",
            }),
            cache: "no-store",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            method: "POST",
          });
          const payload = (await response.json().catch(() => null)) as { error?: string; payment?: CreatedPayment } | null;

          if (!response.ok || !payload?.payment?.id) {
            throw new Error(payload?.error ?? "Не удалось создать платеж");
          }

          return payload.payment;
        },
        () => isOriginCurrent(origin, generation),
      );

      await assertBoundAdMarqueeSession(origin, () => supabase.auth.getSession(), () => isOriginCurrent(origin, generation));

      const notification: AddSiteNotificationInput = {
        actionHref: payment.confirmationUrl,
        actionLabel: payment.confirmationUrl ? "Перейти к оплате" : undefined,
        category: "payment",
        dedupeKey: `payment:${payment.id}:created`,
        message: payment.confirmationUrl
          ? "Перейдите к оплате в ЮKassa. После успешной оплаты размещение включится автоматически."
          : "Платеж создан. После подтверждения размещение включится автоматически.",
        title: "Платеж создан",
        tone: "info",
      };
      void addBoundAdMarqueePaymentNotification(
        origin,
        () => supabase.auth.getSession(),
        (session) => readCabinetProfile({
          accessToken: session.accessToken,
          email: session.email,
          name: session.name,
          ownerKey: session.userId,
        }),
        addSiteNotification,
        notification,
        () => isOriginCurrent(origin, generation),
      ).catch(() => {
        // Notifications are optional, but must never fall through to another account.
      });

      await assertBoundAdMarqueeSession(origin, () => supabase.auth.getSession(), () => isOriginCurrent(origin, generation));
      window.location.assign(payment.confirmationUrl || `/oplata/${payment.id}`);
    } catch (error) {
      if (isOriginCurrent(origin, generation)) {
        setMessage(error instanceof Error ? error.message : "Не удалось создать платеж");
        setPayingId("");
      }
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[#0aa337]">Бегущая строка</p>
            <h1 className="mt-2 text-2xl font-bold leading-tight text-[#060b27] sm:text-3xl">Размещение рекламного текста</h1>
          </div>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-[#0875d1]">
            <WalletCards className="h-5 w-5" />
          </span>
        </div>
        <p className="mt-4 text-sm leading-6 text-slate-600">
          Текст попадает в бегущую строку только после модерации и оплаты. Одновременно на сайте показывается до 5 размещений, остальные оплаченные заявки ждут очереди.
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-bold text-slate-500">Цена</p>
            <p className="mt-1 text-lg font-bold text-[#060b27]">{tariff ? `${tariff.price} ₽` : "—"}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-bold text-slate-500">Срок</p>
            <p className="mt-1 text-lg font-bold text-[#060b27]">{tariff?.durationDays ?? 7} дн.</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-bold text-slate-500">Слотов</p>
            <p className="mt-1 text-lg font-bold text-[#060b27]">5</p>
          </div>
        </div>
        <form onSubmit={submit} className="mt-5 grid gap-3">
          <label className="grid gap-1.5 text-sm font-bold text-slate-700">
            Текст строки
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={140}
              minLength={10}
              required
              rows={4}
              className="min-h-28 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold leading-6 text-[#060b27] outline-none focus:border-[#0875d1]"
              placeholder="Например: Ремонт техники с выездом по Краснодару"
            />
            <span className="text-xs font-semibold text-slate-500">{text.trim().length}/140 символов</span>
          </label>
          <label className="grid gap-1.5 text-sm font-bold text-slate-700">
            Ссылка
            <input
              value={href}
              onChange={(event) => setHref(event.target.value)}
              type="url"
              className="h-11 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-[#060b27] outline-none focus:border-[#0875d1]"
              placeholder="https://example.ru"
            />
          </label>
          <button disabled={submitting} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#0aa337] px-5 text-sm font-bold text-white disabled:opacity-60">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Отправить на модерацию
          </button>
        </form>
        <p className="mt-4 rounded-lg bg-blue-50 px-3 py-2 text-sm font-semibold leading-6 text-slate-700">{message}</p>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-bold text-[#060b27]">Мои размещения</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">Проверка, оплата, очередь и сроки показа.</p>
          </div>
          <button onClick={() => void load()} disabled={loading} className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 disabled:opacity-60">
            Обновить
          </button>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-center">
            <p className="text-lg font-bold text-[#0aa337]">{stats.active}</p>
            <p className="text-xs font-bold text-slate-600">Активно</p>
          </div>
          <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-center">
            <p className="text-lg font-bold text-[#0875d1]">{stats.waitingPayment}</p>
            <p className="text-xs font-bold text-slate-600">К оплате</p>
          </div>
          <div className="rounded-lg border border-amber-100 bg-amber-50 p-3 text-center">
            <p className="text-lg font-bold text-amber-700">{stats.review}</p>
            <p className="text-xs font-bold text-slate-600">Проверка</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3">
          {loading ? (
            <div className="flex min-h-32 items-center justify-center rounded-lg border border-slate-200 text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : placements.length ? (
            placements.map((placement) => (
              <article key={placement.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 text-sm font-bold leading-6 text-[#060b27]">{placement.text}</p>
                  <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-700">{statusLabels[placement.status]}</span>
                </div>
                <div className="mt-3 grid gap-1 text-xs font-semibold text-slate-600 sm:grid-cols-2">
                  <span>Создано: {formatDate(placement.createdAt)}</span>
                  {placement.endsAt ? <span>До: {formatDate(placement.endsAt)}</span> : <span>Оплата после одобрения</span>}
                </div>
                {placement.adminComment ? <p className="mt-3 rounded-lg bg-white px-3 py-2 text-sm font-semibold leading-6 text-slate-700">{placement.adminComment}</p> : null}
                {placement.status === "pending_payment" ? (
                  <button
                    onClick={() => void pay(placement)}
                    disabled={payingId === placement.id}
                    className="mt-3 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#0875d1] px-4 text-sm font-bold text-white disabled:opacity-60"
                  >
                    {payingId === placement.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Оплатить размещение
                  </button>
                ) : null}
              </article>
            ))
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm font-semibold leading-6 text-slate-500">
              <Clock3 className="mx-auto mb-2 h-5 w-5" />
              У вас пока нет заявок для бегущей строки.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
