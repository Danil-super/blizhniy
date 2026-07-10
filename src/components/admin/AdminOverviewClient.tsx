"use client";

import Link from "next/link";
import { AlertTriangle, ClipboardList, Megaphone, ShieldCheck, UsersRound, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { getSupabaseBrowserClient, isSupabaseBrowserConfigured } from "@/lib/supabase-browser";
import type { AdMarqueePlacement } from "@/lib/ad-marquee-store";
import type { Tariff, Payment } from "@/lib/types";
import type { AdminUserRow } from "@/components/admin/AdminUsersClient";

type PublicationType = "fairApplications" | "listings" | "specialists" | "vacancies" | "workRequests";

type AdminPublicationRow = {
  status?: string;
};

type OverviewData = {
  adMarqueePlacements: AdMarqueePlacement[];
  fairApplications: AdminPublicationRow[];
  listings: AdminPublicationRow[];
  payments: Payment[];
  specialists: AdminPublicationRow[];
  tariffs: Tariff[];
  users: AdminUserRow[];
  vacancies: AdminPublicationRow[];
  workRequests: AdminPublicationRow[];
};

type MetricState = {
  detail: string;
  label: string;
  value: string;
};

type ApiPayload<T> = {
  error?: string;
} & T;

const emptyOverview: OverviewData = {
  adMarqueePlacements: [],
  fairApplications: [],
  listings: [],
  payments: [],
  specialists: [],
  tariffs: [],
  users: [],
  vacancies: [],
  workRequests: [],
};

const publicationLabels: Record<PublicationType, string> = {
  fairApplications: "заявки ярмарки",
  listings: "объявления",
  specialists: "специалисты",
  vacancies: "вакансии",
  workRequests: "заказы",
};

async function getAccessToken() {
  if (!isSupabaseBrowserConfigured()) {
    return "";
  }

  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();

  return data.session?.access_token ?? "";
}

async function fetchAdmin<T>(url: string, authToken: string): Promise<T> {
  const response = await fetch(url, {
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
  });
  const payload = (await response.json().catch(() => null)) as ApiPayload<T> | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? "Не удалось загрузить данные");
  }

  return (payload ?? {}) as T;
}

async function safeLoad<T>(label: string, loader: () => Promise<T>) {
  const loaderPromise = loader()
    .then((data) => ({ data, error: "" }))
    .catch((error) => ({
      data: undefined,
      error: error instanceof Error ? `${label}: ${error.message}` : `${label}: не удалось загрузить данные`,
    }));
  const timeoutPromise = new Promise<{ data: undefined; error: string }>((resolve) => {
    window.setTimeout(() => resolve({ data: undefined, error: `${label}: превышено время ожидания базы` }), 8000);
  });

  return Promise.race([loaderPromise, timeoutPromise]);
}

function MetricCard({ detail, icon, label, value }: MetricState & { icon: ReactNode }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold leading-4 text-slate-500">{label}</p>
          <p className="mt-1.5 line-clamp-1 text-xl font-bold leading-tight text-[#060b27]">{value}</p>
          <p className="mt-1 line-clamp-2 text-xs leading-4 text-slate-600">{detail}</p>
        </div>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-[#0875d1]">{icon}</span>
      </div>
    </article>
  );
}

function ActionLink({ children, href }: { children: ReactNode; href: string }) {
  return (
    <Link href={href} className="inline-flex min-h-11 items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-800 transition hover:border-blue-200 hover:text-[#0875d1]">
      <span className="min-w-0 break-words">{children}</span>
      <span className="text-[#0875d1]">Открыть</span>
    </Link>
  );
}

export function AdminOverviewClient() {
  const [overview, setOverview] = useState<OverviewData>(emptyOverview);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    let active = true;

    async function loadOverview() {
      setState("loading");
      setWarnings([]);

      try {
        const authToken = await getAccessToken();
        const publicationLoaders = (Object.keys(publicationLabels) as PublicationType[]).map((type) =>
          safeLoad(publicationLabels[type], () => fetchAdmin<{ rows?: AdminPublicationRow[] }>(`/api/admin/publications?type=${type}`, authToken)),
        );

        const [tariffsResult, usersResult, paymentsResult, adMarqueeResult, ...publicationResults] = await Promise.all([
          safeLoad("тарифы", () => fetchAdmin<{ tariffs?: Tariff[] }>("/api/admin/tariffs", authToken)),
          safeLoad("пользователи", () => fetchAdmin<{ users?: AdminUserRow[] }>("/api/admin/users", authToken)),
          safeLoad("платежи", () => fetchAdmin<{ payments?: Payment[] }>("/api/admin/payments", authToken)),
          safeLoad("бегущая строка", () => fetchAdmin<{ placements?: AdMarqueePlacement[] }>("/api/admin/ad-marquee", authToken)),
          ...publicationLoaders,
        ]);

        if (!active) {
          return;
        }

        const nextOverview: OverviewData = {
          ...emptyOverview,
          adMarqueePlacements: adMarqueeResult.data?.placements ?? [],
          payments: paymentsResult.data?.payments ?? [],
          tariffs: tariffsResult.data?.tariffs ?? [],
          users: usersResult.data?.users ?? [],
        };

        (Object.keys(publicationLabels) as PublicationType[]).forEach((type, index) => {
          nextOverview[type] = publicationResults[index]?.data?.rows ?? [];
        });

        setOverview(nextOverview);
        setWarnings([tariffsResult, usersResult, paymentsResult, adMarqueeResult, ...publicationResults].map((result) => result.error).filter(Boolean));
        setState("ready");
      } catch (error) {
        if (active) {
          setWarnings([error instanceof Error ? error.message : "Не удалось загрузить обзор админки"]);
          setState("error");
        }
      }
    }

    void loadOverview();

    return () => {
      active = false;
    };
  }, []);

  const {
    adMarqueePlacements,
    fairApplications,
    listings,
    payments,
    specialists,
    tariffs,
    users,
    vacancies,
    workRequests,
  } = overview;

  const summary = useMemo(() => {
    const publications = [...listings, ...vacancies, ...specialists, ...workRequests, ...fairApplications];

    return {
      activeTariffs: tariffs.filter((tariff) => tariff.active).length,
      adMarqueeReview: adMarqueePlacements.filter((item) => item.status === "pending_review").length,
      blockedUsers: users.filter((user) => user.status === "blocked").length,
      moderationQueue: publications.filter((item) => ["draft", "pending", "pending_payment", "rejected"].includes(String(item.status))).length,
      publicationsCount: publications.length,
      succeededPayments: payments.filter((payment) => payment.status === "succeeded").length,
    };
  }, [adMarqueePlacements, fairApplications, listings, payments, specialists, tariffs, users, vacancies, workRequests]);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <MetricCard icon={<UsersRound className="h-5 w-5" />} label="Пользователи" value={String(users.length)} detail={state === "loading" ? "Загружаем..." : `${summary.blockedUsers} заблокированных аккаунтов`} />
        <MetricCard icon={<ClipboardList className="h-5 w-5" />} label="Публикации" value={String(summary.publicationsCount)} detail={state === "loading" ? "Загружаем..." : `${summary.moderationQueue} требуют внимания`} />
        <MetricCard icon={<WalletCards className="h-5 w-5" />} label="Тарифы" value={`${summary.activeTariffs}/${tariffs.length}`} detail={state === "loading" ? "Загружаем..." : "Активные тарифы из базы"} />
        <MetricCard icon={<Megaphone className="h-5 w-5" />} label="Бегущая строка" value={String(adMarqueePlacements.length)} detail={state === "loading" ? "Загружаем..." : `${summary.adMarqueeReview} требуют проверки`} />
      </div>

      {warnings.length ? (
        <section className={`mt-4 rounded-lg border p-4 text-sm font-semibold ${state === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="min-w-0">
              <h2 className="font-bold">Часть данных не загрузилась</h2>
              <ul className="mt-2 grid gap-1">
                {warnings.map((warning) => (
                  <li className="break-words" key={warning}>
                    {warning}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      ) : null}

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-[#0aa337]">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-[#060b27]">Очередь модерации</h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">Проверьте черновики, ожидающие оплату и отклоненные публикации перед публичным показом.</p>
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            <ActionLink href="/admin/obyavleniya">Объявления: {listings.length}</ActionLink>
            <ActionLink href="/admin/vakansii">Вакансии: {vacancies.length}</ActionLink>
            <ActionLink href="/admin/zakazy">Заказы: {workRequests.length}</ActionLink>
            <ActionLink href="/admin/specialisty">Специалисты: {specialists.length}</ActionLink>
            <ActionLink href="/admin/fair-applications">Ярмарка: {fairApplications.length}</ActionLink>
            <ActionLink href="/admin/ad-marquee">Бегущая строка: {adMarqueePlacements.length}</ActionLink>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-bold text-[#060b27]">Разделы управления</h2>
          <div className="mt-3 grid gap-2">
            <ActionLink href="/admin/users">Пользователи и роли</ActionLink>
            <ActionLink href="/admin/categories">Категории каталога</ActionLink>
            <ActionLink href="/admin/tariffs">Тарифы</ActionLink>
            <ActionLink href="/admin/payments">Платежи: {payments.length} / {summary.succeededPayments}</ActionLink>
          </div>
        </section>
      </div>
    </>
  );
}
