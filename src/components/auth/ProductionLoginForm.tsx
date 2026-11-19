"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { LocalAccountForm } from "./LocalAccountForm";

export function ProductionLoginForm() {
  const router = useRouter();
  const finishLogin = useCallback(() => {
    const destinations = new URLSearchParams(window.location.search).getAll("returnTo");
    const payment = destinations.length === 1 && /^\/oplata\/([a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12})(?:\?type=(vacancy|workRequest|application|specialist))?$/.exec(destinations[0]);
    const destination = payment ? "/oplata/" + payment[1] + (payment[2] ? "?type=" + payment[2] : "") : "/";
    router.replace(destination);
  }, [router]);
  return <LocalAccountForm production onLoginVerified={finishLogin} />;
}
