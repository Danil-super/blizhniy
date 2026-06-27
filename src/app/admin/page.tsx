import Link from "next/link";
import { AlertTriangle, Banknote, ClipboardList, ShieldCheck, UsersRound, WalletCards } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { listStoredFairApplicationsForAdmin } from "@/lib/fair-application-store";
import { listStoredListingsForAdmin } from "@/lib/listing-store";
import { listStoredPayments } from "@/lib/payment-store";
import { listStoredSpecialistProfilesForAdmin } from "@/lib/specialist-profile-store";
import { getStoredTariffs } from "@/lib/tariff-store";
import { listAdminUsers } from "@/lib/user-store";
import { listStoredVacanciesForAdmin } from "@/lib/vacancy-store";
import { listStoredWorkRequestsForAdmin } from "@/lib/work-request-store";

export const dynamic = "force-dynamic";

type MetricState = {
  detail: string;
  label: string;
  value: string;
};

async function safeLoad<T>(label: string, loader: () => Promise<T>) {
  const loaderPromise = loader()
    .then((data) => ({ data, error: "" }))
    .catch((error) => {
      console.error(`Failed to load admin overview ${label}`, error);
      return {
        data: undefined,
        error: error instanceof Error ? `${label}: ${error.message}` : `${label}: не удалось загрузить данные`,
      };
    });
  const timeoutPromise = new Promise<{ data: undefined; error: string }>((resolve) => {
    setTimeout(() => resolve({ data: undefined, error: `${label}: превышено время ожидания базы` }), 8000);
  });

  return Promise.race([loaderPromise, timeoutPromise]);
}

function MetricCard({ detail, icon, label, value }: MetricState & { icon: React.ReactNode }) {
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

function ActionLink({ children, href }: { children: React.ReactNode; href: string }) {
  return (
    <Link href={href} className="inline-flex min-h-11 items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-800 transition hover:border-blue-200 hover:text-[#0875d1]">
      <span className="min-w-0 break-words">{children}</span>
      <span className="text-[#0875d1]">Открыть</span>
    </Link>
  );
}

export default async function Page() {
  const [tariffsResult, listingsResult, vacanciesResult, specialistsResult, workRequestsResult, fairApplicationsResult, paymentsResult, usersResult] = await Promise.all([
    safeLoad("тарифы", getStoredTariffs),
    safeLoad("объявления", listStoredListingsForAdmin),
    safeLoad("вакансии", listStoredVacanciesForAdmin),
    safeLoad("специалисты", listStoredSpecialistProfilesForAdmin),
    safeLoad("заказы", listStoredWorkRequestsForAdmin),
    safeLoad("заявки ярмарки", listStoredFairApplicationsForAdmin),
    safeLoad("платежи", listStoredPayments),
    safeLoad("пользователи", listAdminUsers),
  ]);

  const tariffs = tariffsResult.data ?? [];
  const listings = listingsResult.data ?? [];
  const vacancies = vacanciesResult.data ?? [];
  const specialists = specialistsResult.data ?? [];
  const workRequests = workRequestsResult.data ?? [];
  const fairApplications = fairApplicationsResult.data ?? [];
  const payments = paymentsResult.data ?? [];
  const users = usersResult.data ?? [];
  const warnings = [tariffsResult, listingsResult, vacanciesResult, specialistsResult, workRequestsResult, fairApplicationsResult, paymentsResult, usersResult]
    .map((result) => result.error)
    .filter(Boolean);

  const publications = [...listings, ...vacancies, ...specialists, ...workRequests, ...fairApplications];
  const moderationQueue = publications.filter((item) => ["draft", "pending", "pending_payment", "rejected"].includes(String(item.status))).length;
  const activeTariffs = tariffs.filter((tariff) => tariff.active).length;
  const succeededPayments = payments.filter((payment) => payment.status === "succeeded").length;
  const blockedUsers = users.filter((user) => user.status === "blocked").length;

  return (
    <AdminShell activeHref="/admin" title="Админка" description="Рабочий обзор реальных данных: пользователи, публикации, тарифы, платежи и очередь модерации.">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <MetricCard icon={<UsersRound className="h-5 w-5" />} label="Пользователи" value={String(users.length)} detail={`${blockedUsers} заблокированных аккаунтов`} />
        <MetricCard icon={<ClipboardList className="h-5 w-5" />} label="Публикации" value={String(publications.length)} detail={`${moderationQueue} требуют внимания`} />
        <MetricCard icon={<WalletCards className="h-5 w-5" />} label="Тарифы" value={`${activeTariffs}/${tariffs.length}`} detail="Активные тарифы из базы" />
        <MetricCard icon={<Banknote className="h-5 w-5" />} label="Платежи" value={String(payments.length)} detail={`${succeededPayments} успешных оплат`} />
      </div>

      {warnings.length ? (
        <section className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
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
            <ActionLink href="/admin/payments">Платежи: {payments.length}</ActionLink>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-bold text-[#060b27]">Разделы управления</h2>
          <div className="mt-3 grid gap-2">
            <ActionLink href="/admin/users">Пользователи и роли</ActionLink>
            <ActionLink href="/admin/categories">Категории каталога</ActionLink>
            <ActionLink href="/admin/tariffs">Тарифы</ActionLink>
            <ActionLink href="/admin/payments">Финансы</ActionLink>
          </div>
        </section>
      </div>
    </AdminShell>
  );
}
