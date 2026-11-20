"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { LocalAccountForm } from "./LocalAccountForm";

export function ProductionLoginForm() {
  const router = useRouter();
  const finishLogin = useCallback((source: "login" | "session" = "login") => {
    const destinations = new URLSearchParams(window.location.search).getAll("returnTo");
    const payment = destinations.length === 1 && /^\/oplata\/([a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12})(?:\?type=(vacancy|workRequest|application|specialist))?$/.exec(destinations[0]);
    const destination = payment ? "/oplata/" + payment[1] + (payment[2] ? "?type=" + payment[2] : "") : "/";
    if (source === "login") router.replace(destination);
    // A failed session check can leave the shared auth provider unavailable until a fresh document loads.
    else if (payment) window.location.replace(destination);
  }, [router]);
  return <LocalAccountForm production onLoginVerified={finishLogin} />;
}
