"use client";

import dynamic from "next/dynamic";

export const AuthForm = dynamic(() => import("./AuthForm").then(module => module.AuthForm), {
  loading: () => <p role="status" className="p-6 text-center text-sm text-slate-600">Загружаем форму входа…</p>,
});
