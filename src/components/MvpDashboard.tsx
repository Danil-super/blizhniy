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
  Tags,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { categories, professions, specialists, tariffs, vacancies } from "@/lib/data";

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
  { id: "PAY-2605-002", subject: "Отклик на вакансию", amount: "99 ₽", method: "MockPay", status: "pending_payment" },
  { id: "PAY-2605-003", subject: "Размещение объявления", amount: "199 ₽", method: "Карта", status: "failed" },
];

const adminUsers = [
  { id: "U-1001", name: "Анна Петрова", role: "user", phone: "+7 861 000-11-01", status: "active" },
  { id: "U-1002", name: "Сергей Орлов", role: "business", phone: "+7 861 000-11-02", status: "active" },
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
  published: "Опубликовано",
  sent: "Отправлен",
  viewed: "Просмотрен",
};

const statusTones: Record<string, StatusTone> = {
  active: "green",
  archive: "slate",
  blocked: "red",
  draft: "slate",
  failed: "red",
  paid: "green",
  pending_payment: "amber",
  published: "blue",
  sent: "blue",
  viewed: "violet",
};

const cabinetNav = [
  { href: "/cabinet", label: "Обзор", icon: Gauge },
  { href: "/cabinet/obyavleniya", label: "Объявления", icon: FileText },
  { href: "/cabinet/vakansii", label: "Вакансии", icon: BriefcaseBusiness },
  { href: "/cabinet/organization", label: "Организация", icon: BadgeCheck },
  { href: "/cabinet/specialist", label: "Анкета", icon: CircleUserRound },
  { href: "/cabinet/otkliki", label: "Отклики", icon: MessageSquare },
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
      <main className="page-container py-8 sm:py-10">
        <p className="text-sm font-bold uppercase tracking-wide text-[#0aa337]">{eyebrow}</p>
        <div className="mt-3 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-4xl font-black leading-tight text-[#060b27] sm:text-5xl">{title}</h1>
            <p className="mt-3 max-w-3xl text-lg leading-7 text-slate-600">{description}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <ActionLink href="/cabinet/oplata" tone="plain">
              <CreditCard className="h-4 w-4" />
              Тарифы
            </ActionLink>
            <ActionLink href="/blizhniy/sozdat" tone="green">
              <Plus className="h-4 w-4" />
              Создать
            </ActionLink>
          </div>
        </div>
        {nav ? <NavPills items={nav} /> : null}
        <div className="mt-7">{children}</div>
      </main>
    </>
  );
}

function NavPills({ items }: { items: typeof cabinetNav }) {
  return (
    <nav className="mt-7 flex gap-2 overflow-x-auto pb-1" aria-label="Разделы">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            href={item.href}
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition hover:border-blue-200 hover:text-[#0875d1]"
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

function MetricCard({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm font-bold text-slate-500">{label}</p>
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-[#0875d1]">{icon}</span>
      </div>
      <p className="mt-4 text-3xl font-black text-[#060b27]">{value}</p>
      <p className="mt-2 text-sm leading-6 text-slate-600">{detail}</p>
    </article>
  );
}

function DataTable<T extends Record<string, unknown>>({ columns, rows }: { columns: TableColumn<T>[]; rows: T[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left">
          <thead className="bg-slate-50 text-sm text-slate-500">
            <tr>
              {columns.map((column) => (
                <th className="border-b border-slate-200 px-5 py-4 font-bold" key={String(column.key)}>
                  {column.label}
                </th>
              ))}
              <th className="border-b border-slate-200 px-5 py-4 font-bold">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, index) => (
              <tr className="text-sm text-slate-700" key={String(row.id ?? index)}>
                {columns.map((column) => (
                  <td className="px-5 py-4 align-middle" key={String(column.key)}>
                    {column.render ? column.render(row) : String(row[column.key] ?? "")}
                  </td>
                ))}
                <td className="px-5 py-4">
                  <div className="flex flex-wrap gap-2">
                    <button className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700">Открыть</button>
                    <button className="h-9 rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-[#0875d1]">Изменить</button>
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
      <main className="page-container grid gap-8 py-10 lg:grid-cols-[1fr_460px] lg:items-start">
        <section className="pt-4">
          <p className="text-sm font-bold uppercase tracking-wide text-[#0aa337]">Вход в MVP</p>
          <h1 className="mt-3 max-w-3xl text-5xl font-black leading-tight text-[#060b27]">Авторизация для публикаций и откликов</h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">
            Статическая форма показывает будущий сценарий: вход по телефону, проверка кода и переход в личный кабинет.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <MetricCard icon={<LockKeyhole className="h-5 w-5" />} label="Шаг 1" value="Телефон" detail="Пользователь вводит номер для входа." />
            <MetricCard icon={<ShieldCheck className="h-5 w-5" />} label="Шаг 2" value="Код" detail="Mock-код подтверждает демо-сессию." />
            <MetricCard icon={<BadgeCheck className="h-5 w-5" />} label="Шаг 3" value="Кабинет" detail="Дальше доступны публикации и оплаты." />
          </div>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-card">
          <h2 className="text-2xl font-black text-[#060b27]">Войти или зарегистрироваться</h2>
          <label className="mt-6 block">
            <span className="text-sm font-bold text-slate-600">Телефон</span>
            <input className="mt-2 h-12 w-full rounded-lg border border-slate-300 px-4 outline-none focus:border-[#0875d1]" placeholder="+7 900 000-00-00" />
          </label>
          <label className="mt-4 block">
            <span className="text-sm font-bold text-slate-600">Код из SMS</span>
            <input className="mt-2 h-12 w-full rounded-lg border border-slate-300 px-4 outline-none focus:border-[#0875d1]" placeholder="0000" />
          </label>
          <Link href="/cabinet" className="mt-6 inline-flex h-12 w-full items-center justify-center rounded-lg bg-[#0875d1] font-bold text-white">
            Продолжить в кабинет
          </Link>
          <p className="mt-4 text-sm leading-6 text-slate-500">Для MVP форма не отправляет данные и служит макетом будущего auth-flow.</p>
        </section>
      </main>
    </>
  );
}

export function CabinetPage() {
  return (
    <Shell title="Личный кабинет" description="Панель пользователя для публикаций, откликов, анкеты специалиста и оплат." eyebrow="Кабинет" nav={cabinetNav}>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={<FileText className="h-5 w-5" />} label="Объявления" value="3" detail="1 ждет оплату, 1 черновик." />
        <MetricCard icon={<BriefcaseBusiness className="h-5 w-5" />} label="Вакансии" value="3" detail="Публикации из раздела работы." />
        <MetricCard icon={<MessageSquare className="h-5 w-5" />} label="Отклики" value="3" detail="Последняя активность 24.05.2026." />
        <MetricCard icon={<CreditCard className="h-5 w-5" />} label="Баланс оплат" value="798 ₽" detail="Демо-сумма активных тарифов." />
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
    <Shell title="Мои вакансии" description="MVP-список вакансий работодателя с оплатой публикации и управлением статусом." eyebrow="Кабинет" nav={cabinetNav}>
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
          <MetricCard icon={<MessageSquare className="h-5 w-5" />} label="Каналы связи" value="2" detail="Телефон и мессенджер в демо-анкете." />
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
    <Shell title="Мои отклики" description="Отклики на вакансии с демо-статусами оплаты, отправки и просмотра работодателем." eyebrow="Кабинет" nav={cabinetNav}>
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
    <Shell title="Оплата и тарифы" description="Тарифы публикаций, история платежей и переход в fake payment flow." eyebrow="Кабинет" nav={cabinetNav}>
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

export function FakePaymentPage({ paymentId }: { paymentId?: string }) {
  const tariff = tariffs.find((item) => item.id === paymentId) ?? tariffs[0];

  return (
    <Shell title="Оплата заказа" description="Fake payment flow для MVP: пользователь видит заказ, выбирает способ и получает демо-успех." eyebrow="MockPay">
      <section className="grid gap-8 lg:grid-cols-[1fr_420px]">
        <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-card">
          <h2 className="text-2xl font-black text-[#060b27]">Заказ {paymentId ?? tariff.id}</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <MetricCard icon={<WalletCards className="h-5 w-5" />} label="Тариф" value={tariff.name} detail="Демо-покупка без реального списания." />
            <MetricCard icon={<Banknote className="h-5 w-5" />} label="Сумма" value={`${tariff.price} ₽`} detail="Фиксированная стоимость MVP." />
            <MetricCard icon={<CheckCircle2 className="h-5 w-5" />} label="Статус" value="Готов" detail="После нажатия считаем оплату успешной." />
          </div>
          <div className="mt-6 rounded-xl bg-slate-50 p-5">
            <p className="font-bold text-slate-700">Способы оплаты</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <button className="h-12 rounded-lg border border-blue-200 bg-white font-bold text-[#0875d1]">Банковская карта</button>
              <button className="h-12 rounded-lg border border-slate-300 bg-white font-bold text-slate-700">Счет для бизнеса</button>
            </div>
          </div>
        </article>
        <aside className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-6 shadow-card">
          <ShieldCheck className="h-10 w-10 text-[#0aa337]" />
          <h2 className="mt-4 text-2xl font-black text-[#060b27]">Демо-результат</h2>
          <p className="mt-3 leading-7 text-slate-700">Кнопка ниже имитирует успешную оплату и возвращает пользователя в историю платежей.</p>
          <Link href="/cabinet/oplata" className="mt-6 inline-flex h-12 w-full items-center justify-center rounded-lg bg-[#0aa337] font-bold text-white">
            Оплатить и вернуться
          </Link>
        </aside>
      </section>
    </Shell>
  );
}

export function AdminPage() {
  return (
    <Shell title="Админка" description="MVP-панель модерации пользователей, контента, классификаторов, тарифов и платежей." eyebrow="Администрирование" nav={adminNav}>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={<UsersRound className="h-5 w-5" />} label="Пользователи" value="3" detail="Роли user, business, admin." />
        <MetricCard icon={<ClipboardList className="h-5 w-5" />} label="Публикации" value="9" detail="Объявления, вакансии, анкеты." />
        <MetricCard icon={<WalletCards className="h-5 w-5" />} label="Тарифы" value={String(tariffs.length)} detail="Все тарифы активны в MVP." />
        <MetricCard icon={<Banknote className="h-5 w-5" />} label="Платежи" value="3" detail="Есть успешный, ожидающий и ошибка." />
      </div>
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
      description="История fake payment flow с суммами, пользователями и статусами."
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
    <Shell title={title} description={description} eyebrow="Администрирование" nav={adminNav}>
      <DataTable rows={rows} columns={columns} />
    </Shell>
  );
}
