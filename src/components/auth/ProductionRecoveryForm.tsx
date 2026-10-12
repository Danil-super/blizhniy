"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { notifyAccountSessionChange } from "@/lib/local-account";

const inputStyle = "mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-brand-ink focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue";
const invalidLink = "Ссылка недействительна или устарела. Запросите новое письмо восстановления.";
const issues: Record<string, string> = {
  INVALID_RECOVERY: invalidLink,
  INVALID_INPUT: "Проверьте email и пароль: пароль должен содержать от 15 до 128 символов.",
  CAPTCHA_REQUIRED: "Повторите проверку безопасности.",
  RATE_LIMITED: "Слишком много попыток. Подождите 15 минут и попробуйте снова.",
};

export function ProductionRecoveryForm({ mode }: { mode: "recover" | "reset" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(mode === "recover");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaVersion, setCaptchaVersion] = useState(0);
  const mounted = useRef(false), initialized = useRef(false), version = useRef(0), busyRef = useRef(false);
  const alert = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    mounted.current = true;
    const invalidate = () => { version.current++; };
    const readLink = () => {
      version.current++;
      const value = new URLSearchParams(window.location.hash.slice(1)).get("token");
      window.history.replaceState(null, "", window.location.pathname);
      const valid = Boolean(value && /^[a-f0-9]{64}$/.test(value));
      setToken(valid ? value : null); setIssue(valid ? "" : invalidLink); setReady(true); setDone(false);
      setPassword(""); setRepeat(""); setCaptchaToken(""); setCaptchaVersion(value => value + 1);
    };
    if (mode === "reset") {
      if (!initialized.current) { initialized.current = true; readLink(); }
      window.addEventListener("hashchange", readLink);
    }
    return () => { mounted.current = false; invalidate(); window.removeEventListener("hashchange", readLink); };
  }, [mode]);
  useEffect(() => { if (issue) alert.current?.focus(); }, [issue]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current || !captchaToken || (mode === "reset" && !token)) return;
    setIssue("");
    if (mode === "reset" && ([...password].length < 15 || [...password].length > 128)) { setIssue(issues.INVALID_INPUT); return; }
    if (mode === "reset" && password !== repeat) { setIssue("Пароли не совпадают."); return; }
    const current = version.current;
    busyRef.current = true; setBusy(true);
    if (mode === "reset") notifyAccountSessionChange(true);
    try {
      const response = await fetch(`/api/account/${mode}`, { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
        signal: AbortSignal.timeout(10000), headers: { "Content-Type": "application/json", "X-Blizhniy-Request": "1" },
        body: JSON.stringify(mode === "recover" ? { email, captchaToken } : { token, password, captchaToken }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload?.error?.code === "string" ? payload.error.code : "AUTH_UNAVAILABLE");
      if (response.status !== (mode === "recover" ? 202 : 200) || Object.keys(payload).length !== 1 || payload.status !== (mode === "recover" ? "accepted" : "password_reset")) throw new Error("AUTH_UNAVAILABLE");
      if (mounted.current && current === version.current) { setDone(true); setToken(null); setPassword(""); setRepeat(""); }
    } catch (error) {
      if (mounted.current && current === version.current) setIssue(error instanceof Error && Object.hasOwn(issues, error.message) ? issues[error.message] : "Результат запроса не подтверждён. Проверьте входящие или вход в аккаунт; при необходимости запросите новое письмо.");
    } finally {
      if (mode === "reset") notifyAccountSessionChange(false);
      busyRef.current = false;
      if (mounted.current) { setBusy(false); setCaptchaToken(""); setCaptchaVersion(value => value + 1); }
    }
  }

  return <>
    <h1 className="text-2xl font-bold text-brand-ink">{mode === "recover" ? "Восстановление доступа" : "Новый пароль"}</h1>
    <p role="status" className="mt-3 text-sm leading-6 text-slate-600">{!ready ? "Подготавливаем ссылку…" : busy ? "Обрабатываем запрос…" : done ? mode === "recover" ? "Если аккаунт подтверждён, мы отправим письмо восстановления. Проверьте входящие и папку «Спам»." : "Пароль изменён. Предыдущие сессии закрыты. Войдите с новым паролем." : mode === "recover" ? "Введите email, указанный при регистрации." : "Открытие ссылки не меняет пароль. Задайте новый пароль и отправьте форму."}</p>
    {issue && <p ref={alert} role="alert" tabIndex={-1} className="mt-5 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">{issue}</p>}
    {!done && ready && (mode === "recover" || token) && <form onSubmit={submit} aria-busy={busy} className="mt-6 space-y-5">
      {mode === "recover" ? <label className="block font-semibold text-brand-ink">Email
        <input type="email" required autoComplete="email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} className={inputStyle} />
      </label> : <>
        <label className="block font-semibold text-brand-ink">Новый пароль
          <input type="password" required autoComplete="new-password" minLength={15} maxLength={256} value={password} onChange={event => setPassword(event.target.value)} aria-describedby="reset-password-help" className={inputStyle} />
        </label>
        <p id="reset-password-help" className="text-sm text-slate-600">15–128 символов. Пробелы сохраняются без изменения.</p>
        <label className="block font-semibold text-brand-ink">Повторите пароль
          <input type="password" required autoComplete="new-password" maxLength={256} value={repeat} onChange={event => setRepeat(event.target.value)} className={inputStyle} />
        </label>
      </>}
      <TurnstileWidget requireProvider onVerify={setCaptchaToken} resetKey={captchaVersion} />
      <button type="submit" disabled={busy || !captchaToken} className="min-h-11 w-full rounded-xl bg-brand-blue px-5 py-3 font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue disabled:cursor-wait disabled:opacity-60">{mode === "recover" ? "Отправить письмо восстановления" : "Сохранить новый пароль"}</button>
    </form>}
  </>;
}
