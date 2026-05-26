import type React from "react";
import Link from "next/link";
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
  LockKeyhole,
  MessageSquare,
  PackageCheck,
  Plus,
  Settings2,
  ShieldCheck,
  Store,
  Tags,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { AdminAuthGate } from "@/components/auth/AdminAuthGate";
import { AuthForm } from "@/components/auth/AuthForm";
import { CabinetAuthGate } from "@/components/auth/CabinetAuthGate";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { MockPaymentButton } from "@/components/payments/MockPaymentButton";
import { SiteHeader } from "@/components/SiteHeader";
import { categories, fairApplications, professions, specialists, tariffs, vacancies } from "@/lib/data";

type StatusTone = "green" | "blue" | "amber" | "slate" | "red" | "violet";

type TableColumn<T> = {
  key: keyof T | string;
  label: string;
  render?: (row: T) => React.ReactNode;
};

const userListings = [
  { id: "OB-1842", title: "Детская кровать с матрасом", category: "Мебель", city: "Краснодар", district: "Фестивальный", coords: "45.056, 38.958", status: "published", views: 124 },
  { id: "OB-1843", title: "Набор инструментов для дома", category: "Товары", city: "Сочи", district: "Центральный", coords: "43.585, 39.723", status: "pending_payment", views: 18 },
  { id: "OB-1844", title: "Услуги сиделки на выходные", category: "Медицина", city: "Анапа", district: "12-й микрорайон", coords: "44.894, 37.316", status: "draft", views: 0 },
];

const responses = [
  { id: "OT-901", target: "Сантехник", from: "ООО РемДом", date: "24.05.2026", status: "sent" },
  { id: "OT-902", target: "Мастер ремонта квартир", from: "ИП Чернов", date: "22.05.2026", status: "viewed" },
  { id: "OT-903", target: "Клинер", from: "Clean Home", date: "21.05.2026", status: "paid" },
];

const payments = [
  { id: "PAY-2605-001", subject: "Размещение вакансии", amount: "499 ₽", method: "Карта", status: "paid" },
  { id: "PAY-2605-002", subject: "Отклик на вакансию", amount: "99 ₽", method: "Карта", status: "pending_payment" },
  { id: "PAY-2605-003", subject: "Размещение объявления", amount: "199 ₽", method: "Карта", status: "failed" },
];

const adminUsers = [
  { id: "U-1001", name: "Анна Петрова", role: "user", phone: "+7 861 000-11-01", status: "active" },
  { id: "U-1002", name: "Сергей Орлов", role: "organization", phone: "+7 861 000-11-02", status: "active" },
  { id: "U-1003", name: "Модератор", role: "admin", phone: "+7 861 000-11-03", status: "blocked" },
];

const adminPayments = payments.map((payment, index) => ({
  ...payment,
  user: index === 0 ? "Сергей Орлов" : index === 1 ? "Ирина Котова" : "Анна Петрова",
}));

const statusLabels: Record<string, string> = {
  active: "Активен",
  archive: "Архив",
  blocked: "Заблокирован",
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

const cabinetNav = [
  { href: "/cabinet", label: "Обзор", icon: Gauge },
  { href: "/cabinet/obyavleniya", label: "Объявления", icon: FileText },
  { href: "/cabinet/vakansii", label: "Вакансии", icon: BriefcaseBusiness },
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
  { href: "/admin/payments", label: "Платежи", icon: Banknote },
  { href: "/admin/fair-applications", label: "Ярмарка", icon: Store },
];

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
    <Link href={href} className={`inline-flex h-11 items-center justify-center gap-2 rounded-lg px-5 text-sm font-bold transition ${classes[tone]}`}>
      {children}
    </Link>
  );
}

function Shell({
  title,
  description,
  eyebrow,
  nav,
  children,
}: {
  title: string;
  description: string;
  eyebrow: string;
  nav?: typeof cabinetNav;
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      <main className="page-container py-6 sm:py-10">
        <p className="text-xs font-bold uppercase tracking-wide text-[#0aa337] sm:text-sm">{eyebrow}</p>
        <div className="mt-2 flex flex-col gap-4 sm:mt-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-black leading-tight text-[#060b27] sm:text-5xl">{title}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 sm:mt-3 sm:text-lg sm:leading-7">{description}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-3">
            <ActionLink href="/cabinet/oplata" tone="plain">
              <CreditCard className="h-4 w-4" />
              Тарифы
            </ActionLink>
            <ActionLink href="/blizhniy/sozdat" tone="green">
              <Plus className="h-4 w-4" />
              Создать
            </ActionLink>
            {nav ? <LogoutButton /> : null}
          </div>
        </div>
        {nav ? <NavPills items={nav} /> : null}
        <div className="mt-5 sm:mt-7">{children}</div>
      </main>
    </>
  );
}

function NavPills({ items }: { items: typeof cabinetNav }) {
  return (
    <nav className="mt-5 flex gap-2 overflow-x-auto pb-1 sm:mt-7" aria-label="Разделы">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            href={item.href}
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition hover:border-blue-200 hover:text-[#0875d1] sm:h-11 sm:px-4 sm:text-sm"
            key={item.href}
          >
            <Icon className="h-4 w-4" />
            {item.label}
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
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-5">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm font-bold text-slate-500">{label}</p>
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-[#0875d1] sm:h-10 sm:w-10">{icon}</span>
      </div>
      <p className="mt-3 text-2xl font-black text-[#060b27] sm:mt-4 sm:text-3xl">{value}</p>
      <p className="mt-2 text-sm leading-6 text-slate-600">{detail}</p>
    </article>
  );
}

function DataTable<T extends Record<string, unknown>>({ columns, rows }: { columns: TableColumn<T>[]; rows: T[] }) {
  function getActionHref(row: T) {
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

    if (id.startsWith("APP-")) {
      return "/cabinet/otkliki";
    }

    if (id.startsWith("fair-")) {
      return "/cabinet/fair-applications";
    }

    return String(row.href ?? row.editHref ?? "/cabinet");
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
                  <div className="flex flex-wrap gap-2">
                    <Link href={getActionHref(row)} className="inline-flex h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700">
                      Открыть
                    </Link>
                    <Link href={getActionHref(row)} className="inline-flex h-9 items-center rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-[#0875d1]">
                      Изменить
                    </Link>
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
    <main className="min-h-screen bg-slate-50">
      <div className="page-container grid min-h-screen gap-10 py-8 lg:grid-cols-[minmax(0,1fr)_460px] lg:items-center">
        <section>
          <Link href="/" className="inline-flex items-center gap-3" aria-label="БЛИЖНИЙ, главная">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-card" aria-hidden="true">
              <span className="text-2xl font-black text-[#0875d1]">Б</span>
            </span>
            <span className="text-3xl font-black italic tracking-normal text-[#0a1437]">БЛИЖНИЙ</span>
          </Link>
          <p className="mt-10 text-sm font-bold uppercase tracking-wide text-[#0aa337]">Аккаунт</p>
          <h1 className="mt-3 max-w-3xl text-5xl font-black leading-tight text-[#060b27]">Вход и регистрация</h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">
            Создайте аккаунт или войдите, чтобы размещать объявления, вакансии, анкеты специалистов и управлять публикациями.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <MetricCard icon={<LockKeyhole className="h-5 w-5" />} label="Вход" value="Email" detail="Авторизация по email и паролю." />
            <MetricCard icon={<ShieldCheck className="h-5 w-5" />} label="Права" value="Роли" detail="Обычный пользователь или администратор." />
            <MetricCard icon={<BadgeCheck className="h-5 w-5" />} label="Доступ" value="Кабинет" detail="Публикации, анкеты, отклики и оплаты." />
          </div>
        </section>
        <AuthForm />
      </div>
    </main>
  );
}

export function CabinetPage() {
  return (
    <Shell title="Личный кабинет" description="Панель пользователя для публикаций, откликов, анкеты специалиста и оплат." eyebrow="Кабинет" nav={cabinetNav}>
      <CabinetAuthGate>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={<FileText className="h-5 w-5" />} label="Объявления" value="3" detail="1 ждет оплату, 1 черновик." />
          <MetricCard icon={<BriefcaseBusiness className="h-5 w-5" />} label="Вакансии" value="3" detail="Публикации из раздела работы." />
          <MetricCard icon={<MessageSquare className="h-5 w-5" />} label="Отклики" value="3" detail="Последняя активность 24.05.2026." />
          <MetricCard icon={<CreditCard className="h-5 w-5" />} label="Баланс оплат" value="798 ₽" detail="Сумма активных тарифов." />
        </div>
        <div className="mt-8 grid gap-8 xl:grid-cols-2">
          <section>
            <SectionTitle title="Последние объявления" actionHref="/cabinet/obyavleniya" actionLabel="Все объявления" />
            <DataTable
              rows={userListings}
              columns={[
                { key: "title", label: "Название" },
                { key: "category", label: "Категория" },
                { key: "status", label: "Статус", render: (row) => <StatusBadge status={String(row.status)} /> },
              ]}
            />
          </section>
          <section>
            <SectionTitle title="Последние оплаты" actionHref="/cabinet/oplata" actionLabel="История" />
            <DataTable
              rows={payments}
              columns={[
                { key: "id", label: "Платеж" },
                { key: "subject", label: "Назначение" },
                { key: "status", label: "Статус", render: (row) => <StatusBadge status={String(row.status)} /> },
              ]}
            />
          </section>
        </div>
      </CabinetAuthGate>
    </Shell>
  );
}

export function CabinetListingsPage() {
  return (
    <Shell title="Мои объявления" description="Статусы публикаций, просмотры и быстрые действия по объявлениям пользователя." eyebrow="Кабинет" nav={cabinetNav}>
      <DataTable
        rows={userListings}
        columns={[
          { key: "id", label: "ID" },
          { key: "title", label: "Название" },
          { key: "category", label: "Категория" },
          { key: "city", label: "Город" },
          { key: "views", label: "Просмотры" },
          { key: "status", label: "Статус", render: (row) => <StatusBadge status={String(row.status)} /> },
        ]}
      />
    </Shell>
  );
}

export function CabinetVacanciesPage() {
  return (
    <Shell title="Мои вакансии" description="Список вакансий работодателя с оплатой публикации и управлением статусом." eyebrow="Кабинет" nav={cabinetNav}>
      <DataTable
        rows={vacancies as unknown as Record<string, unknown>[]}
        columns={[
          { key: "organization", label: "Компания" },
          { key: "title", label: "Вакансия" },
          { key: "city", label: "Город" },
          { key: "salary", label: "Зарплата" },
          { key: "status", label: "Статус", render: (row) => <StatusBadge status={String(row.status)} /> },
        ]}
      />
    </Shell>
  );
}

export function CabinetSpecialistPage() {
  const profile = specialists[0];

  return (
    <Shell title="Анкета специалиста" description="Профиль исполнителя с услугами, контактами, статусом проверки и будущей публикацией." eyebrow="Кабинет" nav={cabinetNav}>
      <section className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-card">
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-blue-50 text-4xl font-black text-[#0875d1]">{profile.name.slice(0, 1)}</div>
          <h2 className="mt-5 text-2xl font-black text-[#060b27]">{profile.name}</h2>
          <p className="mt-1 font-bold text-[#0875d1]">{profile.profession}</p>
          <p className="mt-3 leading-7 text-slate-600">{profile.skills}</p>
          <div className="mt-4">
            <StatusBadge status={profile.status} />
          </div>
        </article>
        <div className="grid gap-4 md:grid-cols-2">
          <MetricCard icon={<PackageCheck className="h-5 w-5" />} label="Стоимость" value={profile.price} detail="Показывается в карточке специалиста." />
          <MetricCard icon={<ShieldCheck className="h-5 w-5" />} label="Проверка" value="80%" detail="Контакты заполнены, фото можно добавить позже." />
          <MetricCard icon={<MessageSquare className="h-5 w-5" />} label="Каналы связи" value="2" detail="Телефон и мессенджер в анкете." />
          <MetricCard icon={<CreditCard className="h-5 w-5" />} label="Публикация" value="Активна" detail="Оплата для анкеты может быть добавлена тарифом." />
        </div>
      </section>
    </Shell>
  );
}

export function CabinetOrganizationPage() {
  return (
    <Shell title="Профиль организации" description="Профиль заказчика с публичным адресом, координатами и контактами для вакансий." eyebrow="Кабинет" nav={cabinetNav}>
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-card">
        <h2 className="text-2xl font-black text-[#060b27]">ООО РемДом</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {[
            ["Регион", "Краснодарский край"],
            ["Город", "Краснодар"],
            ["Район", "Центральный округ"],
            ["Точный адрес", "ул. Красная, 118"],
            ["Широта", "45.037"],
            ["Долгота", "38.975"],
          ].map(([label, value]) => (
            <label className="grid gap-2 text-sm font-bold text-slate-700" key={label}>
              {label}
              <input className="h-11 rounded-lg border border-slate-300 px-3 font-normal outline-none focus:border-[#0875d1]" defaultValue={value} />
            </label>
          ))}
        </div>
        <p className="mt-5 rounded-lg bg-blue-50 p-4 text-sm leading-6 text-slate-700">
          Для организаций и вакансий точный адрес можно показывать публично. Внутреннюю маршрутизацию сайт не строит, кнопка маршрута ведет во внешний сервис карт.
        </p>
      </section>
    </Shell>
  );
}

export function CabinetResponsesPage() {
  return (
    <Shell title="Мои отклики" description="Отклики на вакансии со статусами оплаты, отправки и просмотра работодателем." eyebrow="Кабинет" nav={cabinetNav}>
      <DataTable
        rows={responses}
        columns={[
          { key: "id", label: "ID" },
          { key: "target", label: "Вакансия" },
          { key: "from", label: "Работодатель" },
          { key: "date", label: "Дата" },
          { key: "status", label: "Статус", render: (row) => <StatusBadge status={String(row.status)} /> },
        ]}
      />
    </Shell>
  );
}

export function CabinetPaymentsPage() {
  return (
    <Shell title="Оплата и тарифы" description="Тарифы публикаций, история платежей и переход к оплате заказа." eyebrow="Кабинет" nav={cabinetNav}>
      <section className="grid gap-4 md:grid-cols-3">
        {tariffs.map((tariff) => (
          <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-card" key={tariff.id}>
            <h2 className="text-xl font-black text-[#060b27]">{tariff.name}</h2>
            <p className="mt-3 text-3xl font-black text-[#0875d1]">{tariff.price} ₽</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">{tariff.durationDays ? `${tariff.durationDays} дней размещения` : "Разовое действие"}</p>
            <Link href={`/blizhniy/oplata/${tariff.id}`} className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-lg bg-[#0aa337] font-bold text-white">
              Оплатить
            </Link>
          </article>
        ))}
      </section>
      <section className="mt-8">
        <SectionTitle title="История платежей" />
        <DataTable
          rows={payments}
          columns={[
            { key: "id", label: "Платеж" },
            { key: "subject", label: "Назначение" },
            { key: "amount", label: "Сумма" },
            { key: "method", label: "Метод" },
            { key: "status", label: "Статус", render: (row) => <StatusBadge status={String(row.status)} /> },
          ]}
        />
      </section>
    </Shell>
  );
}

export function CabinetFairApplicationsPage() {
  return (
    <Shell title="Заявки на ярмарку" description="Заявки пользователя на участие в Ярмарке мастеров, статусы оплаты и публикации." eyebrow="Кабинет" nav={cabinetNav}>
      <CabinetAuthGate>
        <DataTable
          rows={fairApplications as unknown as Record<string, unknown>[]}
          columns={[
            { key: "id", label: "ID" },
            { key: "participantName", label: "Участник" },
            { key: "category", label: "Категория" },
            { key: "city", label: "Город" },
            { key: "paymentStatus", label: "Оплата", render: (row) => <StatusBadge status={String(row.paymentStatus)} /> },
            { key: "status", label: "Статус", render: (row) => <StatusBadge status={String(row.status)} /> },
          ]}
        />
        <Link href="/yarmarka-masterov/zayavka" className="mt-6 inline-flex h-12 items-center justify-center rounded-xl bg-[#0aa337] px-7 font-bold text-white">
          Подать новую заявку
        </Link>
      </CabinetAuthGate>
    </Shell>
  );
}

export function FakePaymentPage({ paymentId }: { paymentId?: string }) {
  const tariff = tariffs.find((item) => item.id === paymentId) ?? tariffs[0];

  return (
    <Shell title="Оплата заказа" description="Проверьте заказ, выберите способ оплаты и подтвердите платеж." eyebrow="Оплата">
      <section className="grid gap-8 lg:grid-cols-[1fr_420px]">
        <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-card">
          <h2 className="text-2xl font-black text-[#060b27]">Заказ {paymentId ?? tariff.id}</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <MetricCard icon={<WalletCards className="h-5 w-5" />} label="Тариф" value={tariff.name} detail="Заказ сформирован." />
            <MetricCard icon={<Banknote className="h-5 w-5" />} label="Сумма" value={`${tariff.price} ₽`} detail="Фиксированная стоимость." />
            <MetricCard icon={<CheckCircle2 className="h-5 w-5" />} label="Статус" value="Ожидает оплаты" detail="После оплаты публикация обновит статус." />
          </div>
          <div className="mt-6 rounded-xl bg-slate-50 p-5">
            <p className="font-bold text-slate-700">Способы оплаты</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="flex h-12 items-center justify-center rounded-lg border border-blue-200 bg-white font-bold text-[#0875d1]">Банковская карта</div>
              <div className="flex h-12 items-center justify-center rounded-lg border border-slate-300 bg-white font-bold text-slate-700">Счет для бизнеса</div>
            </div>
          </div>
        </article>
        <aside className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-6 shadow-card">
          <ShieldCheck className="h-10 w-10 text-[#0aa337]" />
          <h2 className="mt-4 text-2xl font-black text-[#060b27]">Подтверждение оплаты</h2>
          <p className="mt-3 leading-7 text-slate-700">После подтверждения заказ получит статус «Оплата прошла», а публикация будет обновлена.</p>
          <MockPaymentButton tariffId={tariff.id} returnHref="/cabinet/oplata" />
        </aside>
      </section>
    </Shell>
  );
}

export function AdminPage() {
  return (
    <Shell title="Админка" description="Панель модерации пользователей, контента, классификаторов, тарифов и платежей." eyebrow="Администрирование">
      <AdminGuardedContent>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={<UsersRound className="h-5 w-5" />} label="Пользователи" value="3" detail="Роли user, organization, admin." />
          <MetricCard icon={<ClipboardList className="h-5 w-5" />} label="Публикации" value="9" detail="Объявления, вакансии, анкеты." />
          <MetricCard icon={<WalletCards className="h-5 w-5" />} label="Тарифы" value={String(tariffs.length)} detail="Все тарифы активны." />
          <MetricCard icon={<Banknote className="h-5 w-5" />} label="Платежи" value="3" detail="Есть успешный, ожидающий и ошибка." />
        </div>
        <div className="mt-8 grid gap-8 xl:grid-cols-2">
          <section>
            <SectionTitle title="Очередь модерации" actionHref="/admin/obyavleniya" actionLabel="Все объявления" />
            <DataTable
              rows={userListings}
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
              rows={adminPayments}
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
  return (
    <AdminTablePage
      title="Пользователи"
      description="Учетные записи, роли, телефоны и модерационные действия."
      rows={adminUsers}
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
      rows={userListings}
      columns={[
        { key: "id", label: "ID" },
        { key: "title", label: "Название" },
        { key: "category", label: "Категория" },
        { key: "city", label: "Город" },
        { key: "district", label: "Район/адрес" },
        { key: "coords", label: "Координаты" },
        { key: "status", label: "Статус", render: (row) => <StatusBadge status={String(row.status)} /> },
      ]}
    />
  );
}

export function AdminVacanciesPage() {
  return (
    <AdminTablePage
      title="Вакансии"
      description="Рабочие публикации компаний и заказчиков в административном виде."
      rows={vacancies as unknown as Record<string, unknown>[]}
      columns={[
        { key: "id", label: "ID" },
        { key: "organization", label: "Компания" },
        { key: "title", label: "Вакансия" },
        { key: "city", label: "Город" },
        { key: "address", label: "Точный адрес" },
        { key: "coords", label: "Координаты", render: (row) => [row.lat, row.lng].filter(Boolean).join(", ") },
        { key: "status", label: "Статус", render: (row) => <StatusBadge status={String(row.status)} /> },
      ]}
    />
  );
}

export function AdminSpecialistsPage() {
  return (
    <AdminTablePage
      title="Специалисты"
      description="Анкеты исполнителей, профессии, города и статусы публикации."
      rows={specialists as unknown as Record<string, unknown>[]}
      columns={[
        { key: "id", label: "ID" },
        { key: "name", label: "Имя" },
        { key: "profession", label: "Профессия" },
        { key: "city", label: "Город" },
        { key: "district", label: "Зона" },
        { key: "coords", label: "Координаты", render: (row) => [row.lat, row.lng].filter(Boolean).join(", ") },
        { key: "status", label: "Статус", render: (row) => <StatusBadge status={String(row.status)} /> },
      ]}
    />
  );
}

export function AdminCategoriesPage() {
  return (
    <AdminTablePage
      title="Категории"
      description="Рубрикатор объявлений с дочерними разделами для модерации каталога."
      rows={categories.map((category) => ({ ...category, id: category.slug, childrenText: category.children.join(", "), status: "active" }))}
      columns={[
        { key: "name", label: "Категория" },
        { key: "slug", label: "Slug" },
        { key: "childrenText", label: "Подразделы" },
        { key: "status", label: "Статус", render: (row) => <StatusBadge status={String(row.status)} /> },
      ]}
    />
  );
}

export function AdminClassifierPage() {
  return (
    <AdminTablePage
      title="Классификатор специалистов"
      description="Профессии специалистов, родительские группы и активность в каталоге."
      rows={professions.map((profession) => ({ ...profession, id: profession.slug, status: profession.active ? "active" : "archive" }))}
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
  return (
    <AdminTablePage
      title="Тарифы"
      description="Тарифная сетка действий: публикации, вакансии и платные отклики."
      rows={tariffs.map((tariff) => ({ ...tariff, id: tariff.id, priceText: `${tariff.price} ₽`, status: tariff.active ? "active" : "archive" }))}
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
  return (
    <AdminTablePage
      title="Платежи"
      description="История платежей с суммами, пользователями и статусами."
      rows={adminPayments}
      columns={[
        { key: "id", label: "ID" },
        { key: "user", label: "Пользователь" },
        { key: "subject", label: "Назначение" },
        { key: "amount", label: "Сумма" },
        { key: "status", label: "Статус", render: (row) => <StatusBadge status={String(row.status)} /> },
      ]}
    />
  );
}

export function AdminFairApplicationsPage() {
  return (
    <AdminTablePage
      title="Заявки на ярмарку"
      description="Административный список заявок участников Ярмарки мастеров."
      rows={fairApplications as unknown as Record<string, unknown>[]}
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
    <Shell title={title} description={description} eyebrow="Администрирование">
      <AdminGuardedContent>
        <DataTable rows={rows} columns={columns} />
      </AdminGuardedContent>
    </Shell>
  );
}
