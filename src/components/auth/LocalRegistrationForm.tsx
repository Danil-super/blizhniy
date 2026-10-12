"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { FormEvent, ReactNode } from "react";
import { REGISTRATION_LEGAL_VERSIONS } from "@/lib/registration-legal";

const inputStyle = "mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-brand-ink focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue";
const buttonStyle = "min-h-11 rounded-xl bg-brand-blue px-5 py-3 font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue disabled:cursor-wait disabled:opacity-60";
const errors: Record<string, string> = {
  RATE_LIMITED: "Слишком много попыток. Подождите 15 минут и попробуйте снова.",
  INVALID_CONFIRMATION: "Ссылка недействительна или срок её действия истёк. Запросите новое письмо.",
  INVALID_INPUT: "Проверьте данные, пароль и отметки документов.",
  SYNTHETIC_EMAIL_REQUIRED: "На локальном стенде используйте тестовый адрес, заканчивающийся на .invalid.",
  AUTH_UNAVAILABLE: "Сервис временно недоступен. Попробуйте позже.",
  CAPTCHA_REQUIRED: "Повторите проверку безопасности и отправьте форму ещё раз.",
};

async function submit(action: "register" | "resend" | "confirm", body: unknown): Promise<void> {
  const response = await fetch(`/api/account/${action}`, { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
    signal: AbortSignal.timeout(10000), headers: { "Content-Type": "application/json", "X-Blizhniy-Request": "1" }, body: JSON.stringify(body) });
  const payload = await response.json();
  if (!response.ok) throw new Error(typeof payload?.error?.code === "string" ? payload.error.code : "AUTH_UNAVAILABLE");
  if (response.status !== (action === "confirm" ? 200 : 202) || !payload || typeof payload !== "object" ||
      Object.keys(payload).length !== 1 || payload.status !== (action === "confirm" ? "confirmed" : "accepted")) throw new Error("AUTH_UNAVAILABLE");
}

function readableError(error: unknown): string {
  return error instanceof Error ? errors[error.message] ?? "Не удалось связаться с сервисом. Повторите попытку." : errors.AUTH_UNAVAILABLE;
}

type RegistrationProps = { mode: "register" | "confirm"; production?: boolean; captcha?: ReactNode; captchaToken?: string; onCaptchaReset?: () => void };
export function LocalRegistrationForm({ mode, production = false, ...captcha }: RegistrationProps) {
  return mode === "confirm" ? <ConfirmationForm production={production} /> : <RegistrationForm production={production} {...captcha} />;
}

function RegistrationForm({ production, captcha, captchaToken = "", onCaptchaReset }: Omit<RegistrationProps, "mode">) {
  const [action, setAction] = useState<"register" | "resend">("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [agreement, setAgreement] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [issue, setIssue] = useState("");
  const [message, setMessage] = useState("");
  const alert = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (issue) alert.current?.focus(); }, [issue]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
    setIssue(""); setMessage("");
    if ([...password].length < 15 || [...password].length > 128) { setIssue("Пароль должен содержать от 15 до 128 символов."); return; }
    if (action === "register" && password !== repeat) { setIssue("Пароли не совпадают."); return; }
    if (action === "register" && (!agreement || !privacy)) { setIssue("Примите соглашение и подтвердите ознакомление с политикой."); return; }
    if (production && !captchaToken) { setIssue(errors.CAPTCHA_REQUIRED); return; }
    busyRef.current = true; setBusy(true);
    try {
      const body = action === "register" ? { email, password, acceptedAgreement: agreement, acknowledgedPrivacy: privacy,
        agreementVersion: REGISTRATION_LEGAL_VERSIONS.agreement, privacyVersion: REGISTRATION_LEGAL_VERSIONS.privacy } : { email, password };
      await submit(action, production ? { ...body, captchaToken } : body);
      setMessage(production ? "Если запрос подходит, мы отправим письмо на ваш email. Проверьте входящие и папку «Спам». Откройте ссылку и подтвердите email." : "Если запрос подходит, письмо доступно в локальном перехватчике. Откройте ссылку и нажмите подтверждение. Реальные письма не отправляются.");
      setPassword(""); setRepeat("");
    } catch (error) { setIssue(readableError(error)); }
    finally { busyRef.current = false; setBusy(false); onCaptchaReset?.(); }
  }

  return <>
    <h1 className="text-2xl font-bold text-brand-ink">{action === "register" ? "Регистрация" : "Повторное письмо"}</h1>
    <p className="mt-3 text-sm leading-6 text-slate-600">{action === "register" ? production ? "Создайте аккаунт. Для входа потребуется подтвердить email." : "Создайте тестовый аккаунт. Email и пароль сохраняются в локальной PostgreSQL." : "Введите email и исходный пароль неподтверждённого аккаунта. Это не восстановление забытого пароля."}</p>
    <form onSubmit={onSubmit} className="mt-6 space-y-5" aria-busy={busy}>
      <label className="block font-semibold text-brand-ink">Email
        <input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} className={inputStyle} placeholder={production ? "you@example.ru" : "test@example.invalid"} aria-describedby="local-email-help" />
      </label>
      <p id="local-email-help" className="text-sm text-slate-600">{production ? "Укажите действующий email для подтверждения и восстановления доступа." : "Только тестовые адреса .invalid; без внешней отправки."}</p>
      <label className="block font-semibold text-brand-ink">Пароль
        <input type="password" autoComplete={action === "register" ? "new-password" : "current-password"} required minLength={15} maxLength={256} value={password} onChange={(event) => setPassword(event.target.value)} className={inputStyle} aria-describedby="local-password-help" />
      </label>
      <p id="local-password-help" className="text-sm text-slate-600">15–128 символов. Пробелы сохраняются без изменения.</p>
      {action === "register" && <>
        <label className="block font-semibold text-brand-ink">Повторите пароль
          <input type="password" autoComplete="new-password" required maxLength={256} value={repeat} onChange={(event) => setRepeat(event.target.value)} className={inputStyle} />
        </label>
        <label className="flex min-h-11 items-start gap-3 text-sm leading-6 text-slate-700">
          <input type="checkbox" required checked={agreement} onChange={(event) => setAgreement(event.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-brand-blue" />
          <span>Принимаю <a href="/legal/agreement" target="_blank" rel="noopener noreferrer" className="underline">пользовательское соглашение</a> от {REGISTRATION_LEGAL_VERSIONS.agreement}.</span>
        </label>
        <label className="flex min-h-11 items-start gap-3 text-sm leading-6 text-slate-700">
          <input type="checkbox" required checked={privacy} onChange={(event) => setPrivacy(event.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-brand-blue" />
          <span>Ознакомлен с <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="underline">политикой обработки персональных данных</a> от {REGISTRATION_LEGAL_VERSIONS.privacy}.</span>
        </label>
      </>}
      {issue && <p ref={alert} tabIndex={-1} role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">{issue}</p>}
      <p role="status" className="text-sm leading-6 text-slate-700">{busy ? "Обрабатываем запрос…" : message}</p>
      {production && captcha}
      <button type="submit" disabled={busy || (production && !captchaToken)} className={`${buttonStyle} w-full`}>{busy ? "Подождите…" : action === "register" ? "Зарегистрироваться" : "Отправить повторное письмо"}</button>
      <button type="button" disabled={busy} onClick={() => { setAction(action === "register" ? "resend" : "register"); setIssue(""); setMessage(""); onCaptchaReset?.(); }} className="min-h-11 w-full rounded-xl px-3 text-sm font-semibold text-brand-blue underline focus-visible:outline focus-visible:outline-2">
        {action === "register" ? "Повторить письмо" : "Вернуться к регистрации"}
      </button>
    </form>
  </>;
}

function ConfirmationForm({ production }: { production: boolean }) {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const initialized = useRef(false);
  const linkVersion = useRef(0);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [issue, setIssue] = useState("");
  const alert = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const readLink = () => {
      linkVersion.current += 1;
      const value = new URLSearchParams(window.location.hash.slice(1)).get("token");
      window.history.replaceState(null, "", window.location.pathname);
      const valid = Boolean(value && /^[a-f0-9]{64}$/.test(value));
      setToken(valid ? value : null); setConfirmed(false);
      setIssue(valid ? "" : errors.INVALID_CONFIRMATION); setReady(true);
    };
    if (!initialized.current) { initialized.current = true; readLink(); }
    window.addEventListener("hashchange", readLink);
    return () => window.removeEventListener("hashchange", readLink);
  }, []);
  useEffect(() => { if (issue) alert.current?.focus(); }, [issue]);
  async function confirm() {
    if (!token || busyRef.current) return;
    const submittedVersion = linkVersion.current;
    busyRef.current = true; setBusy(true); setIssue("");
    try {
      await submit("confirm", { token });
      if (submittedVersion === linkVersion.current) { setConfirmed(true); setToken(null); }
    }
    catch (error) { if (submittedVersion === linkVersion.current) setIssue(readableError(error)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  return <>
    <h1 className="text-2xl font-bold text-brand-ink">Подтверждение email</h1>
    <p className="mt-3 text-sm leading-6 text-slate-600">Открытие письма не подтверждает аккаунт автоматически. Для подтверждения нажмите кнопку ниже.</p>
    <p role="status" className="mt-5 text-sm leading-6 text-slate-700">{confirmed ? production ? "Email подтверждён. Теперь можно войти в аккаунт." : "Email подтверждён. Теперь можно войти на HTTPS-стенде." : !ready ? "Подготавливаем ссылку…" : busy ? "Подтверждаем…" : ""}</p>
    {issue && <p ref={alert} tabIndex={-1} role="alert" className="mt-5 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">{issue}</p>}
    {!confirmed && token && <button type="button" disabled={busy} onClick={confirm} className={`${buttonStyle} mt-6 w-full`}>{busy ? "Подождите…" : "Подтвердить email"}</button>}
    <Link href={production ? "/auth/register" : "/auth/local"} prefetch={false} className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold text-brand-blue underline">Регистрация и повторное письмо</Link>
  </>;
}
