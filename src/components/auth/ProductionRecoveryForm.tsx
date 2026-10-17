"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { notifyAccountSessionChange, consumeAccountCaptchaResponse } from "@/lib/local-account";
import { isValidAccountPassword, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from "@/lib/account-validation";
import { PasswordField } from "./PasswordField";
import Link from "next/link";
import { useAccountCaptcha } from "./AccountCaptchaProvider";

const inputStyle = "mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-brand-ink focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue";
const invalidLink = "Ссылка недействительна или устарела. Запросите новое письмо восстановления.";
const issues: Record<string, string> = {
  INVALID_RECOVERY: invalidLink,
  INVALID_INPUT: "Проверьте email и пароль: пароль должен содержать от 8 до 128 символов.",
  CAPTCHA_REQUIRED: "Повторите проверку безопасности.",
  RATE_LIMITED: "Слишком много попыток. Подождите 15 минут и попробуйте снова.",
};

export function ProductionRecoveryForm({ mode }: { mode: "recover" | "reset" }) {
  const captchaHintId = useId();
  const remembered = useAccountCaptcha();
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
  const [touched, setTouched] = useState({ password: false, repeat: false });
  const [attempted, setAttempted] = useState(false);
  const mounted = useRef(false), initialized = useRef(false), version = useRef(0), busyRef = useRef(false);
  const alert = useRef<HTMLParagraphElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const validationIssue = useRef(false);
  const humanReady = remembered || Boolean(captchaToken);
  const passwordIssue = !password ? "Введите новый пароль." : [...password].length < PASSWORD_MIN_LENGTH ? "Не менее 8 символов."
    : [...password].length > PASSWORD_MAX_LENGTH ? "Не более 128 символов."
    : !isValidAccountPassword(password) ? "Пароль не должен состоять только из пробелов или содержать недопустимые символы." : "";
  const repeatIssue = !repeat ? "Повторите новый пароль." : repeat !== password ? "Пароли не совпадают." : "";
  const edit = (field: "password" | "repeat", value: string) => {
    if (field === "password") setPassword(value); else setRepeat(value);
    if (validationIssue.current) { validationIssue.current = false; setIssue(""); }
  };
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
      setTouched({ password: false, repeat: false }); setAttempted(false); validationIssue.current = false;
    };
    if (mode === "reset") {
      if (!initialized.current) { initialized.current = true; readLink(); }
      window.addEventListener("hashchange", readLink);
    }
    return () => { mounted.current = false; invalidate(); window.removeEventListener("hashchange", readLink); };
  }, [mode]);
  useEffect(() => {
    if (!issue) return;
    if (validationIssue.current) form.current?.querySelector<HTMLInputElement>('input[aria-invalid="true"]')?.focus();
    else alert.current?.focus();
  }, [issue, attempted]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current || (mode === "reset" && !token)) return;
    setIssue("");
    setAttempted(true);
    if (mode === "reset" && (passwordIssue || repeatIssue)) {
      validationIssue.current = true; setIssue(passwordIssue || repeatIssue); return;
    }
    validationIssue.current = false;
    if (!humanReady) { setIssue(issues.CAPTCHA_REQUIRED); return; }
    const current = version.current;
    busyRef.current = true; setBusy(true);
    if (mode === "reset") notifyAccountSessionChange(true);
    try {
      const response = await fetch(`/api/account/${mode}`, { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
        signal: AbortSignal.timeout(10000), headers: { "Content-Type": "application/json", "X-Blizhniy-Request": "1" },
        body: JSON.stringify(mode === "recover" ? { email, captchaToken } : { token, password, captchaToken }) });
      consumeAccountCaptchaResponse(response);
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
    {done && mode === "reset" && <Link href="/auth" prefetch={false} className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-brand-blue underline">Перейти к входу</Link>}
    {!done && ready && (mode === "recover" || token) && <form ref={form} key={token ?? mode} noValidate={mode === "reset"} onSubmit={submit} aria-busy={busy} className="mt-4 space-y-3">
      {mode === "recover" ? <label className="block font-semibold text-brand-ink">Email
        <input type="email" required autoComplete="email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} className={inputStyle} />
      </label> : <>
        <PasswordField label="Новый пароль" value={password} onChange={value => edit("password", value)} autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH}
          error={touched.password || attempted ? passwordIssue : undefined} onBlur={() => setTouched(previous => ({ ...previous, password: true }))} />
        <PasswordField label="Повторите пароль" value={repeat} onChange={value => edit("repeat", value)} autoComplete="new-password" toggleLabel="повтор пароля"
          error={touched.repeat || attempted ? repeatIssue : undefined} onBlur={() => setTouched(previous => ({ ...previous, repeat: true }))} />
      </>}
      {!humanReady && <p id={captchaHintId} role="status" className="text-sm leading-5 text-slate-600">Кнопка станет доступна после проверки безопасности. Если блок проверки не появился, нажмите «Повторить проверку».</p>}
      {!remembered && <div className="-mx-3 flex justify-center sm:mx-0"><TurnstileWidget requireProvider manualRetry size="normal" inline onVerify={setCaptchaToken} resetKey={captchaVersion} /></div>}
      <button type="submit" disabled={busy || !humanReady} aria-describedby={!humanReady ? captchaHintId : undefined} className="min-h-11 w-full scroll-mb-28 rounded-xl bg-brand-blue px-5 py-3 font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue disabled:cursor-not-allowed disabled:opacity-60">{mode === "recover" ? "Отправить письмо восстановления" : "Сохранить новый пароль"}</button>
    </form>}
  </>;
}
