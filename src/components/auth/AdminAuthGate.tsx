"use client";

import Link from "next/link";
import { ReactNode } from "react";
import { useAdminAccess } from "@/components/auth/useAdminAccess";

export function AdminAuthGate({ children }: { children: ReactNode }) {
  const { state, message } = useAdminAccess();

  if (state === "admin") {
    return <>{children}</>;
  }

  if (state === "loading") {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm font-semibold text-slate-600 shadow-card">
        Проверяем права администратора...
      </div>
    );
  }

  const title = state === "signed-out" ? "Нужно войти" : "Доступ закрыт";
  const text =
    state === "signed-out"
      ? "Админка доступна только авторизованным администраторам."
      : state === "error"
        ? message
        : "У этого аккаунта нет роли администратора.";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-card">
      <h2 className="text-2xl font-black text-[#060b27]">{title}</h2>
      <p className="mt-3 leading-7 text-slate-600">{text}</p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link href="/auth" className="inline-flex h-11 items-center justify-center rounded-lg bg-[#0875d1] px-6 font-bold text-white">
          Войти
        </Link>
        <Link href="/cabinet" className="inline-flex h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-6 font-bold text-slate-700">
          В кабинет
        </Link>
      </div>
    </div>
  );
}
