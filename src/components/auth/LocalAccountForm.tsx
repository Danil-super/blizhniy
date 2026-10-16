"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { LocalAccountError, localAccount, productionAccount, notifyAccountSessionChange, openAccountAuthChannel } from "@/lib/local-account";
import type { LocalAccountUser } from "@/lib/local-account";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import Link from "next/link";
import { isValidAccountPassword, PASSWORD_MIN_LENGTH } from "@/lib/account-validation";
import { PasswordField } from "./PasswordField";

type View = { kind: "checking" | "anonymous" | "switch" | "unavailable" } | { kind: "active"; user: LocalAccountUser };
const buttonStyle = "min-h-11 scroll-mb-28 rounded-xl bg-brand-blue px-5 py-3 font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue disabled:cursor-wait disabled:opacity-60";
const secondaryStyle = "min-h-11 rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-brand-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue disabled:opacity-60";
const inputStyle = "mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-brand-ink focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue";
const unavailable = "Не удалось подтвердить состояние сессии. Проверьте сессию ещё раз; успешный вход или выход не подтверждён.";
const errors: Record<string, string> = {
  INVALID_CREDENTIALS: "Неверный email или пароль, либо аккаунт ещё не подтверждён.",
  RATE_LIMITED: "Слишком много попыток. Подождите 15 минут и попробуйте снова.",
  INVALID_INPUT: "Проверьте email и пароль.",
  SYNTHETIC_EMAIL_REQUIRED: "На локальном стенде используйте адрес, заканчивающийся на .invalid.",
  CAPTCHA_REQUIRED: "Повторите проверку безопасности и отправьте форму ещё раз.",
};

export function LocalAccountForm({ production = false, headingLevel = "h1" }: { production?: boolean; headingLevel?: "h1" | "h2" } = {}) {
  const Heading = headingLevel;
  const account = production ? productionAccount : localAccount;
  const [view, setView] = useState<View>({ kind: "checking" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [issue, setIssue] = useState("");
  const [busy, setBusy] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const mounted = useRef(false);
  const version = useRef(0);
  const busyRef = useRef(false);
  const pendingCheck = useRef(false);
  const channel = useRef<BroadcastChannel | null>(null);
  const alert = useRef<HTMLParagraphElement>(null);
  const clearIdentity = useCallback(() => { setView({ kind: "checking" }); setEmail(""); setPassword(""); setIssue(""); }, []);
  const reconcile = useCallback(async () => {
    const current = ++version.current;
    clearIdentity();
    if (busyRef.current) { pendingCheck.current = true; return; }
    try {
      const user = await account.session();
      if (mounted.current && current === version.current) setView(user ? { kind: "active", user } : { kind: "anonymous" });
    } catch {
      if (mounted.current && current === version.current) { setView({ kind: "unavailable" }); setIssue(unavailable); }
    }
  }, [clearIdentity, account]);

  useEffect(() => {
    mounted.current = true;
    void reconcile();
    const focus = () => { void reconcile(); };
    const visibility = () => { if (document.visibilityState === "visible") void reconcile(); };
    const pageshow = (event: PageTransitionEvent) => { if (event.persisted) void reconcile(); };
    if (typeof BroadcastChannel !== "undefined") {
      channel.current = production ? openAccountAuthChannel() : new BroadcastChannel("blizhniy-local-auth");
      if (channel.current) channel.current.onmessage = (event: MessageEvent<unknown>) => {
        if (event.data && typeof event.data === "object" && "type" in event.data && event.data.type === "changed") void reconcile();
      };
    }
    window.addEventListener("focus", focus);
    window.addEventListener("pageshow", pageshow);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      mounted.current = false; version.current += 1;
      channel.current?.close(); channel.current = null;
      window.removeEventListener("focus", focus);
      window.removeEventListener("pageshow", pageshow);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [reconcile, production]);
  useEffect(() => { if (issue) alert.current?.focus(); }, [issue]);

  async function mutate(action: "login" | "logout") {
    if (busyRef.current) return;
    const previousForm = view.kind === "switch" ? "switch" : "anonymous";
    const current = ++version.current;
    busyRef.current = true; setBusy(true); clearIdentity();
    if (production) notifyAccountSessionChange(true);
    let completed = false;
    try {
      if (action === "login") await account.login(email, password, captchaToken);
      else await account.logout();
      completed = true;
    } catch (error) {
      if (mounted.current && current === version.current) {
        const message = error instanceof LocalAccountError ? errors[error.code] : undefined;
        setView({ kind: action === "login" && message ? previousForm : "unavailable" });
        setIssue(message ?? unavailable);
      }
    } finally {
      // No identity or credential is broadcast or persisted. Unknown commits also invalidate other tabs.
      if (production) notifyAccountSessionChange(false);
      else channel.current?.postMessage({ type: "changed" });
      busyRef.current = false;
      setCaptchaToken("");
      if (mounted.current) {
        setBusy(false);
        if (completed || pendingCheck.current) { pendingCheck.current = false; void reconcile(); }
      }
    }
  }
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
    if (!isValidAccountPassword(password)) { setIssue("Пароль должен содержать от 8 до 128 символов."); return; }
    if (production && !captchaToken) { setIssue(errors.CAPTCHA_REQUIRED); return; }
    void mutate("login");
  }
  const form = view.kind === "anonymous" || view.kind === "switch";
  return <div aria-busy={busy || view.kind === "checking"}>
    <Heading className="text-2xl font-bold text-brand-ink">{view.kind === "active" ? production ? "Ваш аккаунт" : "Локальный аккаунт" : view.kind === "switch" ? "Смена аккаунта" : "Вход"}</Heading>
    <p role="status" className="mt-3 text-sm leading-6 text-slate-600">{busy ? "Обрабатываем запрос…" : view.kind === "checking" ? "Проверяем сессию…" : form ? production ? "Войдите с email и паролем. Email должен быть подтверждён." : "Вход только для подтверждённого тестового аккаунта .invalid." : ""}</p>
    {issue && <p ref={alert} tabIndex={-1} role="alert" className="mt-5 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">{issue}</p>}
    {view.kind === "active" && <div className="mt-6 space-y-4">
      <p className="break-all font-semibold text-brand-ink">{view.user.email}</p>
      <p className="text-sm text-slate-600">{view.user.role === "admin" ? "Администратор" : "Пользователь"} · права проверяет сервер.</p>
      {production && <Link href="/cabinet" prefetch={false} className={`${buttonStyle} flex justify-center`}>Личный кабинет</Link>}
      <button type="button" className={`${secondaryStyle} w-full`} onClick={() => { version.current += 1; clearIdentity(); setView({ kind: "switch" }); }}>Сменить аккаунт</button>
    </div>}
    {form && <form onSubmit={onSubmit} className="mt-4 space-y-3">
      <label className="block font-semibold text-brand-ink">Email
        <input type="email" required autoComplete="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} className={inputStyle} placeholder={production ? "you@example.ru" : "test@example.invalid"} />
      </label>
      <PasswordField label="Пароль" value={password} onChange={setPassword} autoComplete="current-password" minLength={PASSWORD_MIN_LENGTH} />
      {production && <div className="-mx-3 flex justify-center sm:mx-0"><TurnstileWidget requireProvider size={headingLevel === "h1" ? "normal" : "compact"} inline onVerify={setCaptchaToken} /></div>}
      <button type="submit" disabled={busy || (production && !captchaToken)} className={`${buttonStyle} w-full`}>Войти</button>
      {view.kind === "switch" && <button type="button" disabled={busy} onClick={() => { void reconcile(); }} className={`${secondaryStyle} w-full`}>Отменить смену аккаунта</button>}
    </form>}
    {(view.kind === "active" || view.kind === "unavailable") && <div className="mt-5 flex flex-wrap gap-3">
      <button type="button" disabled={busy} onClick={() => { void reconcile(); }} className={`${secondaryStyle} flex-1`}>Проверить сессию</button>
      <button type="button" disabled={busy} onClick={() => { void mutate("logout"); }} className={`${secondaryStyle} flex-1`}>Выйти</button>
    </div>}
  </div>;
}
