import {SiteHeader} from "@/components/SiteHeader";
import {AuthForm} from "./LazyAuthForm";

export function AuthPage() {
  return (
    <>
      <SiteHeader />
      <main className="min-h-screen bg-slate-50">
        <h1 className="sr-only">Вход и регистрация</h1>
        <div className="page-container flex min-h-screen items-start justify-center py-5 sm:items-center sm:py-10">
          <div className="w-full max-w-[460px] min-w-0">
            <AuthForm />
          </div>
        </div>
      </main>
    </>
  );
}
