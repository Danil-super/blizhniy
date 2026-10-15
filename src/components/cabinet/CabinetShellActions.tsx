"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { useAuthState } from "@/components/auth/useAuthState";
import { usePrimaryAccountAuth } from "@/components/auth/AccountAuthProvider";

type CabinetShellActionsProps = {
  createHref?: string | null;
  createLabel?: string;
};

export function CabinetShellActions({ createHref, createLabel = "Создать" }: CabinetShellActionsProps) {
  const { state } = useAuthState();
  const primary = usePrimaryAccountAuth();
  const signedIn = state === "signed-in" || state === "admin";

  if (!signedIn && !primary) {
    return null;
  }

  return (
    <>
      {primary && signedIn && <Link href="/cabinet/chernoviki" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-500 px-4 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
        Черновики объявлений
      </Link>}
      {signedIn && createHref ? (
        <Link href={createHref} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#0a7b2b] px-5 text-sm font-bold text-white transition hover:bg-[#066622] sm:w-auto">
          <Plus className="h-4 w-4" />
          {createLabel}
        </Link>
      ) : null}
      <LogoutButton />
    </>
  );
}
