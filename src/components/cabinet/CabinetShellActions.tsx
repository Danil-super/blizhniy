"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { useAuthState } from "@/components/auth/useAuthState";

type CabinetShellActionsProps = {
  createHref?: string | null;
  createLabel?: string;
};

export function CabinetShellActions({ createHref, createLabel = "Создать" }: CabinetShellActionsProps) {
  const { state } = useAuthState();

  if (state !== "signed-in" && state !== "admin") {
    return null;
  }

  return (
    <>
      {createHref ? (
        <Link href={createHref} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#0aa337] px-5 text-sm font-bold text-white transition hover:bg-[#078a2e] sm:w-auto">
          <Plus className="h-4 w-4" />
          {createLabel}
        </Link>
      ) : null}
      <LogoutButton />
    </>
  );
}
