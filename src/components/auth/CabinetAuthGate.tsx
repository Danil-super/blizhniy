"use client";

import Link from "next/link";
import { ReactNode, useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type GateState = "loading" | "signed-in" | "signed-out" | "error";

export function CabinetAuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) {
          throw error;
        }

        setState(data.session ? "signed-in" : "signed-out");
      })
      .catch((error) => {
        setState("error");
        setMessage(error instanceof Error ? error.message : "Не удалось проверить сессию");
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setState(session ? "signed-in" : "signed-out");
    });

    return () => subscription.unsubscribe();
  }, []);

  if (state === "signed-in") {
    return <>{children}</>;
  }

  if (state === "loading") {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm font-semibold text-slate-600 shadow-card">
        Проверяем вход...
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-card">
      <h2 className="text-2xl font-black text-[#060b27]">Нужно войти</h2>
      <p className="mt-3 leading-7 text-slate-600">{state === "error" ? message : "Личный кабинет доступен после регистрации или входа."}</p>
      <Link href="/auth" className="mt-5 inline-flex h-11 items-center justify-center rounded-lg bg-[#0875d1] px-6 font-bold text-white">
        Войти или зарегистрироваться
      </Link>
    </div>
  );
}
