import Link from "next/link";
import type { ReactNode } from "react";
import {
  BriefcaseBusiness,
  CircleUserRound,
  ClipboardList,
  CreditCard,
  FileText,
  Gauge,
  Megaphone,
  Store,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { AdminAuthGate } from "@/components/auth/AdminAuthGate";
import { SiteHeader } from "@/components/SiteHeader";

const adminNav = [
  { href: "/admin", label: "Обзор", icon: Gauge },
  { href: "/admin/users", label: "Пользователи", icon: UsersRound },
  { href: "/admin/obyavleniya", label: "Объявления", icon: FileText },
  { href: "/admin/vakansii", label: "Вакансии", icon: BriefcaseBusiness },
  { href: "/admin/zakazy", label: "Заказы", icon: ClipboardList },
  { href: "/admin/specialisty", label: "Специалисты", icon: CircleUserRound },
  { href: "/admin/tariffs", label: "Тарифы", icon: WalletCards },
  { href: "/admin/payments", label: "Платежи", icon: CreditCard },
  { href: "/admin/ad-marquee", label: "Бегущая строка", icon: Megaphone },
  { href: "/admin/fair-applications", label: "Ярмарка", icon: Store },
];

function AdminNavPills({ activeHref }: { activeHref: string }) {
  return (
    <nav
      className="mt-5 grid grid-flow-col grid-rows-2 gap-2 overflow-x-auto pb-1 [scrollbar-width:none] sm:mt-7 sm:flex sm:flex-wrap sm:overflow-visible sm:pb-0 [&::-webkit-scrollbar]:hidden"
      aria-label="Разделы админки"
    >
      {adminNav.map((item) => {
        const Icon = item.icon;
        const active = item.href === activeHref;

        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={`inline-flex min-h-10 w-[9.25rem] max-w-full items-center justify-start gap-2 rounded-lg border px-3 py-2 text-xs font-bold leading-snug transition sm:min-h-11 sm:w-auto sm:min-w-[9.5rem] sm:flex-none sm:px-4 sm:text-sm ${
              active ? "border-blue-200 bg-blue-50 text-[#0875d1] ring-1 ring-blue-100" : "border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:text-[#0875d1]"
            }`}
            href={item.href}
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

export function AdminShell({
  activeHref,
  children,
  description,
  title,
}: {
  activeHref: string;
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <>
      <SiteHeader />
      <main className="page-container dashboard-shell pb-6 pt-6 sm:pb-10 sm:pt-10">
        <p className="text-xs font-bold uppercase tracking-wide text-[#0aa337] sm:text-sm">Администрирование</p>
        <div className="mt-2 min-w-0 sm:mt-3">
          <h1 className="text-2xl font-bold leading-tight text-[#060b27] sm:text-4xl">{title}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 [overflow-wrap:anywhere] sm:mt-3 sm:text-lg sm:leading-7">{description}</p>
        </div>
        <AdminAuthGate>
          <AdminNavPills activeHref={activeHref} />
          <div className="mt-5 sm:mt-7">{children}</div>
        </AdminAuthGate>
      </main>
    </>
  );
}
