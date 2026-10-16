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
  return <main className="mx-auto flex w-full justify-center px-2 py-4 sm:px-4 sm:py-8">
    <section className="w-full max-w-md self-start rounded-3xl border border-slate-200 bg-white p-3 shadow-soft sm:p-7" aria-label="Аккаунт БЛИЖНЕГО">
      <Link href="/" prefetch={false} aria-label="БЛИЖНИЙ — на главную" className="inline-flex min-h-11 items-center text-xl font-black italic tracking-tight text-[#198b2f]">БЛИЖНИЙ</Link>
      <div className="mt-3">
        {!available ? <><h1 className="text-2xl font-bold text-brand-ink">Аккаунт</h1><p role="alert" className="mt-3 text-sm text-slate-700">Сервис аккаунтов временно недоступен. Попробуйте позже.</p></> :
          mode === "login" ? <LocalAccountForm production /> :
          mode === "register" || mode === "confirm" ? <ProductionRegistrationForm mode={mode} /> :
          <ProductionRecoveryForm mode={mode} />}
      </div>
      <p className="mt-4 text-xs leading-5 text-slate-600">
        Для входа используется защищённый cookie сессии.{" "}
        <Link href="/legal/privacy" prefetch={false} className="text-brand-blue underline underline-offset-2">Политика конфиденциальности</Link>.
      </p>
      <nav aria-label="Авторизация" className="mt-5 flex flex-wrap items-center gap-x-3 border-t border-slate-100 pt-3">
        {mode === "register" ? <>
          <span className="text-sm text-slate-600">Уже есть аккаунт?</span>
          <Link href="/auth" prefetch={false} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-blue hover:underline">Вход в аккаунт</Link>
        </> : <>
        <Link href="/auth" prefetch={false} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-blue underline">Вход в аккаунт</Link>
        <Link href="/auth/register" prefetch={false} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-blue underline">Регистрация</Link>
        <Link href="/auth/recover" prefetch={false} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-blue underline">Забыли пароль?</Link>
        </>}
      </nav>
    </section>
  </main>;
}
