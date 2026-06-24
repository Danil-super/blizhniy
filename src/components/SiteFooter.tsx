import Link from "next/link";
import { Mail } from "lucide-react";
import { BrandName } from "@/components/BrandName";

const footerLinks = [
  { href: "/o-proekte", label: "О проекте" },
  { href: "/kak-rabotaet", label: "Как работает" },
  { href: "/tarify", label: "Тарифы" },
  { href: "/rekvizity", label: "Реквизиты" },
];

const documentLinks = [
  { href: "/legal/offer", label: "Публичная оферта" },
  { href: "/legal/agreement", label: "Пользовательское соглашение" },
  { href: "/legal/privacy", label: "Политика обработки персональных данных" },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="site-footer-inner page-container grid gap-6 py-8 md:grid-cols-[1.1fr_2fr] md:items-start">
        <div>
          <Link href="/" className="text-lg font-black text-[#0a1437]">
            <BrandName />
          </Link>
          <p className="mt-3 max-w-md text-sm leading-6 text-slate-600">
            <BrandName /> — платформа объявлений, работы, специалистов и услуг рядом. Первый регион запуска — Краснодарский край.
          </p>
          <a href="mailto:prostova04@yandex.ru" className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-[#0875d1]">
            <Mail className="h-4 w-4" />
            prostova04@yandex.ru
          </a>
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          <nav className="grid gap-2 text-sm font-semibold text-slate-700" aria-label="Нижняя навигация">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Разделы</p>
            {footerLinks.map((link) => (
              <Link key={link.href} href={link.href} className="py-1 transition hover:text-[#0875d1]">
                {link.label}
              </Link>
            ))}
          </nav>
          <nav className="grid gap-2 text-sm font-semibold text-slate-700" aria-label="Документы">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Документы</p>
            {documentLinks.map((link) => (
              <Link key={link.href} href={link.href} className="py-1 transition hover:text-[#0875d1]">
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}
