"use client";

import { ReactNode, useEffect, useState } from "react";
import { AuthForm } from "@/components/auth/AuthForm";
import { useAuthState } from "@/components/auth/useAuthState";

type PublicationAuthGateProps = {
  children: ReactNode;
  title?: string;
};

export function PublicationAuthGate({ children, title = "Войдите, чтобы разместить публикацию" }: PublicationAuthGateProps) {
  const { state } = useAuthState();
  const [returnHref, setReturnHref] = useState("/cabinet");

  useEffect(() => {
    setReturnHref(`${window.location.pathname}${window.location.search}`);
  }, []);

  if (state === "signed-in" || state === "admin") {
    return <>{children}</>;
  }

  if (state === "loading") {
    return (
      <main className="page-container py-10">
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm font-semibold text-slate-600 shadow-card">
          Проверяем вход...
        </div>
      </main>
    );
  }

  return (
    <main className="page-container py-6 sm:py-10">
      <section className="mx-auto min-w-0 max-w-2xl">
        <div className="mb-5 rounded-xl border border-blue-100 bg-blue-50 p-4 sm:p-5">
          <h1 className="text-xl font-bold text-[#060b27] [overflow-wrap:anywhere] sm:text-2xl">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-700 [overflow-wrap:anywhere] sm:text-base sm:leading-7">
            Размещать объявления, вакансии, заказы и заявки могут только зарегистрированные пользователи. После входа вы вернетесь к этой форме.
          </p>
        </div>
        <AuthForm
          initialMessage="Зарегистрируйтесь или войдите, чтобы продолжить размещение."
          returnHref={returnHref}
          successLinkLabel="Вернуться к размещению"
          successMessage="Готово, возвращаю к размещению..."
        />
      </section>
    </main>
  );
}
