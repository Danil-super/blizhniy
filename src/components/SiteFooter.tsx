import Link from "next/link";
import { Mail } from "lucide-react";

const footerLinks = [
  { href: "/o-proekte", label: "О проекте" },
  { href: "/kak-rabotaet", label: "Как работает" },
  { href: "/tarify", label: "Тарифы" },
  { href: "/legal/user-agreement", label: "Пользовательское соглашение" },
  { href: "/legal/privacy", label: "Политика конфиденциальности" },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="site-footer-inner page-container grid gap-6 pt-8 md:grid-cols-[1.1fr_2fr] md:items-start">
        <div>
          <Link href="/blizhniy" className="text-lg font-black italic text-[#0a1437]">
            БЛИЖНИЙ
          </Link>
          <p className="mt-3 max-w-md text-sm leading-6 text-slate-600">
            БЛИЖНИЙ — платформа объявлений, работы, специалистов и услуг рядом. Первый регион запуска — Краснодарский край.
          </p>
          <a href="mailto:demo@blizhniy.local" className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-[#0875d1]">
            <Mail className="h-4 w-4" />
            demo@blizhniy.local
          </a>
        </div>
        <nav className="grid gap-2 text-sm font-semibold text-slate-700 sm:grid-cols-2 lg:grid-cols-3" aria-label="Нижняя навигация">
          {footerLinks.map((link) => (
            <Link key={link.href} href={link.href} className="py-1 transition hover:text-[#0875d1]">
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
