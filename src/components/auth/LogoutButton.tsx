"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type LogoutState = "idle" | "loading" | "error";

export function LogoutButton() {
  const router = useRouter();
  const [state, setState] = useState<LogoutState>("idle");
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    supabase.auth.getSession().then(({ data }) => {
      setSignedIn(Boolean(data.session));
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(Boolean(session));
    });

    return () => subscription.unsubscribe();
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

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={state === "loading"}
      className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-5 text-sm font-bold text-slate-800 transition hover:border-red-200 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60"
      title={state === "error" ? "Не удалось выйти. Попробуйте еще раз." : undefined}
    >
      <LogOut className="h-4 w-4" />
      {state === "loading" ? "Выходим..." : "Выйти"}
    </button>
  );
}
