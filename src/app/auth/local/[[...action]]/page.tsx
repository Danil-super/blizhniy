import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { LocalRegistrationForm } from "@/components/auth/LocalRegistrationForm";
import { readLocalAuthConfig } from "@/lib/auth-http";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Локальная регистрация", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function Page({ params }: { params: Promise<{ action?: string[] }> }) {
  let enabled = false;
  try { enabled = Boolean(readLocalAuthConfig()); } catch { /* Never expose server config in a rendered error. */ }
  if (!enabled) notFound();
  const { action = [] } = await params;
  if (action.length > 1 || (action.length === 1 && action[0] !== "confirm")) notFound();
  return <main className="page-container flex justify-center py-8 md:py-12">
    <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-soft md:p-8" aria-label="Локальная идентификация">
      <Link href="/auth/local" prefetch={false} className="inline-flex min-h-11 items-center text-lg font-bold italic text-brand-ink">БЛИЖНИЙ</Link>
      <p className="mb-5 mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700">Локальный стенд · PostgreSQL · без внешней отправки писем. Это ещё не рабочая регистрация сайта.</p>
      <LocalRegistrationForm mode={action[0] === "confirm" ? "confirm" : "register"} />
    </section>
  </main>;
}
