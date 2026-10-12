import Link from "next/link";
import { notFound } from "next/navigation";
import { readProductionAuthConfig } from "@/lib/production-auth-config";
import { ProductionRegistrationForm } from "./ProductionRegistrationForm";
import { LocalAccountForm } from "./LocalAccountForm";
import { ProductionRecoveryForm } from "./ProductionRecoveryForm";

export type ProductionAuthView = "login" | "register" | "confirm" | "recover" | "reset";

// Read and validate server configuration, but never serialize it into client props.
export function ProductionAuthPage({ mode }: { mode: ProductionAuthView }) {
  if (process.env.BLIZHNIY_AUTH_MODE !== "postgres") notFound();
  let available = false;
  try { available = Boolean(readProductionAuthConfig()); } catch { /* Only a generic message crosses the server boundary. */ }
  return <main className="page-container flex justify-center py-8 md:py-12">
    <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-soft md:p-8" aria-label="Аккаунт БЛИЖНЕГО">
      <Link href="/" prefetch={false} className="inline-flex min-h-11 items-center text-lg font-bold italic text-brand-ink">БЛИЖНИЙ</Link>
      <div className="mt-5">
        {!available ? <><h1 className="text-2xl font-bold text-brand-ink">Аккаунт</h1><p role="alert" className="mt-3 text-sm text-slate-700">Сервис аккаунтов временно недоступен. Попробуйте позже.</p></> :
          mode === "login" ? <LocalAccountForm production /> :
          mode === "register" || mode === "confirm" ? <ProductionRegistrationForm mode={mode} /> :
          <ProductionRecoveryForm mode={mode} />}
      </div>
      <nav aria-label="Авторизация" className="mt-6 flex flex-wrap gap-x-5">
        <Link href="/auth" prefetch={false} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-blue underline">Вход в аккаунт</Link>
        <Link href="/auth/register" prefetch={false} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-blue underline">Регистрация</Link>
        <Link href="/auth/recover" prefetch={false} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-blue underline">Забыли пароль?</Link>
      </nav>
    </section>
  </main>;
}
