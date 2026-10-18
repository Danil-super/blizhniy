"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { productionAccount, openAccountAuthChannel } from "@/lib/local-account";
import { createAccountSessionState } from "@/lib/account-session-state";
import type { AccountAuthSnapshot } from "@/lib/account-session-state";

const Context = createContext<AccountAuthSnapshot | null>(null);
export function usePrimaryAccountAuth() { return useContext(Context); }

function PrimaryAccountAuth({ children, available }: { children: ReactNode; available: boolean }) {
  const [store] = useState(() => createAccountSessionState(productionAccount.session));
  const [snapshot, setSnapshot] = useState<AccountAuthSnapshot>({ state: available ? "loading" : "unavailable", userId: null });
  useEffect(() => {
    if (!available) return;
    const unsubscribe = store.subscribe(setSnapshot);
    const refresh = () => { void store.refresh(); };
    const visibility = () => { if (document.visibilityState === "visible") refresh(); };
    const pageshow = (event: PageTransitionEvent) => { if (event.persisted) refresh(); };
    const begin = () => store.beginChange();
    const end = () => { void store.endChange(); };
    const channel = openAccountAuthChannel();
    if (channel) channel.onmessage = event => {
      if (event.data && typeof event.data === "object" && event.data.type === "changed") refresh();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("pageshow", pageshow);
    window.addEventListener("blizhniy-account-changing", begin);
    window.addEventListener("blizhniy-account-changed", end);
    document.addEventListener("visibilitychange", visibility);
    refresh();
    return () => {
      unsubscribe(); store.stop(); channel?.close();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("pageshow", pageshow);
      window.removeEventListener("blizhniy-account-changing", begin);
      window.removeEventListener("blizhniy-account-changed", end);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [available, store]);
  return <Context.Provider value={snapshot}>{children}</Context.Provider>;
}

export function AccountAuthProvider({ backend, children }: { backend: "legacy" | "postgres" | "unavailable"; children: ReactNode }) {
  if (backend === "legacy") return children;
  return <PrimaryAccountAuth key={backend} available={backend === "postgres"}>{children}</PrimaryAccountAuth>;
}
