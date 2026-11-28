"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { AdminPasskeyClientError, adminPasskeys } from "@/lib/client-admin-passkey";

export function AdminPasskeyEnrollmentForm() {
  const current = useRef<AbortController | null>(null);
  const codeField = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => () => current.current?.abort(), []);

  async function enroll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (current.current) return;
    const form = event.currentTarget;
    const code = codeField.current?.value.trim() ?? "";
    form.reset();
    setNotice("");
    if (!/^[A-Za-z0-9_-]{43}$/.test(code)) {
      setError("Введите одноразовый код, полученный от оператора.");
      return;
    }
    const controller = new AbortController();
    current.current = controller;
    setBusy(true);
    setError("");
    try {
      await adminPasskeys.enroll(code, controller.signal);
      if (!controller.signal.aborted) setNotice("Ключ администратора зарегистрирован.");
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof AdminPasskeyClientError
        ? cause.message : "Регистрация ключа не завершилась. Для повторной попытки обратитесь к оператору.");
    } finally {
      current.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <form method="post" onSubmit={enroll} aria-label="Регистрация ключа администратора" aria-busy={busy} className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="font-bold text-slate-950">Ключ администратора</h2>
      <label className="mt-3 block text-sm font-semibold text-slate-700">
        Одноразовый код от оператора
        <input ref={codeField} type="password" autoComplete="off" required maxLength={64} disabled={busy}
          className="mt-1 block min-h-11 w-full max-w-sm rounded-lg border border-slate-300 px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600" />
      </label>
      <button type="submit" disabled={busy} className="mt-3 min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-bold text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-50">
        {busy ? "Ждём подтверждения…" : "Зарегистрировать ключ"}
      </button>
      {error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
      {notice && <p role="status" className="mt-3 text-sm text-slate-800">{notice}</p>}
    </form>
  );
}
