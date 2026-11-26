import type React from "react";
import Link from "next/link";
import {BriefcaseBusiness,CircleUserRound,ClipboardList,FileText,MessageSquare,Plus,Store} from "lucide-react";
import {SiteHeader} from "@/components/SiteHeader";
import {CabinetShellActions} from "@/components/cabinet/CabinetShellActions";
import {CabinetProfileBar} from "@/components/cabinet/CabinetProfileBar";

export const cabinetNav = [
  { href: "/cabinet/obyavleniya", label: "Мои объявления", icon: FileText },
  { href: "/cabinet/vakansii", label: "Вакансии", icon: BriefcaseBusiness },
  { href: "/cabinet/zakazy", label: "Заказы", icon: ClipboardList },
  { href: "/cabinet/specialist", label: "Анкета", icon: CircleUserRound },
  { href: "/cabinet/otkliki", label: "Отклики", icon: MessageSquare },
  { href: "/cabinet/bronirovaniya", label: "Бронирования", icon: ClipboardList },
  { href: "/cabinet/fair-applications", label: "Ярмарка", icon: Store },
];

export function ActionLink({ href, children, tone = "blue" }: { href: string; children: React.ReactNode; tone?: "blue" | "green" | "plain" }) {
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

export function Shell({
  title,
  description,
  eyebrow,
  nav,
  activeHref,
  createHref = "/razmestit",
  createLabel = "Создать",
  notice,
  children,
}: {
  title: string;
  description: string;
  eyebrow: string;
  nav?: typeof cabinetNav;
  activeHref?: string;
  createHref?: string | null;
  createLabel?: string;
  notice?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      <main className={`page-container dashboard-shell pt-6 sm:pt-10 ${nav === cabinetNav ? "pb-16 sm:pb-20" : "pb-6 sm:pb-10"}`}>
        <p className="text-xs font-bold uppercase tracking-wide text-[#0aa337] sm:text-sm">{eyebrow}</p>
        <div className="mt-2 flex flex-col gap-4 sm:mt-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold leading-tight text-[#060b27] sm:text-4xl">{title}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 [overflow-wrap:anywhere] sm:mt-3 sm:text-lg sm:leading-7">{description}</p>
          </div>
          {nav!==cabinetNav&&<div className={nav ? "grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-3" : "grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:gap-3"}>
            {nav ? (
              <CabinetShellActions createHref={createHref} createLabel={createLabel} />
            ) : createHref ? (
              <ActionLink href={createHref} tone="green">
                <Plus className="h-4 w-4" />
                {createLabel}
              </ActionLink>
            ) : null}
          </div>}
        </div>
        {nav ? <NavPills items={nav} activeHref={activeHref} /> : null}
        {nav === cabinetNav ? <CabinetProfileBar /> : null}
        <div className="mt-5 sm:mt-7">{notice}{children}</div>
      </main>
    </>
  );
}

export function NavPills({ items, activeHref }: { items: typeof cabinetNav; activeHref?: string }) {
  return (
    <nav className="mt-5 grid grid-cols-2 gap-2 pb-1 min-[430px]:grid-cols-3 sm:mt-7 sm:flex sm:flex-wrap sm:overflow-visible sm:pb-0" aria-label="Разделы">
      {items===cabinetNav&&<CabinetShellActions mode="create" createHref="/razmestit"/>}
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.href === activeHref;
        return (
          <Link
            href={item.href}
            className={`inline-flex min-h-10 w-full max-w-full items-center justify-start gap-2 rounded-lg border px-3 py-2 text-xs font-bold leading-snug transition sm:min-h-11 sm:w-auto sm:min-w-[9.5rem] sm:flex-none sm:px-4 sm:text-sm ${
              active ? "border-blue-200 bg-blue-50 text-[#0664b3] ring-1 ring-blue-100" : "border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:text-[#0875d1]"
            }`}
            aria-current={active ? "page" : undefined}
            key={item.href}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="min-w-0 break-words">{item.label}</span>
          </Link>
        );
      })}
      {items===cabinetNav&&<CabinetShellActions mode="logout"/>}
    </nav>
  );
}
