"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { LocalAccountForm } from "./LocalAccountForm";

export function ProductionLoginForm() {
  const router = useRouter();
  const openHome = useCallback(() => { router.replace("/"); }, [router]);
  return <LocalAccountForm production onLoginVerified={openHome} />;
}
