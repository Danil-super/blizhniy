"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { FormEvent, ReactNode } from "react";
import { REGISTRATION_LEGAL_VERSIONS } from "@/lib/registration-legal";
import { isValidAccountPassword, normalizeRegistrationName, PASSWORD_MIN_LENGTH } from "@/lib/account-validation";
import { PasswordField } from "./PasswordField";

const inputStyle = "mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-brand-ink focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue";
const buttonStyle = "min-h-11 scroll-mb-28 rounded-xl bg-brand-blue px-5 py-3 font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue disabled:cursor-wait disabled:opacity-60";
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
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [agreement, setAgreement] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [issue, setIssue] = useState("");
  const [sent, setSent] = useState(false);
  const alert = useRef<HTMLParagraphElement>(null);
  const sentHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (issue) alert.current?.focus(); }, [issue]);
  useEffect(() => { if (sent) sentHeading.current?.focus(); }, [sent]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
    setIssue("");
    const normalizedName = normalizeRegistrationName(name);
    if (action === "register" && !normalizedName) { setIssue("Укажите имя: от 1 до 120 символов."); return; }
    if (!isValidAccountPassword(password)) { setIssue("Пароль должен содержать от 8 до 128 символов и не состоять только из пробелов."); return; }
    if (action === "register" && password !== repeat) { setIssue("Пароли не совпадают."); return; }
    if (action === "register" && (!agreement || !privacy)) { setIssue("Примите соглашение и подтвердите ознакомление с политикой."); return; }
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
    setAction(next); setSent(false); setIssue(""); setPassword(""); setRepeat(""); onCaptchaReset?.();
  }

  if (sent) return <>
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
    <p className="mt-3 text-sm leading-6 text-slate-600">Если аккаунт уже существует, войдите или восстановите пароль. Повторная регистрация не меняет его данные.</p>
    <Link href={production ? "/auth" : "/auth/local/login"} prefetch={false} className={`${buttonStyle} mt-5 flex justify-center`}>Перейти к входу</Link>
    <div className="mt-2 flex flex-wrap gap-x-4">
      <button type="button" onClick={() => changeAction("resend")} className="min-h-11 text-sm font-semibold text-brand-blue underline">Повторить письмо</button>
      <button type="button" onClick={() => changeAction("register")} className="min-h-11 text-sm font-semibold text-brand-blue underline">Изменить email</button>
    </div>
  </>;

  return <>
    <h1 className="text-2xl font-bold text-brand-ink">{action === "register" ? "Регистрация" : "Повторное письмо"}</h1>
    <p className="mt-2 text-sm leading-5 text-slate-600">{action === "register" ? production ? "Создайте аккаунт и подтвердите email по письму." : "Создайте тестовый аккаунт. Данные сохраняются в локальной PostgreSQL." : "Введите email и исходный пароль неподтверждённого аккаунта. Если забыли пароль подтверждённого аккаунта, восстановите доступ."}</p>
    <form onSubmit={onSubmit} className="mt-4" aria-busy={busy}>
      <fieldset disabled={busy} className="min-w-0 space-y-3">
      {action === "register" && <label className="block text-sm font-semibold text-brand-ink">Имя
        <input type="text" autoComplete="given-name" required maxLength={120} value={name} onChange={event => setName(event.target.value)} className={inputStyle} />
      </label>}
      <div><label className="block text-sm font-semibold text-brand-ink">Email
        <input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} className={inputStyle} placeholder={production ? "you@example.ru" : "test@example.invalid"} aria-describedby="local-email-help" />
      </label>
      <p id="local-email-help" className="mt-1 text-xs leading-5 text-slate-600">{production ? "Для подтверждения и восстановления доступа." : "Только тестовые адреса .invalid; без внешней отправки."}</p></div>
      <div>
        <div className={action === "register" ? "grid gap-3 sm:grid-cols-2" : ""}>
          <PasswordField label="Пароль" value={password} onChange={setPassword} autoComplete={action === "register" ? "new-password" : "current-password"}
            minLength={PASSWORD_MIN_LENGTH} describedBy="local-password-help" />
          {action === "register" && <PasswordField label="Повторите пароль" value={repeat} onChange={setRepeat} autoComplete="new-password" toggleLabel="повтор пароля" />}
        </div>
        <p id="local-password-help" className="mt-1 text-xs leading-5 text-slate-600">8–128 символов. Надёжнее — длинная фраза от 15 символов. Пробелы сохраняются.</p>
      </div>
      {action === "register" && <>
        <label className="flex min-h-11 items-start gap-2 text-xs leading-5 text-slate-700">
          <input type="checkbox" required checked={agreement} onChange={(event) => setAgreement(event.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-brand-blue" />
          <span>Принимаю <a href="/legal/agreement" target="_blank" rel="noopener noreferrer" className="underline">пользовательское соглашение</a> от {REGISTRATION_LEGAL_VERSIONS.agreement}.</span>
        </label>
        <label className="flex min-h-11 items-start gap-2 text-xs leading-5 text-slate-700">
          <input type="checkbox" required checked={privacy} onChange={(event) => setPrivacy(event.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-brand-blue" />
          <span>Ознакомлен с <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="underline">политикой обработки персональных данных</a> от {REGISTRATION_LEGAL_VERSIONS.privacy}.</span>
        </label>
      </>}
      {issue && <p ref={alert} tabIndex={-1} role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">{issue}</p>}
      <p role="status" className="text-sm leading-5 text-slate-700">{busy ? "Обрабатываем запрос…" : ""}</p>
      {production && captcha}
      <button type="submit" disabled={busy || (production && !captchaToken)} className={`${buttonStyle} w-full`}>{busy ? "Подождите…" : action === "register" ? "Зарегистрироваться" : "Отправить повторное письмо"}</button>
      <button type="button" disabled={busy} onClick={() => changeAction(action === "register" ? "resend" : "register")} className="min-h-11 w-full rounded-xl px-3 text-sm font-semibold text-brand-blue underline focus-visible:outline focus-visible:outline-2">
        {action === "register" ? "Повторить письмо" : "Вернуться к регистрации"}
      </button>
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
    catch (error) { if (submittedVersion === linkVersion.current) setIssue(readableError(error)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  return <>
    <h1 className="text-2xl font-bold text-brand-ink">Подтверждение email</h1>
    <p className="mt-3 text-sm leading-6 text-slate-600">Открытие письма не подтверждает аккаунт автоматически. Для подтверждения нажмите кнопку ниже.</p>
    <p role="status" className="mt-5 text-sm leading-6 text-slate-700">{confirmed ? production ? "Email подтверждён. Теперь можно войти в аккаунт." : "Email подтверждён. Теперь можно войти на HTTPS-стенде." : !ready ? "Подготавливаем ссылку…" : busy ? "Подтверждаем…" : ""}</p>
    {issue && <p ref={alert} tabIndex={-1} role="alert" className="mt-5 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">{issue}</p>}
    {!confirmed && token && <button type="button" disabled={busy} onClick={confirm} className={`${buttonStyle} mt-6 w-full`}>{busy ? "Подождите…" : "Подтвердить email"}</button>}
    {confirmed && <Link href={production ? "/auth" : "/auth/local/login"} prefetch={false} className={`${buttonStyle} mt-5 flex justify-center`}>Перейти к входу</Link>}
    <Link href={production ? "/auth/register" : "/auth/local"} prefetch={false} className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold text-brand-blue underline">Регистрация и повторное письмо</Link>
  </>;
}
