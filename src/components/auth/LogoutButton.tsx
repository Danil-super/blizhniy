"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { productionAccount, notifyAccountSessionChange } from "@/lib/local-account";
import { usePrimaryAccountAuth } from "@/components/auth/AccountAuthProvider";
import type { AccountAuthSnapshot } from "@/lib/account-session-state";

type LogoutState = "idle" | "loading" | "error";

export function LogoutButton() {
  const primary = usePrimaryAccountAuth();
  return primary ? <CookieLogoutButton snapshot={primary} /> : <LegacyLogoutButton />;
}

function CookieLogoutButton({ snapshot }: { snapshot: AccountAuthSnapshot }) {
  const router = useRouter();
  const busy = useRef(false);
  const [state, setState] = useState<LogoutState>("idle");
  async function handleLogout() {
    if (busy.current) return;
    busy.current = true; setState("loading"); notifyAccountSessionChange(true);
    try {
      await productionAccount.logout();
      setState("idle"); router.push("/auth"); router.refresh();
    } catch { setState("error"); }
    finally { busy.current = false; notifyAccountSessionChange(false); }
  }
  if (snapshot.state !== "signed-in" && snapshot.state !== "admin" && snapshot.state !== "unavailable" && state !== "loading") return null;
  return <>
    <LogoutControl state={state} onClick={handleLogout} />
    {state === "error" && <p role="alert" className="mt-2 text-sm text-red-800">Выход не подтверждён. Повторите попытку.</p>}
  </>;
}

function LegacyLogoutButton() {
  const router = useRouter();
  const [state, setState] = useState<LogoutState>("idle");
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let subscription: { unsubscribe: () => void } | null = null;

    try {
      const supabase = getSupabaseBrowserClient();

      supabase.auth.getSession().then(({ data }) => {
        setSignedIn(Boolean(data.session));
      });

      const authState = supabase.auth.onAuthStateChange((_event, session) => {
        setSignedIn(Boolean(session));
      });

      subscription = authState.data.subscription;
    } catch {
      setSignedIn(false);
    }

    return () => subscription?.unsubscribe();
  }, []);

  async function handleLogout() {
    setState("loading");

    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.signOut();

      if (error) {
        throw error;
      }

      setSignedIn(false);
      router.push("/auth");
      router.refresh();
    } catch {
      setState("error");
    }
  }

  if (!signedIn) {
    return null;
  }

  return <LogoutControl state={state} onClick={handleLogout} />;
}

function LogoutControl({ state, onClick }: { state: LogoutState; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={state === "loading"}
      className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-5 text-sm font-bold text-slate-800 transition hover:border-red-200 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      title={state === "error" ? "Не удалось выйти. Попробуйте еще раз." : undefined}
    >
      <LogOut className="h-4 w-4" />
      {state === "loading" ? "Выходим..." : "Выйти"}
    </button>
  );
}
