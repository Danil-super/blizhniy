"use client";
import Link from "next/link";
import { useState } from "react";
import { usePrimaryAccountAuth } from "@/components/auth/AccountAuthProvider";
import { notifyAccountSessionChange } from "@/lib/local-account";
import { PrivateDraftWorkspace } from "./PrivateDraftWorkspace";

export function PrivateDraftsPanel() {
  const auth = usePrimaryAccountAuth();
  const owner = auth?.state === "signed-in" || auth?.state === "admin" ? auth.userId : null;
  const [scopeOwner, setScopeOwner] = useState(owner);
  // Rechecking the same identity must hide data without discarding unsaved input.
  // A confirmed sign-out or different identity destroys the entire old workspace.
  if (owner && owner !== scopeOwner) setScopeOwner(owner);
  if (auth?.state === "signed-out" && scopeOwner) setScopeOwner(null);
  const visible = owner !== null && owner === scopeOwner;
  return <section aria-label="Черновики объявлений">
    <p className="mt-2 text-slate-600">Сохраните текст, цену и фотографии, чтобы вернуться к ним позже.</p>
    {auth?.state === "unavailable" ? <div className="mt-5 rounded-lg border border-amber-500 bg-amber-50 p-4" role="alert">
      <p>Не удалось проверить вход. Черновики скрыты до повторной проверки.</p>
      <button type="button" className="mt-3 min-h-11 rounded-lg border border-slate-500 bg-white px-4 py-2 font-semibold" onClick={() => notifyAccountSessionChange(false)}>Повторить проверку входа</button>
    </div> : !visible && <p className="mt-5" role="status">{auth?.state === "signed-out" ? "Войдите в аккаунт, чтобы открыть свои черновики." : "Проверяем доступ к черновикам…"}</p>}
    {auth?.state === "signed-out" && <Link href="/auth" className="inline-flex min-h-11 items-center text-[#0875d1] underline">Войти в аккаунт</Link>}
    {scopeOwner && <PrivateDraftWorkspace key={scopeOwner} owner={scopeOwner} visible={visible} />}
  </section>;
}

export function PrivateDraftsPage() {
  return <main id="draft-workspace" className="mx-auto w-full max-w-5xl px-4 py-8 text-[#060b27]">
    <Link href="/cabinet" className="inline-flex min-h-11 items-center font-semibold text-[#0875d1] underline">Личный кабинет</Link>
    <h1 className="mt-3 text-2xl font-bold">Черновики объявлений</h1>
    <PrivateDraftsPanel />
  </main>;
}
