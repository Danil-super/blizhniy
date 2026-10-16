"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import type { FormEvent, ReactNode } from "react";
import { REGISTRATION_LEGAL_VERSIONS } from "@/lib/registration-legal";
import { isValidAccountPassword, normalizeRegistrationName, PASSWORD_MIN_LENGTH } from "@/lib/account-validation";
import { PasswordField } from "./PasswordField";

const inputStyle = "mt-1.5 min-h-12 w-full rounded-xl border bg-slate-50/50 px-3.5 py-2.5 text-base text-brand-ink transition-colors hover:border-slate-400 focus:border-brand-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-blue/20";
const buttonStyle = "min-h-12 scroll-mb-28 rounded-xl bg-brand-blue px-5 py-3 font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue disabled:cursor-not-allowed disabled:opacity-60";
type Field = "name" | "email" | "password" | "repeat" | "agreement" | "privacy";
const errors: Record<string, string> = {
  RATE_LIMITED: "Слишком много попыток. Подождите 15 минут и попробуйте снова.",
  INVALID_CONFIRMATION: "Ссылка недействительна: уже использована, заменена новой или срок её действия истёк. Если почта уже подтверждена, просто войдите. Иначе запросите новое письмо с исходным паролем.",
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
  const id = useId();
  const [action, setAction] = useState<"register" | "resend">("register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [emailValid, setEmailValid] = useState(false);
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [agreement, setAgreement] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [issue, setIssue] = useState("");
  const [sent, setSent] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [attempted, setAttempted] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const validationIssue = useRef(false);
  const alert = useRef<HTMLParagraphElement>(null);
  const sentHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!issue) return;
    if (validationIssue.current) form.current?.querySelector<HTMLInputElement>('input[aria-invalid="true"]')?.focus();
    else alert.current?.focus();
  }, [issue, attempted]);
  useEffect(() => { if (sent) sentHeading.current?.focus(); }, [sent]);
  useEffect(() => {
    // A non-sensitive recovery entry point from an expired confirmation link.
    if (window.location.hash === "#resend") {
      setAction("resend");
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  const fieldErrors: Record<Field, string> = {
    name: normalizeRegistrationName(name) ? "" : "Укажите имя: от 1 до 120 символов.",
    email: !email.trim() ? "Введите email." : emailValid ? "" : "Введите email вида name@example.ru.",
    password: isValidAccountPassword(password) ? "" : "От 8 до 128 символов, не только пробелы.",
    repeat: !repeat ? "Повторите пароль." : repeat !== password ? "Пароли не совпадают." : "",
    agreement: agreement ? "" : "Примите пользовательское соглашение.",
    privacy: privacy ? "" : "Подтвердите ознакомление с политикой.",
  };
  const fieldError = (field: Field) => attempted || touched[field] ? fieldErrors[field] : "";
  const touch = (field: Field) => setTouched(previous => ({ ...previous, [field]: true }));
  const edit = () => { setIssue(""); validationIssue.current = false; };
  const errorText = (field: Field) => <p id={`${id}-${field}-error`} aria-hidden={!fieldError(field)} className="mt-1 min-h-5 text-xs leading-5 text-red-700">{fieldError(field) || "\u00a0"}</p>;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
    setIssue("");
    setAttempted(true);
    const fields: Field[] = action === "register" ? ["name", "email", "password", "repeat", "agreement", "privacy"] : ["email", "password"];
    const invalid = fields.find(field => fieldErrors[field]);
    validationIssue.current = Boolean(invalid);
    if (invalid) { setIssue(fieldErrors[invalid]); return; }
    const normalizedName = normalizeRegistrationName(name);
    if (production && !captchaToken) { setIssue(errors.CAPTCHA_REQUIRED); return; }
    busyRef.current = true; setBusy(true);
    try {
      const body = action === "register" ? { name: normalizedName, email, password, acceptedAgreement: agreement, acknowledgedPrivacy: privacy,
        agreementVersion: REGISTRATION_LEGAL_VERSIONS.agreement, privacyVersion: REGISTRATION_LEGAL_VERSIONS.privacy } : { email, password };
      await submit(action, production ? { ...body, captchaToken } : body);
      setPassword(""); setRepeat(""); setSent(true);
    } catch (error) {
      setIssue(error instanceof Error && Object.hasOwn(errors, error.message) ? readableError(error)
        : "Результат запроса не подтверждён. Проверьте почту: письмо могло уже прийти. Данные формы сохранены до ухода со страницы; автоматической повторной отправки нет.");
    }
    finally { busyRef.current = false; setBusy(false); onCaptchaReset?.(); }
  }

  function changeAction(next: "register" | "resend") {
    setAction(next); setSent(false); setIssue(""); setPassword(""); setRepeat(""); setTouched({}); setAttempted(false); onCaptchaReset?.();
  }

  if (sent) return <>
    <div aria-hidden="true" className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-brand-blue">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-6 w-6"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" /></svg>
    </div>
    <h1 ref={sentHeading} tabIndex={-1} className="text-2xl font-bold text-brand-ink">Проверьте почту</h1>
    <p role="status" className="mt-3 text-sm leading-6 text-slate-700">{production
      ? "Запрос принят. Если запрос подходит, мы отправим письмо для подтверждения email. Проверьте входящие и папку «Спам»."
      : "Запрос принят. Письмо доступно в локальном перехватчике, реальные письма не отправляются."}</p>
    <p className="mt-2 break-all font-semibold text-brand-ink">{email.trim()}</p>
    <ol className="mt-4 list-inside list-decimal space-y-2 text-sm leading-6 text-slate-700">
      <li>Откройте письмо и перейдите по ссылке.</li>
      <li>Нажмите «Подтвердить email» на открывшейся странице.</li>
      <li>Войдите с вашим email и паролем.</li>
    </ol>
    <p className="mt-3 text-sm leading-6 text-slate-600">Если почта уже подтверждена, повторное письмо не отправляется — перейдите к входу. Если аккаунт уже существует, повторная регистрация не меняет его данные. Забыли пароль? <Link href={production ? "/auth/recover" : "/auth/local/recover"} prefetch={false} className="font-semibold text-brand-blue underline">Восстановить доступ</Link>.</p>
    <Link href={production ? "/auth" : "/auth/local/login"} prefetch={false} className={`${buttonStyle} mt-5 flex justify-center`}>Перейти к входу</Link>
    <div className="mt-2 flex flex-wrap gap-x-4">
      <button type="button" onClick={() => changeAction("resend")} className="min-h-11 text-sm font-semibold text-brand-blue underline">Повторить письмо</button>
      <button type="button" onClick={() => changeAction("register")} className="min-h-11 text-sm font-semibold text-brand-blue underline">Изменить email</button>
    </div>
  </>;

  return <>
    <h1 className="text-[1.75rem] font-bold leading-tight tracking-tight text-brand-ink">{action === "register" ? "Регистрация" : "Повторное письмо"}</h1>
    <p className="mt-2 text-sm leading-6 text-slate-600">{action === "register" ? production ? "Создайте аккаунт и подтвердите email по письму." : "Создайте тестовый аккаунт. Данные сохраняются в локальной PostgreSQL." : "Введите email и исходный пароль неподтверждённого аккаунта. Если забыли пароль подтверждённого аккаунта, восстановите доступ."}</p>
    <form ref={form} onSubmit={onSubmit} onChange={edit} noValidate className="mt-5" aria-busy={busy}>
      <fieldset disabled={busy} className="min-w-0 space-y-2">
      {action === "register" && <div>
        <label htmlFor={`${id}-name`} className="block text-sm font-semibold text-brand-ink">Имя</label>
        <input id={`${id}-name`} type="text" autoComplete="given-name" required maxLength={120} value={name} onChange={event => setName(event.target.value)} onBlur={() => touch("name")}
          aria-invalid={fieldError("name") ? true : undefined} aria-describedby={fieldError("name") ? `${id}-name-error` : undefined}
          className={`${inputStyle} ${fieldError("name") ? "border-red-500" : "border-slate-300"}`} placeholder="Как к вам обращаться" />
        {errorText("name")}
      </div>}
      <div>
        <label htmlFor={`${id}-email`} className="block text-sm font-semibold text-brand-ink">Email</label>
        <input id={`${id}-email`} type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => {
          setEmail(event.target.value); setEmailValid(event.currentTarget.validity.valid && event.target.value.split("@")[1]?.includes(".") === true);
        }} onBlur={() => touch("email")}
          className={`${inputStyle} ${fieldError("email") ? "border-red-500" : "border-slate-300"}`} placeholder={production ? "name@example.ru" : "test@example.invalid"}
          aria-invalid={fieldError("email") ? true : undefined} aria-describedby="local-email-help" />
        <p id="local-email-help" className={`mt-1 min-h-5 text-xs leading-5 ${fieldError("email") ? "text-red-700" : "text-slate-600"}`}>{fieldError("email") || (production ? "Пришлём письмо для подтверждения." : "Только тестовые адреса .invalid; без внешней отправки.")}</p>
      </div>
      <PasswordField label="Пароль" value={password} onChange={setPassword} autoComplete={action === "register" ? "new-password" : "current-password"}
        minLength={PASSWORD_MIN_LENGTH} onBlur={() => touch("password")} error={fieldError("password")} />
      {action === "register" && <PasswordField label="Повторите пароль" value={repeat} onChange={setRepeat} autoComplete="new-password" toggleLabel="повтор пароля"
        onBlur={() => touch("repeat")} error={fieldError("repeat")} />}
      {action === "register" && <>
        <div><label className="flex min-h-11 items-start gap-2.5 text-xs leading-5 text-slate-600">
          <input type="checkbox" required checked={agreement} onChange={(event) => setAgreement(event.target.checked)} onBlur={() => touch("agreement")}
            aria-invalid={fieldError("agreement") ? true : undefined} aria-describedby={fieldError("agreement") ? `${id}-agreement-error` : undefined}
            className="mt-1 h-5 w-5 shrink-0 accent-brand-blue" />
          <span>Принимаю <a href="/legal/agreement" target="_blank" rel="noopener noreferrer" className="text-brand-blue underline underline-offset-2">пользовательское соглашение</a>.</span>
        </label>{fieldError("agreement") && errorText("agreement")}</div>
        <div><label className="flex min-h-11 items-start gap-2.5 text-xs leading-5 text-slate-600">
          <input type="checkbox" required checked={privacy} onChange={(event) => setPrivacy(event.target.checked)} onBlur={() => touch("privacy")}
            aria-invalid={fieldError("privacy") ? true : undefined} aria-describedby={fieldError("privacy") ? `${id}-privacy-error` : undefined}
            className="mt-1 h-5 w-5 shrink-0 accent-brand-blue" />
          <span>Ознакомлен с <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-brand-blue underline underline-offset-2">политикой обработки персональных данных</a>.</span>
        </label>{fieldError("privacy") && errorText("privacy")}</div>
      </>}
      {issue && <p ref={alert} tabIndex={-1} role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">{issue}</p>}
      <p role="status" className={busy ? "text-sm leading-5 text-slate-700" : "sr-only"}>{busy ? "Обрабатываем запрос…" : ""}</p>
      {production && captcha}
      <button type="submit" disabled={busy || (production && !captchaToken)} className={`${buttonStyle} w-full`}>{busy ? "Подождите…" : action === "register" ? "Зарегистрироваться" : "Отправить повторное письмо"}</button>
      {action === "resend" && <button type="button" disabled={busy} onClick={() => changeAction("register")} className="min-h-11 w-full rounded-xl px-3 text-sm font-semibold text-brand-blue underline focus-visible:outline focus-visible:outline-2">Вернуться к регистрации</button>}
      </fieldset>
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
    catch (error) {
      if (submittedVersion === linkVersion.current) {
        setIssue(readableError(error));
        if (error instanceof Error && error.message === "INVALID_CONFIRMATION") setToken(null);
      }
    }
    finally { busyRef.current = false; setBusy(false); }
  }
  return <>
    <h1 className="text-2xl font-bold text-brand-ink">Подтверждение email</h1>
    <p className="mt-3 text-sm leading-6 text-slate-600">{issue
      ? "Ссылка подтверждения используется один раз. Выберите дальнейшее действие ниже."
      : "Открытие письма не подтверждает аккаунт автоматически. Для подтверждения нажмите кнопку ниже."}</p>
    <p role="status" className="mt-5 text-sm leading-6 text-slate-700">{confirmed ? production ? "Email подтверждён. Теперь можно войти в аккаунт." : "Email подтверждён. Теперь можно войти на HTTPS-стенде." : !ready ? "Подготавливаем ссылку…" : busy ? "Подтверждаем…" : ""}</p>
    {issue && <p ref={alert} tabIndex={-1} role="alert" className="mt-5 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">{issue}</p>}
    {issue && <div className="mt-5 space-y-2">
      <Link href={production ? "/auth" : "/auth/local/login"} prefetch={false} className={`${buttonStyle} flex justify-center`}>Перейти к входу</Link>
      <div className="flex flex-wrap gap-x-4">
        <Link href={production ? "/auth/register#resend" : "/auth/local#resend"} prefetch={false} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-blue underline">Запросить новое письмо</Link>
        <Link href={production ? "/auth/recover" : "/auth/local/recover"} prefetch={false} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-blue underline">Восстановить доступ</Link>
      </div>
    </div>}
    {!confirmed && token && <button type="button" disabled={busy} onClick={confirm} className={`${buttonStyle} mt-6 w-full`}>{busy ? "Подождите…" : "Подтвердить email"}</button>}
    {confirmed && <Link href={production ? "/auth" : "/auth/local/login"} prefetch={false} className={`${buttonStyle} mt-5 flex justify-center`}>Перейти к входу</Link>}
    <Link href={production ? "/auth/register" : "/auth/local"} prefetch={false} className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold text-brand-blue underline">Вернуться к регистрации</Link>
  </>;
}
