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
  FileText,
  Gauge,
  MessageSquare,
  Plus,
  ShieldCheck,
  Store,
  Tags,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { AdminAuthGate } from "@/components/auth/AdminAuthGate";
import { AdMarqueeAdminPanel } from "@/components/AdMarqueeAdminPanel";
import { AdminPublicationStatusForm } from "@/components/AdminPublicationStatusForm";
import { AuthForm } from "@/components/auth/AuthForm";
import { CabinetAuthGate } from "@/components/auth/CabinetAuthGate";
import { CabinetShellActions } from "@/components/cabinet/CabinetShellActions";
import {
  CabinetCapabilities,
  CabinetContactsHint,
  CabinetOrganizationClient,
  CabinetOverviewClient,
  CabinetPaymentsClient,
  type CabinetResponseItem,
  type CabinetPaymentHistoryItem,
  CabinetProfileBar,
  CabinetPublicationsClient,
  CabinetResponsesClient,
  CabinetSpecialistClient,
} from "@/components/cabinet/CabinetClient";
import { CategoryOrderAdminPanel } from "@/components/CategoryOrderAdminPanel";
import { MockPaymentButton } from "@/components/payments/MockPaymentButton";
import { SiteHeader } from "@/components/SiteHeader";
import { listDemoListings, toDemoListing } from "@/components/listings/ListingPages";
import type { DemoPublication } from "@/lib/demo-publications";
import { categories } from "@/lib/data";
import { listStoredFairApplications, updateStoredFairApplicationStatus } from "@/lib/fair-application-store";
import { getPayment } from "@/lib/payment-provider";
import { isDemoAdminBypassEnabled } from "@/lib/server-auth";
import {
  getCurrentUserSpecialist,
  listApplications,
  listListings,
  listMockPayments,
  listSpecialists,
  listVacancies,
  listWorkRequests,
  updateFairApplicationStatus,
  updateListingStatus,
  updateSpecialistStatus,
  updateVacancyStatus,
  updateWorkRequestStatus,
} from "@/lib/mock-store";
import type { PublicationStatus, SpecialistProfile } from "@/lib/types";
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
  archived: "Архив",
  blocked: "Заблокирован",
  created: "Создан",
  draft: "Черновик",
  expired: "Истек срок",
  failed: "Ошибка",
  paid: "Оплачен",
  pending_payment: "Ждет оплату",
  pending: "Ожидает",
  published: "Опубликовано",
  rejected: "Отклонено",
  sold: "Продано",
  sent: "Отправлен",
  succeeded: "Успешно",
  viewed: "Просмотрен",
};

const statusTones: Record<string, StatusTone> = {
  active: "green",
  archive: "slate",
  archived: "slate",
  blocked: "red",
  created: "amber",
  draft: "slate",
  expired: "amber",
  failed: "red",
  paid: "green",
  pending: "amber",
  pending_payment: "amber",
  published: "blue",
  rejected: "red",
  sold: "slate",
  sent: "blue",
  succeeded: "green",
  viewed: "violet",
};

const moderationStatusOptions: Array<{ label: string; value: PublicationStatus }> = [
  { label: "Опубликовано", value: "published" },
  { label: "Черновик", value: "draft" },
  { label: "Ждет оплату", value: "pending_payment" },
  { label: "Архив", value: "archived" },
  { label: "Отклонено", value: "rejected" },
  { label: "Истек срок", value: "expired" },
  { label: "Продано", value: "sold" },
];

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
];

const adminNav = [
  { href: "/admin", label: "Обзор", icon: Gauge },
  { href: "/admin/users", label: "Пользователи", icon: UsersRound },
  { href: "/admin/obyavleniya", label: "Объявления", icon: FileText },
  { href: "/admin/vakansii", label: "Вакансии", icon: BriefcaseBusiness },
  { href: "/admin/zakazy", label: "Заказы", icon: ClipboardList },
  { href: "/admin/specialisty", label: "Специалисты", icon: CircleUserRound },
  { href: "/admin/categories", label: "Категории", icon: Tags },
  { href: "/admin/tariffs", label: "Тарифы", icon: WalletCards },
  { href: "/admin/fair-applications", label: "Ярмарка", icon: Store },
];

async function updateTariffAction(formData: FormData) {
  "use server";

  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const price = Number(formData.get("price"));
  const durationRaw = String(formData.get("durationDays") ?? "").trim();
  const active = formData.get("active") === "1";

  if (!id || !name || !getTariffById(id) || Number.isNaN(price) || price < 0) {
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

  updateTariffPatch(id, { name, price, durationDays, active });
  revalidatePath("/admin/tariffs");
  revalidatePath("/cabinet/oplata");
  revalidatePath("/oplata/[paymentId]", "page");
  revalidatePath("/tarify");
}

async function resetTariffsAction() {
  "use server";

  resetTariffPatches();
  revalidatePath("/admin/tariffs");
  revalidatePath("/cabinet/oplata");
  revalidatePath("/oplata/[paymentId]", "page");
  revalidatePath("/tarify");
}

async function updatePublicationStatusAction(formData: FormData) {
  "use server";

  const entityType = String(formData.get("entityType") ?? "");
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "") as PublicationStatus;

  if (!id || !moderationStatusOptions.some((option) => option.value === status)) {
    return;
  }

  if (entityType === "listing") {
    updateListingStatus(id, status);
    revalidatePath("/admin/obyavleniya");
    revalidatePath("/");
    revalidatePath("/katalog/[categorySlug]", "page");
    revalidatePath("/katalog/[categorySlug]/[subcategorySlug]", "page");
    revalidatePath("/obyavlenie/[slug]", "page");
    revalidatePath("/poisk");
    return;
  }

  if (entityType === "vacancy") {
    updateVacancyStatus(id, status);
    revalidatePath("/admin/vakansii");
    revalidatePath("/rabota");
    revalidatePath("/rabota/vakansii");
    revalidatePath("/vakansiya/[slug]", "page");
    revalidatePath("/poisk");
    return;
  }

  if (entityType === "specialist") {
    updateSpecialistStatus(id, status);
    revalidatePath("/admin/specialisty");
    revalidatePath("/rabota");
    revalidatePath("/rabota/specialisty");
    revalidatePath("/rabota/specialisty/[professionSlug]", "page");
    revalidatePath("/specialist/[slug]", "page");
    revalidatePath("/poisk");
    return;
  }

  if (entityType === "workRequest") {
    updateWorkRequestStatus(id, status);
    revalidatePath("/admin/zakazy");
    revalidatePath("/rabota");
    revalidatePath("/rabota/zakazy/[slug]", "page");
    revalidatePath("/poisk");
    return;
  }

  if (entityType === "fairApplication") {
    const stored = await updateStoredFairApplicationStatus(id, status);

    if (!stored) {
      updateFairApplicationStatus(id, status);
    }

    revalidatePath("/admin/fair-applications");
    revalidatePath("/yarmarka-masterov");
    revalidatePath("/poisk");
  }
}

function listingRows() {
  const allListings = [...listDemoListings(), ...listListings().map(toDemoListing)];
  const uniqueListings = Array.from(new Map(allListings.map((listing) => [listing.slug, listing])).values());

  return uniqueListings.map((listing, index) => ({
    id: listing.viewId ?? listing.slug,
    statusTargetId: listing.slug,
    statusEntityType: "listing",
    href: `/obyavlenie/${listing.slug}`,
    editHref: `/obyavlenie/${listing.slug}/edit`,
    title: listing.title,
    category: listing.categoryName,
    city: listing.city,
    district: listing.district ?? listing.address ?? "",
    status: listing.status,
    views: index === 0 ? 124 : index === 1 ? 18 : 0,
  }));
}

function paymentRows() {
  return listMockPayments().map((payment) => ({
    id: payment.id,
    href: `/oplata/${payment.id}`,
    editHref: "/cabinet/oplata",
    subject: payment.targetTitle,
    amount: `${payment.amount} ₽`,
    method: payment.provider === "mock" ? "Тестовая оплата" : payment.provider,
    status: payment.status,
  }));
}

function responseRows(): CabinetResponseItem[] {
  return listApplications().map((application) => ({
    href: "/rabota/vakansii",
    id: application.id,
    paymentHref: `/oplata/${application.paymentId}`,
    paymentId: application.paymentId,
    specialistName: application.specialistName,
    status: application.status,
    vacancyTitle: application.vacancyTitle,
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
  activeHref,
  createHref = "/razmestit",
  createLabel = "Создать",
  children,
}: {
  title: string;
  description: string;
  eyebrow: string;
  nav?: typeof cabinetNav;
  activeHref?: string;
  createHref?: string | null;
  createLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      <main className={`page-container dashboard-shell pt-6 sm:pt-10 ${nav === cabinetNav ? "pb-16 sm:pb-20" : "pb-6 sm:pb-10"}`}>
        <p className="text-xs font-bold uppercase tracking-wide text-[#0aa337] sm:text-sm">{eyebrow}</p>
        <div className="mt-2 flex flex-col gap-4 sm:mt-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-3xl font-black leading-tight text-[#060b27] sm:text-5xl">{title}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 [overflow-wrap:anywhere] sm:mt-3 sm:text-lg sm:leading-7">{description}</p>
          </div>
          <div className={nav ? "grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-3" : "grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:gap-3"}>
            {nav ? (
              <CabinetShellActions createHref={createHref} createLabel={createLabel} />
            ) : createHref ? (
              <ActionLink href={createHref} tone="green">
                <Plus className="h-4 w-4" />
                {createLabel}
              </ActionLink>
            ) : null}
          </div>
        </div>
        {nav ? <NavPills items={nav} activeHref={activeHref} /> : null}
        {nav === cabinetNav ? <CabinetProfileBar /> : null}
        <div className="mt-5 sm:mt-7">{children}</div>
      </main>
    </>
  );
}

function NavPills({ items, activeHref }: { items: typeof cabinetNav; activeHref?: string }) {
  return (
    <nav className="mt-5 grid grid-flow-col grid-rows-2 gap-2 overflow-x-auto pb-1 [scrollbar-width:none] sm:mt-7 sm:flex sm:flex-wrap sm:overflow-visible sm:pb-0 [&::-webkit-scrollbar]:hidden" aria-label="Разделы">
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.href === activeHref;
        return (
          <Link
            href={item.href}
            className={`inline-flex min-h-10 w-[9.25rem] max-w-full items-center justify-start gap-2 rounded-lg border px-3 py-2 text-xs font-bold leading-snug transition sm:min-h-11 sm:w-auto sm:min-w-[9.5rem] sm:flex-none sm:px-4 sm:text-sm ${
              active ? "border-blue-200 bg-blue-50 text-[#0875d1] ring-1 ring-blue-100" : "border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:text-[#0875d1]"
            }`}
            aria-current={active ? "page" : undefined}
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
    <article className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold leading-4 text-slate-500">{label}</p>
          <p className="mt-1.5 line-clamp-1 text-2xl font-black leading-tight text-[#060b27]">{value}</p>
          <p className="mt-1 line-clamp-1 text-xs leading-4 text-slate-600">{detail}</p>
        </div>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-[#0875d1]">{icon}</span>
      </div>
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
    <div className="rounded-xl border border-slate-200 bg-white shadow-card">
      <div className="overflow-x-auto overflow-y-visible">
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
                      <div className="absolute right-0 top-[calc(100%+0.25rem)] z-[200] min-w-56 rounded-lg border border-slate-200 bg-white p-1 shadow-xl shadow-slate-900/10">
                        <Link href={getEditHref(row)} className="block rounded-md px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-blue-50 hover:text-[#0875d1]">
                          Редактировать карточку
                        </Link>
                        {String(row.statusEntityType ?? "") ? (
                          <AdminPublicationStatusForm
                            entityType={String(row.statusEntityType)}
                            id={String(row.statusTargetId ?? row.id ?? "")}
                            status={String(row.status ?? "published")}
                            options={moderationStatusOptions}
                            updateStatusAction={updatePublicationStatusAction}
                          />
                        ) : (
                          <Link href={getStatusHref(row)} className="block rounded-md px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-blue-50 hover:text-[#0875d1]">
                            Изменить статус
                          </Link>
                        )}
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
    <Shell title="Личный кабинет" description="Панель пользователя для публикаций, откликов и рабочих разделов." eyebrow="Кабинет" nav={cabinetNav} activeHref="/cabinet">
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
    <Shell title="Мои объявления" description="Статусы публикаций, просмотры и быстрые действия по объявлениям пользователя." eyebrow="Кабинет" nav={cabinetNav} activeHref="/cabinet/obyavleniya" createHref="/razmestit/obyavlenie" createLabel="Создать объявление">
      <CabinetAuthGate>
        <CabinetPublicationsClient type="listing" />
      </CabinetAuthGate>
    </Shell>
  );
}

export function CabinetVacanciesPage() {
  return (
    <Shell title="Мои вакансии" description="Список вакансий работодателя с оплатой публикации и управлением статусом." eyebrow="Кабинет" nav={cabinetNav} activeHref="/cabinet/vakansii" createHref="/rabota/vakansii/sozdat" createLabel="Разместить вакансию">
      <CabinetAuthGate>
        <CabinetPublicationsClient type="vacancy" />
      </CabinetAuthGate>
    </Shell>
  );
}

export function CabinetWorkRequestsPage() {
  return (
    <Shell title="Мои заказы исполнителям" description="Задачи, которые пользователь размещает для специалистов и исполнителей." eyebrow="Кабинет" nav={cabinetNav} activeHref="/cabinet/zakazy" createHref="/cabinet/zakazy" createLabel="Разместить заказ">
      <CabinetAuthGate>
        <CabinetPublicationsClient type="workRequest" />
      </CabinetAuthGate>
    </Shell>
  );
}

export function CabinetSpecialistPage() {
  const specialist = getCurrentUserSpecialist();

  return (
    <Shell title="Анкета специалиста" description="Профиль исполнителя с услугами, контактами, статусом проверки и будущей публикацией." eyebrow="Кабинет" nav={cabinetNav} activeHref="/cabinet/specialist" createHref="/rabota/specialisty/anketa" createLabel="Создать анкету">
      <CabinetAuthGate>
        <CabinetSpecialistClient initialSpecialist={specialist ? specialistToDemoPublication(specialist) : undefined} />
      </CabinetAuthGate>
    </Shell>
  );
}

export function CabinetOrganizationPage() {
  return (
    <Shell title="Профиль организации" description="Профиль заказчика с публичным адресом и контактами для вакансий." eyebrow="Кабинет" nav={cabinetNav} activeHref="/cabinet/organization" createHref={null}>
      <CabinetAuthGate>
        <CabinetOrganizationClient />
        <CabinetContactsHint />
      </CabinetAuthGate>
    </Shell>
  );
}

export function CabinetResponsesPage() {
  const responses = responseRows();

  return (
    <Shell title="Мои отклики" description="Отклики на вакансии со статусами оплаты, отправки и просмотра работодателем." eyebrow="Кабинет" nav={cabinetNav} activeHref="/cabinet/otkliki" createHref="/rabota/vakansii" createLabel="Найти вакансию">
      <CabinetAuthGate>
        <CabinetResponsesClient responses={responses} />
      </CabinetAuthGate>
    </Shell>
  );
}

export function CabinetPaymentsPage() {
  const payments = paymentRows() as CabinetPaymentHistoryItem[];

  return (
    <Shell title="Платежи" description="Сформированные заказы, ожидающие оплаты, и история платежей." eyebrow="Кабинет" nav={cabinetNav} activeHref="/cabinet/oplata" createHref={null}>
      <CabinetAuthGate>
        <CabinetPaymentsClient initialPayments={payments} />
      </CabinetAuthGate>
    </Shell>
  );
}

export function CabinetFairApplicationsPage() {
  return (
    <Shell title="Заявки на ярмарку" description="Заявки пользователя на участие в Ярмарке мастеров, статусы оплаты и публикации." eyebrow="Кабинет" nav={cabinetNav} activeHref="/cabinet/fair-applications" createHref="/yarmarka-masterov/zayavka" createLabel="Подать заявку">
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
    <Shell title="Оплата заказа" description="Проверьте заказ, выберите способ оплаты и подтвердите платеж." eyebrow="Оплата" createHref={null}>
      <section className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-card sm:p-5">
          <h2 className="text-xl font-black text-[#060b27] sm:text-2xl">{payment?.targetTitle ?? `Заказ ${paymentId ?? tariff.id}`}</h2>
          {payment ? <p className="mt-2 text-sm font-semibold text-slate-500">Платеж {payment.id}</p> : null}
          <div className="mt-4 grid gap-3 sm:mt-6 sm:grid-cols-3 sm:gap-4">
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
  const activeTariffs = tariffs.filter((tariff) => tariff.active).length;
  const publicationsCount = listListings().length + listVacancies().length + listSpecialists().length;
  const paymentsCount = adminPaymentRows().length;

  return (
    <Shell title="Админка" description="Рабочий обзор: реклама, быстрый переход к разделам и ключевые показатели." eyebrow="Администрирование" createHref={null}>
      <AdminGuardedContent>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={<UsersRound className="h-5 w-5" />} label="Пользователи" value="3" detail="Роли user, organization, admin." />
          <MetricCard icon={<ClipboardList className="h-5 w-5" />} label="Публикации" value={String(publicationsCount)} detail="Объявления, вакансии, анкеты." />
          <MetricCard icon={<WalletCards className="h-5 w-5" />} label="Тарифы" value={`${activeTariffs}/${tariffs.length}`} detail="Активные тарифы из общей сетки." />
          <MetricCard icon={<Banknote className="h-5 w-5" />} label="Платежи" value={String(paymentsCount)} detail="История на вкладке тарифов." />
        </div>
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <AdMarqueeAdminPanel />
          <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
            <h2 className="text-lg font-black text-[#060b27]">Разделы управления</h2>
            <div className="mt-3 grid gap-2">
              <ActionLink href="/admin/obyavleniya" tone="plain">Объявления</ActionLink>
              <ActionLink href="/admin/vakansii" tone="plain">Вакансии</ActionLink>
              <ActionLink href="/admin/specialisty" tone="plain">Специалисты</ActionLink>
              <ActionLink href="/admin/tariffs" tone="plain">Тарифы и платежи</ActionLink>
            </div>
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
    statusTargetId: vacancy.id,
    statusEntityType: "vacancy",
    organization: vacancy.organization,
    title: vacancy.title,
    city: vacancy.city,
    address: vacancy.address ?? vacancy.district ?? "",
    status: vacancy.status,
    href: `/vakansiya/${vacancy.id}`,
    editHref: `/rabota/vakansii/${vacancy.id}/edit`,
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

export function AdminWorkRequestsPage() {
  const rows = listWorkRequests().map((request) => ({
    id: request.id,
    statusTargetId: request.id,
    statusEntityType: "workRequest",
    author: request.author,
    title: request.title,
    profession: request.profession,
    city: request.city,
    budget: request.budget,
    status: request.status,
    href: `/rabota/zakazy/${request.id}`,
    editHref: `/rabota/zakazy/${request.id}/edit`,
  }));

  return (
    <AdminTablePage
      title="Заказы"
      description="Заявки заказчиков для специалистов и исполнителей с управлением видимостью."
      rows={rows as unknown as Record<string, unknown>[]}
      columns={[
        { key: "id", label: "ID" },
        { key: "author", label: "Заказчик" },
        { key: "title", label: "Задача" },
        { key: "profession", label: "Профессия" },
        { key: "city", label: "Город" },
        { key: "budget", label: "Бюджет" },
        { key: "status", label: "Статус", render: (row) => <StatusBadge status={String(row.status)} /> },
      ]}
    />
  );
}

export function AdminSpecialistsPage() {
  const rows = listSpecialists().map((specialist) => ({
    id: specialist.id,
    statusTargetId: specialist.id,
    statusEntityType: "specialist",
    name: specialist.name,
    profession: specialist.profession,
    city: specialist.city,
    district: specialist.district,
    status: specialist.status,
    href: `/specialist/${specialist.id}`,
    editHref: `/rabota/specialisty/anketa?from=${specialist.id}`,
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
    href: `/katalog/${category.slug}`,
    editHref: `/admin/categories?edit=${category.slug}`,
    childrenText: category.children.join(", "),
    status: "active",
  }));
  const createHref = isDemoAdminBypassEnabled() ? "/razmestit?admin=1" : "/razmestit";

  return (
    <Shell title="Категории" description="Рубрикатор объявлений с дочерними разделами для модерации каталога." eyebrow="Администрирование" createHref={createHref}>
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

function TariffEditorSection({ tariffs, title = "Редактирование тарифов", intro }: { tariffs: ReturnType<typeof getTariffs>; title?: string; intro?: string }) {
  return (
    <section id="tariff-prices" className="scroll-mt-24 rounded-lg border border-blue-100 bg-blue-50/50 p-3 sm:p-4">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-black text-[#060b27] sm:text-xl">{title}</h2>
          {intro ? <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-600 sm:text-sm">{intro}</p> : null}
        </div>
        <form action={resetTariffsAction} className="shrink-0">
          <button
            type="submit"
            className="inline-flex h-9 w-full items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 transition hover:border-blue-200 hover:text-[#0875d1] sm:w-auto"
          >
            Сбросить тарифы
          </button>
        </form>
      </div>
      <div className="grid gap-2 xl:grid-cols-2">
        {tariffs.map((tariff) => (
          <form id={`tariff-${tariff.id}`} key={tariff.id} action={updateTariffAction} className="grid gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
            <input type="hidden" name="id" value={tariff.id} />
            <div className="grid gap-2 sm:grid-cols-[minmax(14rem,1fr)_auto] sm:items-end">
              <div className="min-w-0">
                <label className="grid gap-1 text-xs font-bold text-slate-600">
                  Название
                  <input
                    type="text"
                    name="name"
                    defaultValue={tariff.name}
                    className="h-9 rounded-lg border border-slate-300 px-3 text-sm font-bold text-[#060b27] outline-none focus:border-[#0875d1]"
                  />
                </label>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                <StatusBadge status={tariff.active ? "active" : "archive"} />
                <Link href="/tarify" className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 transition hover:border-blue-200 hover:text-[#0875d1]">
                  Проверить
                </Link>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_auto_auto] sm:items-end">
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
                  placeholder="Разовое действие"
                  defaultValue={tariff.durationDays ?? ""}
                  className="h-9 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-800 outline-none focus:border-[#0875d1]"
                />
              </label>
              <label className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-700">
                <input type="checkbox" name="active" value="1" defaultChecked={tariff.active} className="h-4 w-4 accent-[#0875d1]" />
                Активен
              </label>
              <button type="submit" className="inline-flex h-9 items-center justify-center rounded-lg bg-[#0875d1] px-3 text-xs font-bold text-white transition hover:bg-[#0664b3]">
                Сохранить
              </button>
            </div>
          </form>
        ))}
      </div>
    </section>
  );
}

export function AdminTariffsPage() {
  const tariffs = getTariffs();
  const activeTariffs = tariffs.filter((tariff) => tariff.active);
  const archivedTariffs = tariffs.length - activeTariffs.length;
  const minPrice = tariffs.reduce((min, tariff) => Math.min(min, tariff.price), Number.POSITIVE_INFINITY);
  const rows = adminPaymentRows().map((payment) => ({
    ...payment,
    href: `/oplata/${payment.id}`,
    editHref: "/admin/tariffs#payments",
    statusHref: "/admin/tariffs#payments",
  }));

  return (
    <Shell title="Тарифы" description="Тарифная сетка действий: публикации, вакансии, реклама, отклики и ярмарка." eyebrow="Администрирование" createHref={null}>
      <AdminGuardedContent>
        <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          <MetricCard icon={<CheckCircle2 className="h-5 w-5" />} label="Активные" value={String(activeTariffs.length)} detail="Доступны пользователям для оплаты." />
          <MetricCard icon={<WalletCards className="h-5 w-5" />} label="Всего тарифов" value={String(tariffs.length)} detail={`${archivedTariffs} в архиве.`} />
          <MetricCard icon={<Banknote className="h-5 w-5" />} label="Минимальная цена" value={`${Number.isFinite(minPrice) ? minPrice : 0} ₽`} detail="Среди текущих тарифов." />
        </div>
        <TariffEditorSection
          tariffs={tariffs}
          intro="Изменения применяются к публичным тарифам, оплате и кабинету."
        />
        <section id="payments" className="mt-8 scroll-mt-24">
          <SectionTitle title="История платежей" />
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
        </section>
      </AdminGuardedContent>
    </Shell>
  );
}

export async function AdminFairApplicationsPage() {
  const applications = await listStoredFairApplications();
  const rows = applications.map((application) => ({
    ...application,
    statusTargetId: application.id,
    statusEntityType: "fairApplication",
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
  const createHref = isDemoAdminBypassEnabled() ? "/razmestit?admin=1" : "/razmestit";

  return (
    <Shell title={title} description={description} eyebrow="Администрирование" createHref={createHref}>
      <AdminGuardedContent>
        <DataTable rows={rows} columns={columns} />
      </AdminGuardedContent>
    </Shell>
  );
}
