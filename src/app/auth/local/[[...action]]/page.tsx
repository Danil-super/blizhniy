import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { LocalRegistrationForm } from "@/components/auth/LocalRegistrationForm";
import { LocalAccountForm } from "@/components/auth/LocalAccountForm";
import { readLocalAuthConfig } from "@/lib/auth-http";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Локальный аккаунт", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function Page({ params }: { params: Promise<{ action?: string[] }> }) {
  let config;
  try { config = readLocalAuthConfig(); } catch { /* Never expose server config in a rendered error. */ }
  if (!config) notFound();
  const { action = [] } = await params;
  if (action.length > 1 || (action.length === 1 && !["confirm", "login"].includes(action[0]))) notFound();
  if (action[0] === "login" && !config.origin.startsWith("https://")) notFound();
  return <main className="page-container flex justify-center py-8 md:py-12">
    <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-soft md:p-8" aria-label="Локальная идентификация">
      <Link href="/auth/local" prefetch={false} className="inline-flex min-h-11 items-center text-lg font-bold italic text-brand-ink">БЛИЖНИЙ</Link>
      <p className="mb-5 mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700">Локальный стенд · PostgreSQL · без внешней отправки писем. Это ещё не рабочая регистрация сайта.</p>
      {action[0] === "login" ? <LocalAccountForm /> : <LocalRegistrationForm mode={action[0] === "confirm" ? "confirm" : "register"} />}
      <nav aria-label="Локальная авторизация" className="mt-6 flex flex-wrap gap-x-5">
        <Link href="/auth/local" prefetch={false} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-blue underline">Регистрация</Link>
        {config.origin.startsWith("https://") && <Link href="/auth/local/login" prefetch={false} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-blue underline">Вход в аккаунт</Link>}
      </nav>
    </section>
  </main>;
}
