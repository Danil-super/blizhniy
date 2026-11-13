"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LogOut } from "lucide-react";
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

    let active = true;
    let sessionChanged = false;
    async function subscribe() {
      try {
        const { getSupabaseBrowserClient } = await import("@/lib/supabase-browser");
        if (!active) return;
        const supabase = getSupabaseBrowserClient();
        subscription = supabase.auth.onAuthStateChange((_event, session) => {
          sessionChanged = true;
          if (active) setSignedIn(Boolean(session));
        }).data.subscription;
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (active && !sessionChanged) setSignedIn(Boolean(data.session));
      } catch {
        if (active && !sessionChanged) setSignedIn(false);
      }
    }
    void subscribe();
    return () => { active = false; subscription?.unsubscribe(); };
  }, []);

  async function handleLogout() {
    setState("loading");

    try {
      const { getSupabaseBrowserClient } = await import("@/lib/supabase-browser");
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
