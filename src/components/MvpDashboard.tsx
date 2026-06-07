import type React from "react";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  BriefcaseBusiness,
  CheckCircle2,
  CircleUserRound,
  ClipboardList,
  CreditCard,
  FileText,
  Gauge,
  Megaphone,
  MessageSquare,
  Plus,
  Settings2,
  ShieldCheck,
  Store,
  Tags,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { AdminAuthGate } from "@/components/auth/AdminAuthGate";
import { AdMarqueeAdminPanel } from "@/components/AdMarqueeAdminPanel";
import { AuthForm } from "@/components/auth/AuthForm";
import { CabinetAuthGate } from "@/components/auth/CabinetAuthGate";
import { LogoutButton } from "@/components/auth/LogoutButton";
import {
  CabinetCapabilities,
  CabinetContactsHint,
  CabinetOrganizationClient,
  CabinetOverviewClient,
  CabinetPaymentsHistoryClient,
  CabinetProfileBar,
  CabinetPublicationsClient,
  CabinetResponsesClient,
  CabinetSpecialistClient,
} from "@/components/cabinet/CabinetClient";
import { CategoryOrderAdminPanel } from "@/components/CategoryOrderAdminPanel";
import { MockPaymentButton } from "@/components/payments/MockPaymentButton";
import { SiteHeader } from "@/components/SiteHeader";
import type { DemoPublication } from "@/lib/demo-publications";
import { categories, professions } from "@/lib/data";
import { getPayment } from "@/lib/payment-provider";
import { getCurrentUserSpecialist, listFairApplications, listListings, listMockPayments, listSpecialists, listVacancies } from "@/lib/mock-store";
import type { SpecialistProfile } from "@/lib/types";
import { getTariffById, getTariffs, resetTariffPatches, updateTariffPatch } from "@/lib/tariff-store";

type StatusTone = "green" | "blue" | "amber" | "slate" | "red" | "violet";

type TableColumn<T> = {
  key: keyof T | string;
  label: string;
  render?: (row: T) => React.ReactNode;
};

const adminUsers = [
  { id: "U-1001", name: "Анна Петрова", role: "user", phone: "+7 861 000-11-01", status: "active" },
  { id: "U-1002", name: "Сергей Орлов", role: "organization", phone: "+7 861 000-11-02", status: "active" },
  { id: "U-1003", name: "Модератор", role: "admin", phone: "+7 861 000-11-03", status: "blocked" },
];

const statusLabels: Record<string, string> = {
  active: "Активен",
  archive: "Архив",
  blocked: "Заблокирован",
  created: "Создан",
  draft: "Черновик",
  failed: "Ошибка",
  paid: "Оплачен",
  pending_payment: "Ждет оплату",
  pending: "Ожидает",
  published: "Опубликовано",
  sent: "Отправлен",
  succeeded: "Успешно",
  viewed: "Просмотрен",
};

const statusTones: Record<string, StatusTone> = {
  active: "green",
  archive: "slate",
  blocked: "red",
  created: "amber",
  draft: "slate",
  failed: "red",
  paid: "green",
  pending: "amber",
  pending_payment: "amber",
  published: "blue",
  sent: "blue",
  succeeded: "green",
  viewed: "violet",
};

function specialistToDemoPublication(specialist: SpecialistProfile): DemoPublication {
  return {
    id: specialist.id,
    type: "specialist",
    title: specialist.name,
    subtitle: specialist.profession,
    city: specialist.city,
    price: specialist.price,
    description: specialist.description,
    images: specialist.images,
    lat: specialist.lat,
    lng: specialist.lng,
    address: specialist.address,
    hasMapPoint: specialist.hasMapPoint,
    showExactAddress: specialist.showExactAddress,
    phone: specialist.phone,
    messengerUrl: specialist.messengerUrl,
    status: "Опубликовано",
    createdAt: new Date().toISOString(),
  };
}

const cabinetNav = [
  { href: "/cabinet", label: "Обзор", icon: Gauge },
  { href: "/cabinet/obyavleniya", label: "Объявления", icon: FileText },
  { href: "/cabinet/vakansii", label: "Вакансии", icon: BriefcaseBusiness },
  { href: "/cabinet/zakazy", label: "Заказы", icon: ClipboardList },
  { href: "/cabinet/organization", label: "Организация", icon: BadgeCheck },
  { href: "/cabinet/specialist", label: "Анкета", icon: CircleUserRound },
  { href: "/cabinet/otkliki", label: "Отклики", icon: MessageSquare },
  { href: "/cabinet/fair-applications", label: "Ярмарка", icon: Store },
  { href: "/cabinet/oplata", label: "Оплата", icon: CreditCard },
];

const adminNav = [
  { href: "/admin", label: "Обзор", icon: Gauge },
  { href: "/admin/users", label: "Пользователи", icon: UsersRound },
  { href: "/admin/obyavleniya", label: "Объявления", icon: FileText },
  { href: "/admin/vakansii", label: "Вакансии", icon: BriefcaseBusiness },
  { href: "/admin/specialisty", label: "Специалисты", icon: CircleUserRound },
  { href: "/admin/categories", label: "Категории", icon: Tags },
  { href: "/admin/specialist-classifier", label: "Классификатор", icon: Settings2 },
  { href: "/admin/tariffs", label: "Тарифы", icon: WalletCards },
  { href: "/admin/payments", label: "Цены", icon: Banknote },
  { href: "/admin#ad-marquee", label: "Реклама", icon: Megaphone },
  { href: "/admin/fair-applications", label: "Ярмарка", icon: Store },
];

async function updateTariffAction(formData: FormData) {
  "use server";

  const id = String(formData.get("id") ?? "");
  const price = Number(formData.get("price"));
  const durationRaw = String(formData.get("durationDays") ?? "").trim();
  const active = formData.get("active") === "1";

  if (!id || !getTariffById(id) || Number.isNaN(price) || price < 0) {
    return;
  }

  let durationDays: number | null = null;

  if (durationRaw !== "") {
    const parsedDuration = Number(durationRaw);

    if (Number.isNaN(parsedDuration) || parsedDuration < 0) {
      return;
    }

    durationDays = parsedDuration;
  }

  updateTariffPatch(id, { price, durationDays, active });
  revalidatePath("/admin/payments");
  revalidatePath("/cabinet/oplata");
  revalidatePath("/tarify");
}

async function resetTariffsAction() {
  "use server";

  resetTariffPatches();
  revalidatePath("/admin/payments");
  revalidatePath("/cabinet/oplata");
  revalidatePath("/tarify");
}

function listingRows() {
  return listListings().map((listing, index) => ({
    id: listing.id,
    href: `/blizhniy/obyavlenie/${listing.slug}`,
    editHref: `/blizhniy/obyavlenie/${listing.slug}/redaktirovat`,
    title: listing.title,
    category: categories.find((category) => category.slug === listing.categorySlug)?.name ?? listing.subcategory,
    city: listing.city,
    district: listing.district ?? listing.address ?? "",
    status: listing.status,
    views: index === 0 ? 124 : index === 1 ? 18 : 0,
  }));
}

function paymentRows() {
  return listMockPayments().map((payment) => ({
    id: payment.id,
    href: `/blizhniy/oplata/${payment.id}`,
    editHref: "/cabinet/oplata",
    subject: payment.targetTitle,
    amount: `${payment.amount} ₽`,
    method: payment.provider === "mock" ? "Тестовая оплата" : payment.provider,
    status: payment.status,
  }));
}

function adminPaymentRows() {
  return paymentRows().map((payment, index) => ({
    ...payment,
    user: index === 0 ? "Текущий пользователь" : index === 1 ? "Сергей Орлов" : "Анна Петрова",
  }));
}

function StatusBadge({ status }: { status: string }) {
  const tone = statusTones[status] ?? "slate";
  const classes: Record<StatusTone, string> = {
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    blue: "border-blue-200 bg-blue-50 text-[#0875d1]",
    green: "border-emerald-200 bg-emerald-50 text-[#0a8f32]",
    red: "border-red-200 bg-red-50 text-red-700",
    slate: "border-slate-200 bg-slate-50 text-slate-600",
    violet: "border-violet-200 bg-violet-50 text-violet-700",
  };

  return (
    <span className={`inline-flex min-h-7 items-center rounded-full border px-3 text-xs font-bold ${classes[tone]}`}>
      {statusLabels[status] ?? status}
    </span>
  );
}

function ActionLink({ href, children, tone = "blue" }: { href: string; children: React.ReactNode; tone?: "blue" | "green" | "plain" }) {
  const classes = {
    blue: "bg-[#0875d1] text-white hover:bg-[#0765b2]",
    green: "bg-[#0aa337] text-white hover:bg-[#078a2e]",
    plain: "border border-slate-300 bg-white text-slate-800 hover:border-blue-200 hover:text-[#0875d1]",
  };

  return (
    <Link href={href} className={`inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg px-5 text-sm font-bold transition sm:w-auto ${classes[tone]}`}>
      {children}
    </Link>
  );
}

function Shell({
  title,
  description,
  eyebrow,
  nav,
  createHref = "/blizhniy/sozdat",
  children,
}: {
  title: string;
  description: string;
  eyebrow: string;
  nav?: typeof cabinetNav;
  createHref?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      <main className={`page-container dashboard-shell pt-6 sm:pt-10 ${nav === cabinetNav ? "pb-16 sm:pb-20" : "pb-6 sm:pb-10"}`}>
        <p className="text-xs font-bold uppercase tracking-wide text-[#0aa337] sm:text-sm">{eyebrow}</p>
        <div className="mt-2 flex flex-col gap-4 sm:mt-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-black leading-tight text-[#060b27] sm:text-5xl">{title}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 sm:mt-3 sm:text-lg sm:leading-7">{description}</p>
          </div>
          <div className={nav ? "grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-3" : "grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:gap-3"}>
            <ActionLink href={createHref} tone="green">
              <Plus className="h-4 w-4" />
              Создать
            </ActionLink>
            {nav ? <LogoutButton /> : null}
          </div>
        </div>
        {nav ? <NavPills items={nav} /> : null}
        {nav === cabinetNav ? <CabinetProfileBar /> : null}
        <div className="mt-5 sm:mt-7">{children}</div>
      </main>
    </>
  );
}

function NavPills({ items }: { items: typeof cabinetNav }) {
  return (
    <nav className="mt-5 grid grid-flow-col grid-rows-2 gap-2 overflow-x-auto pb-1 [scrollbar-width:none] sm:mt-7 sm:flex sm:flex-wrap sm:overflow-visible sm:pb-0 [&::-webkit-scrollbar]:hidden" aria-label="Разделы">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            href={item.href}
            className="inline-flex min-h-10 w-[9.25rem] max-w-full items-center justify-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold leading-snug text-slate-700 transition hover:border-blue-200 hover:text-[#0875d1] sm:min-h-11 sm:w-auto sm:min-w-[9.5rem] sm:flex-none sm:px-4 sm:text-sm"
            key={item.href}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="min-w-0 break-words">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function AdminGuardedContent({ children }: { children: React.ReactNode }) {
  return (
    <AdminAuthGate>
      <NavPills items={adminNav} />
      <div className="mt-7">{children}</div>
    </AdminAuthGate>
  );
}

function MetricCard({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return (
    <article className="flex aspect-square min-h-0 flex-col justify-between rounded-xl border border-slate-200 bg-white p-3 shadow-card sm:aspect-auto sm:min-h-0 sm:p-5">
      <div className="flex items-start justify-between gap-2 sm:gap-4">
        <p className="text-xs font-bold leading-4 text-slate-500 sm:text-sm">{label}</p>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-[#0875d1] sm:h-10 sm:w-10">{icon}</span>
      </div>
      <p className="mt-2 line-clamp-2 text-xl font-black leading-tight text-[#060b27] sm:mt-4 sm:text-3xl">{value}</p>
      <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-600 sm:mt-2 sm:text-sm sm:leading-6">{detail}</p>
    </article>
  );
}

function DataTable<T extends Record<string, unknown>>({ columns, rows }: { columns: TableColumn<T>[]; rows: T[] }) {
  function getActionHref(row: T) {
    const directHref = String(row.href ?? "");

    if (directHref) {
      return directHref;
    }

    const id = String(row.id ?? "");

    if (id.startsWith("OB-")) {
      return "/cabinet/obyavleniya";
    }

    if (id.startsWith("VAC-")) {
      return "/cabinet/vakansii";
    }

    if (id.startsWith("PAY-")) {
      return "/cabinet/oplata";
    }

    if (id.startsWith("USR-")) {
      return "/admin/users";
    }

    if (id.startsWith("request-")) {
      return "/cabinet/zakazy";
    }

    if (id.startsWith("APP-") || id.startsWith("app-")) {
      return "/cabinet/otkliki";
    }

    if (id.startsWith("fair-")) {
      return "/cabinet/fair-applications";
    }

    return String(row.editHref ?? "/cabinet");
  }

  function getEditHref(row: T) {
    const editHref = String(row.editHref ?? "");

    if (editHref) {
      return editHref;
    }

    const actionHref = getActionHref(row);
    return actionHref.includes("?") ? `${actionHref}&edit=1` : `${actionHref}?edit=1`;
  }

  function getStatusHref(row: T) {
    const statusHref = String(row.statusHref ?? "");

    if (statusHref) {
      return statusHref;
    }

    const actionHref = getActionHref(row);
    return actionHref.includes("?") ? `${actionHref}&status=1` : `${actionHref}?status=1`;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <thead className="bg-slate-50 text-sm text-slate-500">
            <tr>
              {columns.map((column) => (
                <th className="border-b border-slate-200 px-4 py-3 font-bold sm:px-5 sm:py-4" key={String(column.key)}>
                  {column.label}
                </th>
              ))}
              <th className="border-b border-slate-200 px-4 py-3 font-bold sm:px-5 sm:py-4">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, index) => (
              <tr className="text-sm text-slate-700" key={String(row.id ?? index)}>
                {columns.map((column) => (
                  <td className="px-4 py-3 align-middle sm:px-5 sm:py-4" key={String(column.key)}>
                    {column.render ? column.render(row) : String(row[column.key] ?? "")}
                  </td>
                ))}
                <td className="px-4 py-3 sm:px-5 sm:py-4">
                  <div className="flex flex-wrap items-start gap-2">
                    <Link href={getActionHref(row)} className="inline-flex h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700">
                      Открыть
                    </Link>
                    <details className="group relative">
                      <summary className="inline-flex h-9 list-none cursor-pointer items-center rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-[#0875d1] marker:content-none">
                        Изменить
                      </summary>
                      <div className="mt-1 min-w-48 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                        <Link href={getEditHref(row)} className="block rounded-md px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-blue-50 hover:text-[#0875d1]">
                          Редактировать карточку
                        </Link>
                        <Link href={getStatusHref(row)} className="block rounded-md px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-blue-50 hover:text-[#0875d1]">
                          Изменить статус
                        </Link>
                      </div>
                    </details>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SectionTitle({ title, actionHref, actionLabel }: { title: string; actionHref?: string; actionLabel?: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-2xl font-black text-[#060b27]">{title}</h2>
      {actionHref && actionLabel ? (
        <Link href={actionHref} className="inline-flex items-center gap-1 text-sm font-bold text-[#0875d1]">
          {actionLabel}
          <ArrowRight className="h-4 w-4" />
        </Link>
      ) : null}
    </div>
  );
}

export function AuthPage() {
  return (
    <>
      <SiteHeader />
      <main className="min-h-screen bg-slate-50">
        <div className="page-container flex min-h-screen items-start justify-center py-5 sm:items-center sm:py-10">
          <div className="w-full max-w-[460px] min-w-0">
            <AuthForm />
          </div>
        </div>
      </main>
    </>
  );
}

export function CabinetPage() {
  return (
    <Shell title="Личный кабинет" description="Панель пользователя для публикаций, откликов, анкеты специалиста и оплат." eyebrow="Кабинет" nav={cabinetNav}>
      <CabinetAuthGate>
        <CabinetOverviewClient />
        <div className="mt-8">
          <CabinetCapabilities />
        </div>
      </CabinetAuthGate>
    </Shell>
  );
}

export function CabinetListingsPage() {
  return (
    <Shell title="Мои объявления" description="Статусы публикаций, просмотры и быстрые действия по объявлениям пользователя." eyebrow="Кабинет" nav={cabinetNav}>
      <CabinetAuthGate>
        <CabinetPublicationsClient type="listing" />
      </CabinetAuthGate>
    </Shell>
  );
}

export function CabinetVacanciesPage() {
  return (
    <Shell title="Мои вакансии" description="Список вакансий работодателя с оплатой публикации и управлением статусом." eyebrow="Кабинет" nav={cabinetNav}>
      <CabinetAuthGate>
        <CabinetPublicationsClient type="vacancy" />
      </CabinetAuthGate>
    </Shell>
  );
}

export function CabinetWorkRequestsPage() {
  return (
    <Shell title="Мои заказы исполнителям" description="Задачи, которые пользователь размещает для специалистов и исполнителей." eyebrow="Кабинет" nav={cabinetNav}>
      <CabinetAuthGate>
        <CabinetPublicationsClient type="workRequest" />
      </CabinetAuthGate>
    </Shell>
  );
}

export function CabinetSpecialistPage() {
  const specialist = getCurrentUserSpecialist();

  return (
    <Shell title="Анкета специалиста" description="Профиль исполнителя с услугами, контактами, статусом проверки и будущей публикацией." eyebrow="Кабинет" nav={cabinetNav}>
      <CabinetAuthGate>
        <CabinetSpecialistClient initialSpecialist={specialist ? specialistToDemoPublication(specialist) : undefined} />
      </CabinetAuthGate>
    </Shell>
  );
}

export function CabinetOrganizationPage() {
  return (
    <Shell title="Профиль организации" description="Профиль заказчика с публичным адресом и контактами для вакансий." eyebrow="Кабинет" nav={cabinetNav}>
      <CabinetAuthGate>
        <CabinetOrganizationClient />
        <CabinetContactsHint />
      </CabinetAuthGate>
    </Shell>
  );
}

export function CabinetResponsesPage() {
  return (
    <Shell title="Мои отклики" description="Отклики на вакансии со статусами оплаты, отправки и просмотра работодателем." eyebrow="Кабинет" nav={cabinetNav}>
      <CabinetAuthGate>
        <CabinetResponsesClient />
      </CabinetAuthGate>
    </Shell>
  );
}

export function CabinetPaymentsPage() {
  const tariffs = getTariffs();
  const adTariff = tariffs.find((tariff) => tariff.action === "ad_marquee");
  const publicationTariffs = tariffs.filter((tariff) => tariff.action !== "ad_marquee");

  return (
    <Shell title="Оплата и тарифы" description="Тарифы публикаций, история платежей и переход к оплате заказа." eyebrow="Кабинет" nav={cabinetNav}>
      <CabinetAuthGate>
        {adTariff ? (
          <section className="mb-4 rounded-xl border border-blue-100 bg-blue-50/70 p-3 shadow-card sm:mb-6 sm:p-5">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <div>
                <p className="text-xs font-black uppercase text-[#0875d1]">Реклама</p>
                <h2 className="mt-1 text-lg font-black text-[#060b27] sm:text-2xl">{adTariff.name}</h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  Покупка места в бегущей строке на главной странице на {adTariff.durationDays} дней.
                </p>
              </div>
              <div className="grid grid-cols-[1fr_auto] items-center gap-3 sm:block sm:text-right">
                <p className="text-2xl font-black text-[#0875d1] sm:text-3xl">{adTariff.price} ₽</p>
                <Link href={`/blizhniy/oplata/${adTariff.id}`} className="inline-flex h-10 items-center justify-center rounded-lg bg-[#0aa337] px-4 text-sm font-bold text-white sm:mt-3 sm:w-full">
                  Купить
                </Link>
              </div>
            </div>
          </section>
        ) : null}
        <section className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
          {publicationTariffs.map((tariff) => (
            <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-card sm:p-5" key={tariff.id}>
              <h2 className="line-clamp-2 text-sm font-black leading-5 text-[#060b27] sm:text-xl sm:leading-7">{tariff.name}</h2>
              <p className="mt-2 text-2xl font-black text-[#0875d1] sm:mt-3 sm:text-3xl">{tariff.price} ₽</p>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600 sm:mt-2 sm:text-sm sm:leading-6">{tariff.durationDays ? `${tariff.durationDays} дней размещения` : "Разовое действие"}</p>
              <Link href={`/blizhniy/oplata/${tariff.id}`} className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-lg bg-[#0aa337] text-sm font-bold text-white sm:mt-5 sm:h-11">
                Оплатить
              </Link>
            </article>
          ))}
        </section>
        <section className="mt-8">
          <SectionTitle title="История платежей" />
          <CabinetPaymentsHistoryClient />
        </section>
      </CabinetAuthGate>
    </Shell>
  );
}

export function CabinetFairApplicationsPage() {
  return (
    <Shell title="Заявки на ярмарку" description="Заявки пользователя на участие в Ярмарке мастеров, статусы оплаты и публикации." eyebrow="Кабинет" nav={cabinetNav}>
      <CabinetAuthGate>
        <CabinetPublicationsClient type="fairApplication" />
      </CabinetAuthGate>
    </Shell>
  );
}

export function FakePaymentPage({ paymentId }: { paymentId?: string }) {
  const payment = paymentId ? getPayment(paymentId) : undefined;
  const tariffs = getTariffs();
  const tariff =
    tariffs.find((item) => item.id === payment?.tariffId || item.id === paymentId) ??
    tariffs[0] ?? {
      id: "listing-publication",
      name: "Тестовая оплата",
      action: "listing_publication" as const,
      price: 0,
      durationDays: null,
      active: true,
    };
  const returnHref =
    payment?.targetType === "fair_application"
      ? "/cabinet/fair-applications"
      : payment?.targetType === "vacancy"
        ? "/cabinet/vakansii"
        : payment?.targetType === "listing"
          ? "/cabinet/obyavleniya"
          : "/cabinet/oplata";

  return (
    <Shell title="Оплата заказа" description="Проверьте заказ, выберите способ оплаты и подтвердите платеж." eyebrow="Оплата">
      <section className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-card sm:p-5">
          <h2 className="text-xl font-black text-[#060b27] sm:text-2xl">{payment?.targetTitle ?? `Заказ ${paymentId ?? tariff.id}`}</h2>
          {payment ? <p className="mt-2 text-sm font-semibold text-slate-500">Платеж {payment.id}</p> : null}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:mt-6 sm:grid-cols-3 sm:gap-4">
            <MetricCard icon={<WalletCards className="h-5 w-5" />} label="Тариф" value={tariff.name} detail="Заказ сформирован." />
            <MetricCard icon={<Banknote className="h-5 w-5" />} label="Сумма" value={`${payment?.amount ?? tariff.price} ₽`} detail="Фиксированная стоимость." />
            <MetricCard icon={<CheckCircle2 className="h-5 w-5" />} label="Статус" value={payment?.status === "succeeded" ? "Оплачено" : "Ожидает оплаты"} detail="После оплаты публикация обновит статус." />
          </div>
          <div className="mt-4 rounded-xl bg-slate-50 p-3 sm:mt-6 sm:p-5">
            <p className="font-bold text-slate-700">Способы оплаты</p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-4 sm:gap-3">
              <div className="flex h-11 items-center justify-center rounded-lg border border-blue-200 bg-white px-2 text-center text-xs font-bold text-[#0875d1] sm:h-12 sm:text-base">Банковская карта</div>
              <div className="flex h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-2 text-center text-xs font-bold text-slate-700 sm:h-12 sm:text-base">Счет для бизнеса</div>
            </div>
          </div>
        </article>
        <aside className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 shadow-card sm:p-5">
          <ShieldCheck className="h-8 w-8 text-[#0aa337] sm:h-10 sm:w-10" />
          <h2 className="mt-3 text-xl font-black text-[#060b27] sm:mt-4 sm:text-2xl">Подтверждение оплаты</h2>
          <p className="mt-2 text-sm leading-6 text-slate-700 sm:mt-3 sm:text-base sm:leading-7">После подтверждения заказ получит статус «Оплата прошла», а публикация будет обновлена.</p>
          <MockPaymentButton paymentId={payment?.id} tariffId={tariff.id} returnHref={returnHref} />
        </aside>
      </section>
    </Shell>
  );
}

export function AdminPage() {
  const tariffs = getTariffs();

  return (
    <Shell title="Админка" description="Панель модерации пользователей, контента, классификаторов, тарифов и платежей." eyebrow="Администрирование" createHref="/blizhniy/sozdat?admin=1">
      <AdminGuardedContent>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={<UsersRound className="h-5 w-5" />} label="Пользователи" value="3" detail="Роли user, organization, admin." />
          <MetricCard icon={<ClipboardList className="h-5 w-5" />} label="Публикации" value="9" detail="Объявления, вакансии, анкеты." />
          <MetricCard icon={<WalletCards className="h-5 w-5" />} label="Тарифы" value={String(tariffs.length)} detail="Все тарифы активны." />
          <MetricCard icon={<Banknote className="h-5 w-5" />} label="Платежи" value="3" detail="Есть успешный, ожидающий и ошибка." />
        </div>
        <div id="ad-marquee" className="mt-4 scroll-mt-24 sm:mt-6">
          <AdMarqueeAdminPanel />
        </div>
        <div className="mt-6 grid gap-6 xl:grid-cols-2">
          <section>
            <SectionTitle title="Очередь модерации" actionHref="/admin/obyavleniya" actionLabel="Все объявления" />
            <DataTable
              rows={listingRows()}
              columns={[
                { key: "id", label: "ID" },
                { key: "title", label: "Публикация" },
                { key: "category", label: "Категория" },
                { key: "status", label: "Статус", render: (row) => <StatusBadge status={String(row.status)} /> },
              ]}
            />
          </section>
          <section>
            <SectionTitle title="Последние платежи" actionHref="/admin/payments" actionLabel="Все платежи" />
            <DataTable
              rows={adminPaymentRows()}
              columns={[
                { key: "id", label: "ID" },
                { key: "user", label: "Пользователь" },
                { key: "amount", label: "Сумма" },
                { key: "status", label: "Статус", render: (row) => <StatusBadge status={String(row.status)} /> },
              ]}
            />
          </section>
        </div>
      </AdminGuardedContent>
    </Shell>
  );
}

export function AdminUsersPage() {
  const rows = adminUsers.map((user) => ({
    ...user,
    href: "/admin/users",
    editHref: `/admin/users?edit=${user.id}`,
  }));

  return (
    <AdminTablePage
      title="Пользователи"
      description="Учетные записи, роли, телефоны и модерационные действия."
      rows={rows}
      columns={[
        { key: "id", label: "ID" },
        { key: "name", label: "Имя" },
        { key: "role", label: "Роль" },
        { key: "phone", label: "Телефон" },
        { key: "status", label: "Статус", render: (row) => <StatusBadge status={String(row.status)} /> },
      ]}
    />
  );
}

export function AdminListingsPage() {
  return (
    <AdminTablePage
      title="Объявления"
      description="Модерация пользовательских объявлений и перевод между статусами публикации."
      rows={listingRows()}
      columns={[
        { key: "id", label: "ID" },
        { key: "title", label: "Название" },
        { key: "category", label: "Категория" },
        { key: "city", label: "Город" },
        { key: "district", label: "Район/адрес" },
        { key: "status", label: "Статус", render: (row) => <StatusBadge status={String(row.status)} /> },
      ]}
    />
  );
}

export function AdminVacanciesPage() {
  const rows = listVacancies().map((vacancy) => ({
    id: vacancy.id,
    organization: vacancy.organization,
    title: vacancy.title,
    city: vacancy.city,
    address: vacancy.address ?? vacancy.district ?? "",
    status: vacancy.status,
    href: `/blizhniy/vakansiya/${vacancy.id}`,
    editHref: `/blizhniy/rabota/vakansii/${vacancy.id}/redaktirovat`,
  }));

  return (
    <AdminTablePage
      title="Вакансии"
      description="Рабочие публикации компаний и заказчиков в административном виде."
      rows={rows as unknown as Record<string, unknown>[]}
      columns={[
        { key: "id", label: "ID" },
        { key: "organization", label: "Компания" },
        { key: "title", label: "Вакансия" },
        { key: "city", label: "Город" },
        { key: "address", label: "Точный адрес" },
        { key: "status", label: "Статус", render: (row) => <StatusBadge status={String(row.status)} /> },
      ]}
    />
  );
}

export function AdminSpecialistsPage() {
  const rows = listSpecialists().map((specialist) => ({
    id: specialist.id,
    name: specialist.name,
    profession: specialist.profession,
    city: specialist.city,
    district: specialist.district,
    status: specialist.status,
    href: `/blizhniy/specialist/${specialist.id}`,
    editHref: `/blizhniy/rabota/specialisty/anketa?from=${specialist.id}`,
  }));

  return (
    <AdminTablePage
      title="Специалисты"
      description="Анкеты исполнителей, профессии, города и статусы публикации."
      rows={rows as unknown as Record<string, unknown>[]}
      columns={[
        { key: "id", label: "ID" },
        { key: "name", label: "Имя" },
        { key: "profession", label: "Профессия" },
        { key: "city", label: "Город" },
        { key: "district", label: "Зона" },
        { key: "status", label: "Статус", render: (row) => <StatusBadge status={String(row.status)} /> },
      ]}
    />
  );
}

export function AdminCategoriesPage() {
  const rows = categories.map((category) => ({
    ...category,
    id: category.slug,
    href: `/blizhniy/${category.slug}`,
    editHref: `/admin/categories?edit=${category.slug}`,
    childrenText: category.children.join(", "),
    status: "active",
  }));

  return (
    <Shell title="Категории" description="Рубрикатор объявлений с дочерними разделами для модерации каталога." eyebrow="Администрирование" createHref="/blizhniy/sozdat?admin=1">
      <AdminGuardedContent>
        <CategoryOrderAdminPanel />
        <div className="mt-6">
          <DataTable
            rows={rows}
            columns={[
              { key: "name", label: "Категория" },
              { key: "slug", label: "Slug" },
              { key: "childrenText", label: "Подразделы" },
              { key: "status", label: "Статус", render: (row) => <StatusBadge status={String(row.status)} /> },
            ]}
          />
        </div>
      </AdminGuardedContent>
    </Shell>
  );
}

export function AdminClassifierPage() {
  return (
    <AdminTablePage
      title="Классификатор специалистов"
      description="Профессии специалистов, родительские группы и активность в каталоге."
      rows={professions.map((profession) => ({
        ...profession,
        id: profession.slug,
        href: `/blizhniy/rabota/specialisty/${profession.slug}`,
        editHref: `/blizhniy/rabota/specialisty/klassifikator?edit=${profession.slug}`,
        status: profession.active ? "active" : "archive",
      }))}
      columns={[
        { key: "name", label: "Профессия" },
        { key: "parent", label: "Группа" },
        { key: "slug", label: "Slug" },
        { key: "status", label: "Статус", render: (row) => <StatusBadge status={String(row.status)} /> },
      ]}
    />
  );
}

export function AdminTariffsPage() {
  const tariffs = getTariffs();

  return (
    <AdminTablePage
      title="Тарифы"
      description="Тарифная сетка действий: публикации, вакансии и платные отклики."
      rows={tariffs.map((tariff) => ({
        ...tariff,
        id: tariff.id,
        href: "/tarify",
        editHref: "/admin/payments#tariff-prices",
        priceText: `${tariff.price} ₽`,
        status: tariff.active ? "active" : "archive",
      }))}
      columns={[
        { key: "name", label: "Название" },
        { key: "action", label: "Действие" },
        { key: "priceText", label: "Цена" },
        { key: "durationDays", label: "Дней" },
        { key: "status", label: "Статус", render: (row) => <StatusBadge status={String(row.status)} /> },
      ]}
    />
  );
}

export function AdminPaymentsPage() {
  const tariffs = getTariffs();
  const rows = adminPaymentRows().map((payment) => ({
    ...payment,
    href: `/blizhniy/oplata/${payment.id}`,
    editHref: "/admin/payments#tariff-prices",
  }));

  return (
    <Shell
      title="Цены"
      description="Редактирование цен и история платежей с суммами, пользователями и статусами."
      eyebrow="Администрирование"
      createHref="/blizhniy/sozdat?admin=1"
    >
      <AdminGuardedContent>
        <section id="tariff-prices" className="mb-8 scroll-mt-24 rounded-xl border border-blue-100 bg-blue-50/50 p-3 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-black text-[#060b27] sm:text-2xl">Редактирование цен</h2>
            <form action={resetTariffsAction}>
              <button type="submit" className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-xs font-bold text-slate-700 transition hover:border-blue-200 hover:text-[#0875d1] sm:text-sm">
                Сбросить цены
              </button>
            </form>
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {tariffs.map((tariff) => {
              const hasDuration = tariff.durationDays !== null;

              if (!hasDuration) {
                return (
                  <form key={tariff.id} action={updateTariffAction} className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                    <input type="hidden" name="id" value={tariff.id} />
                    <input type="hidden" name="durationDays" value="" />
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-black leading-5 text-[#060b27]">{tariff.name}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{tariff.id}</p>
                      </div>
                      <label className="flex h-8 shrink-0 items-center gap-2 text-xs font-bold text-slate-600">
                        <input type="checkbox" name="active" value="1" defaultChecked={tariff.active} className="h-4 w-4 accent-[#0875d1]" />
                        Активен
                      </label>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                      <label className="grid gap-1 text-xs font-bold text-slate-600">
                        Цена, ₽
                        <input
                          type="number"
                          min={0}
                          step={1}
                          name="price"
                          defaultValue={tariff.price}
                          className="h-9 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-800 outline-none focus:border-[#0875d1]"
                        />
                      </label>
                      <button type="submit" className="inline-flex h-9 items-center justify-center rounded-lg bg-[#0875d1] px-3 text-xs font-bold text-white transition hover:bg-[#0664b3] sm:min-w-24">
                        Сохранить
                      </button>
                    </div>
                  </form>
                );
              }

              return (
                <form key={tariff.id} action={updateTariffAction} className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                  <input type="hidden" name="id" value={tariff.id} />
                  <div>
                    <p className="text-sm font-black leading-5 text-[#060b27]">{tariff.name}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{tariff.id}</p>
                  </div>
                  <div className={`grid gap-2 ${hasDuration ? "sm:grid-cols-2" : ""}`}>
                    <label className="grid gap-1 text-xs font-bold text-slate-600">
                      Цена, ₽
                      <input
                        type="number"
                        min={0}
                        step={1}
                        name="price"
                        defaultValue={tariff.price}
                        className="h-9 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-800 outline-none focus:border-[#0875d1]"
                      />
                    </label>
                    <label className="grid gap-1 text-xs font-bold text-slate-600">
                      Дней размещения
                      <input
                        type="number"
                        min={0}
                        step={1}
                        name="durationDays"
                        defaultValue={tariff.durationDays ?? ""}
                        className="h-9 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-800 outline-none focus:border-[#0875d1]"
                      />
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
                      <input type="checkbox" name="active" value="1" defaultChecked={tariff.active} className="h-4 w-4 accent-[#0875d1]" />
                      Активен
                    </label>
                    <button type="submit" className="inline-flex h-9 items-center justify-center rounded-lg bg-[#0875d1] px-3 text-xs font-bold text-white transition hover:bg-[#0664b3]">
                      Сохранить
                    </button>
                  </div>
                </form>
              );
            })}
          </div>
        </section>

        <DataTable
          rows={rows}
          columns={[
            { key: "id", label: "ID" },
            { key: "user", label: "Пользователь" },
            { key: "subject", label: "Назначение" },
            { key: "amount", label: "Сумма" },
            { key: "status", label: "Статус", render: (row) => <StatusBadge status={String(row.status)} /> },
          ]}
        />
      </AdminGuardedContent>
    </Shell>
  );
}

export function AdminFairApplicationsPage() {
  const rows = listFairApplications().map((application) => ({
    ...application,
    href: "/yarmarka-masterov",
    editHref: `/admin/fair-applications?edit=${application.id}`,
  }));

  return (
    <AdminTablePage
      title="Заявки на ярмарку"
      description="Административный список заявок участников Ярмарки мастеров."
      rows={rows as unknown as Record<string, unknown>[]}
      columns={[
        { key: "id", label: "ID" },
        { key: "participantName", label: "Участник" },
        { key: "category", label: "Категория" },
        { key: "city", label: "Город" },
        { key: "paymentStatus", label: "Оплата", render: (row) => <StatusBadge status={String(row.paymentStatus)} /> },
        { key: "status", label: "Статус", render: (row) => <StatusBadge status={String(row.status)} /> },
      ]}
    />
  );
}

function AdminTablePage<T extends Record<string, unknown>>({
  title,
  description,
  rows,
  columns,
}: {
  title: string;
  description: string;
  rows: T[];
  columns: TableColumn<T>[];
}) {
  return (
    <Shell title={title} description={description} eyebrow="Администрирование" createHref="/blizhniy/sozdat?admin=1">
      <AdminGuardedContent>
        <DataTable rows={rows} columns={columns} />
      </AdminGuardedContent>
    </Shell>
  );
}
