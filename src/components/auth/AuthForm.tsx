"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { TURNSTILE_ERROR_MESSAGE } from "@/lib/turnstile-shared";

type AuthMode = "login" | "register";
type AuthState = "idle" | "loading" | "success" | "error";

const namePattern = /^[A-Za-zА-Яа-яЁё\s"«»'`.,-]+$/u;

function getNameValidationError(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");

  if (!normalized) {
    return "Укажите имя или название организации.";
  }

  if (normalized.length < 2) {
    return "Имя или название должно быть не короче 2 символов.";
  }

  if (normalized.length > 80) {
    return "Имя или название должно быть не длиннее 80 символов.";
  }

  if (!namePattern.test(normalized)) {
    return "В имени можно использовать только буквы, пробелы, кавычки, точку, запятую и дефис.";
  }

  return "";
}

function getPasswordValidationError(value: string) {
  if (value.length < 8) {
    return "Пароль должен быть не короче 8 символов.";
  }

  return "";
}

export function AuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("register");
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState("");
  const [fullName, setFullName] = useState("");
  const [acceptedAgreement, setAcceptedAgreement] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [captchaToken, setCaptchaToken] = useState("");
  const [state, setState] = useState<AuthState>("idle");
  const [message, setMessage] = useState("Создайте аккаунт или войдите, чтобы открыть личный кабинет.");

  useEffect(() => {
    let active = true;
    const supabase = getSupabaseBrowserClient();
    const isRecoveryUrl = window.location.search.includes("type=recovery") || window.location.hash.includes("type=recovery");

    if (isRecoveryUrl) {
      setRecoveryMode(true);
      setMessage("Введите новый пароль для аккаунта.");
    }

    supabase.auth.getSession().then(({ data }) => {
      if (active && data.session && !isRecoveryUrl) {
        setState("success");
        setMessage("Вы уже вошли. Можно перейти в кабинет.");
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" && active) {
        setRecoveryMode(true);
        setState("idle");
        setMessage("Введите новый пароль для аккаунта.");
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  function isValidEmail(value: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  }

  const nameError = mode === "register" ? getNameValidationError(fullName) : "";
  const emailError = email && !isValidEmail(email) ? "Введите корректный email." : "";
  const passwordError = mode === "register" ? getPasswordValidationError(password) : "";
  const passwordConfirmError = mode === "register" && passwordConfirm && password !== passwordConfirm ? "Пароли не совпадают." : "";
  const resetPasswordError = recoveryMode ? getPasswordValidationError(resetPassword) : "";
  const resetPasswordConfirmError = recoveryMode && resetPasswordConfirm && resetPassword !== resetPasswordConfirm ? "Пароли не совпадают." : "";

  function resetCaptcha() {
    setCaptchaToken("");
    setCaptchaResetKey((value) => value + 1);
  }

  async function verifyCaptcha() {
    const response = await fetch("/api/turnstile/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: captchaToken }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error ?? TURNSTILE_ERROR_MESSAGE);
    }
  }

  async function handleForgotPassword() {
    const recoveryEmail = email.trim().toLowerCase();

    if (!isValidEmail(recoveryEmail)) {
      setState("error");
      setMessage("Введите корректный email, чтобы получить письмо для смены пароля.");
      return;
    }

    setState("loading");
    setMessage("Отправляем письмо для смены пароля...");

    try {
      await verifyCaptcha();

      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.resetPasswordForEmail(recoveryEmail, {
        redirectTo: `${window.location.origin}/auth?type=recovery`,
      });

      if (error) {
        throw error;
      }

      setState("success");
      setMessage("Письмо отправлено. Откройте ссылку из письма и задайте новый пароль.");
      resetCaptcha();
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Не удалось отправить письмо для смены пароля");
      resetCaptcha();
    }
  }

  async function handleRecoverySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("loading");
    setMessage("Сохраняем новый пароль...");

    try {
      if (resetPassword.length < 6) {
        throw new Error("Пароль должен быть не короче 8 символов");
      }

      if (resetPasswordError) {
        throw new Error(resetPasswordError);
      }

      if (resetPassword !== resetPasswordConfirm) {
        throw new Error("Пароли не совпадают");
      }

      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({ password: resetPassword });

      if (error) {
        throw error;
      }

      setState("success");
      setMessage("Пароль обновлен. Открываю личный кабинет...");
      router.push("/cabinet");
      router.refresh();
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Не удалось обновить пароль");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("loading");
    setMessage(mode === "register" ? "Регистрируем аккаунт..." : "Входим в аккаунт...");

    try {
      if (mode === "register") {
        if (nameError) {
          throw new Error(nameError);
        }

        if (!isValidEmail(email)) {
          throw new Error("Введите корректный email.");
        }

        if (passwordError) {
          throw new Error(passwordError);
        }

        if (password !== passwordConfirm) {
          throw new Error("Пароли не совпадают");
        }

        if (!acceptedAgreement || !acceptedPrivacy) {
          throw new Error("Для регистрации нужно принять пользовательское соглашение и политику конфиденциальности");
        }

        await verifyCaptcha();
      }

      const supabase = getSupabaseBrowserClient();
      const result =
        mode === "register"
          ? await supabase.auth.signUp({
              email,
              password,
              options: {
                data: {
                  display_name: fullName.trim().replace(/\s+/g, " "),
                },
              },
            })
          : await supabase.auth.signInWithPassword({ email, password });

      if (result.error) {
        throw result.error;
      }

      if (mode === "register" && !result.data.session) {
        setState("success");
        setMessage("Аккаунт создан. Если в Supabase включено подтверждение email, откройте письмо и подтвердите вход.");
        resetCaptcha();
        return;
      }

      setState("success");
      setMessage("Готово, открываю личный кабинет...");
      router.push("/cabinet");
      router.refresh();
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Не удалось выполнить авторизацию");
      if (mode === "register") {
        resetCaptcha();
      }
    }
  }

  const registerReady =
    mode !== "register" ||
    (!nameError && isValidEmail(email) && !passwordError && passwordConfirm.length > 0 && !passwordConfirmError && acceptedAgreement && acceptedPrivacy && Boolean(captchaToken));
  const recoveryReady = isValidEmail(email) && Boolean(captchaToken);
  const recoveryPasswordReady = !resetPasswordError && resetPasswordConfirm.length > 0 && !resetPasswordConfirmError;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-card">
      {recoveryMode ? (
        <>
          <h2 className="text-2xl font-black text-[#060b27]">Новый пароль</h2>
          <form className="mt-6" onSubmit={handleRecoverySubmit}>
            <label className="block">
              <span className="text-sm font-bold text-slate-600">Придумайте новый пароль</span>
              <input
                className="mt-2 h-12 w-full rounded-lg border border-slate-300 px-4 outline-none focus:border-[#0875d1]"
                value={resetPassword}
                onChange={(event) => setResetPassword(event.target.value)}
                placeholder="Минимум 8 символов"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
              {resetPassword ? (
                <span className={resetPasswordError ? "mt-2 block text-xs font-semibold text-rose-600" : "mt-2 block text-xs font-semibold text-[#0a8f32]"}>
                  {resetPasswordError || "Надежный пароль."}
                </span>
              ) : null}
            </label>
            <label className="mt-4 block">
              <span className="text-sm font-bold text-slate-600">Повторите пароль</span>
              <input
                className="mt-2 h-12 w-full rounded-lg border border-slate-300 px-4 outline-none focus:border-[#0875d1]"
                value={resetPasswordConfirm}
                onChange={(event) => setResetPasswordConfirm(event.target.value)}
                placeholder="Еще раз тот же пароль"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
              {resetPasswordConfirmError ? <span className="mt-2 block text-xs font-semibold text-rose-600">{resetPasswordConfirmError}</span> : null}
            </label>
            <button
              type="submit"
              disabled={state === "loading" || !recoveryPasswordReady}
              className="mt-6 inline-flex h-12 w-full items-center justify-center rounded-lg bg-[#0875d1] font-bold text-white transition hover:bg-[#0664b3] disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {state === "loading" ? "Сохраняем..." : "Сохранить новый пароль"}
            </button>
          </form>
          <p className={state === "error" ? "mt-4 text-sm font-semibold text-rose-600" : "mt-4 text-sm leading-6 text-slate-500"}>{message}</p>
        </>
      ) : (
        <>
      <div className="grid grid-cols-2 rounded-lg bg-slate-100 p-1">
        <button
          type="button"
          onClick={() => setMode("register")}
          className={`h-10 rounded-md text-sm font-bold ${mode === "register" ? "bg-white text-[#0875d1] shadow-sm" : "text-slate-600"}`}
        >
          Регистрация
        </button>
        <button
          type="button"
          onClick={() => setMode("login")}
          className={`h-10 rounded-md text-sm font-bold ${mode === "login" ? "bg-white text-[#0875d1] shadow-sm" : "text-slate-600"}`}
        >
          Вход
        </button>
      </div>

      <h2 className="mt-6 text-2xl font-black text-[#060b27]">{mode === "register" ? "Создать аккаунт" : "Войти в кабинет"}</h2>
      <form className="mt-6" onSubmit={handleSubmit}>
        {mode === "register" ? (
          <label className="block">
            <span className="text-sm font-bold text-slate-600">Имя или организация</span>
            <input
              className="mt-2 h-12 w-full rounded-lg border border-slate-300 px-4 outline-none focus:border-[#0875d1]"
              value={fullName}
              onChange={(event) => setFullName(event.target.value.replace(/[^A-Za-zА-Яа-яЁё\s"«»'`.,-]/gu, ""))}
              placeholder="Анна Иванова или ООО «Кубань»"
              autoComplete="name"
              maxLength={80}
              pattern="[A-Za-zА-Яа-яЁё\s&quot;«»'`.,-]{2,80}"
              required
            />
            {fullName ? (
              <span className={nameError ? "mt-2 block text-xs font-semibold text-rose-600" : "mt-2 block text-xs font-semibold text-[#0a8f32]"}>
                {nameError || "Имя выглядит корректно."}
              </span>
            ) : null}
          </label>
        ) : null}
        <label className="mt-4 block">
          <span className="text-sm font-bold text-slate-600">Email</span>
          <input
            className="mt-2 h-12 w-full rounded-lg border border-slate-300 px-4 outline-none focus:border-[#0875d1]"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.ru"
            type="email"
            autoComplete="email"
            required
          />
          {emailError ? <span className="mt-2 block text-xs font-semibold text-rose-600">{emailError}</span> : null}
        </label>
        <label className="mt-4 block">
          <span className="text-sm font-bold text-slate-600">{mode === "register" ? "Придумайте пароль" : "Пароль"}</span>
          <input
            className="mt-2 h-12 w-full rounded-lg border border-slate-300 px-4 outline-none focus:border-[#0875d1]"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={mode === "register" ? "Минимум 8 символов" : "Пароль"}
            type="password"
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            minLength={mode === "register" ? 8 : 6}
            required
          />
          {mode === "register" && password ? (
            <span className={passwordError ? "mt-2 block text-xs font-semibold text-rose-600" : "mt-2 block text-xs font-semibold text-[#0a8f32]"}>
              {passwordError || "Надежный пароль."}
            </span>
          ) : null}
        </label>
        {mode === "register" ? (
          <>
            <label className="mt-4 block">
              <span className="text-sm font-bold text-slate-600">Повторите пароль</span>
              <input
                className="mt-2 h-12 w-full rounded-lg border border-slate-300 px-4 outline-none focus:border-[#0875d1]"
                value={passwordConfirm}
                onChange={(event) => setPasswordConfirm(event.target.value)}
                placeholder="Еще раз тот же пароль"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
              {passwordConfirmError ? <span className="mt-2 block text-xs font-semibold text-rose-600">{passwordConfirmError}</span> : null}
            </label>
            <div className="mt-5 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <label className="flex gap-3 text-sm leading-6 text-slate-700">
                <input
                  type="checkbox"
                  checked={acceptedAgreement}
                  onChange={(event) => setAcceptedAgreement(event.target.checked)}
                  className="mt-1 h-4 w-4 shrink-0 accent-[#0875d1]"
                  required
                />
                <span>
                  Принимаю{" "}
                  <Link href="/legal/user-agreement" className="font-bold text-[#0875d1]">
                    пользовательское соглашение
                  </Link>
                </span>
              </label>
              <label className="flex gap-3 text-sm leading-6 text-slate-700">
                <input
                  type="checkbox"
                  checked={acceptedPrivacy}
                  onChange={(event) => setAcceptedPrivacy(event.target.checked)}
                  className="mt-1 h-4 w-4 shrink-0 accent-[#0875d1]"
                  required
                />
                <span>
                  Согласен с{" "}
                  <Link href="/legal/privacy" className="font-bold text-[#0875d1]">
                    политикой конфиденциальности
                  </Link>
                </span>
              </label>
            </div>
          </>
        ) : null}
        {mode === "register" ? (
          <div className="mt-5">
            <TurnstileWidget
              resetKey={captchaResetKey}
              siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
              onVerify={setCaptchaToken}
              onExpire={() => setCaptchaToken("")}
              onError={() => setCaptchaToken("")}
            />
          </div>
        ) : null}
        <button
          type="submit"
          disabled={state === "loading" || !registerReady}
          className="mt-6 inline-flex h-12 w-full items-center justify-center rounded-lg bg-[#0875d1] font-bold text-white transition hover:bg-[#0664b3] disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {state === "loading" ? "Подождите..." : mode === "register" ? "Зарегистрироваться" : "Войти"}
        </button>
        {mode === "login" ? (
          <div className="mt-5 grid gap-3">
            <TurnstileWidget
              resetKey={captchaResetKey}
              siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
              onVerify={setCaptchaToken}
              onExpire={() => setCaptchaToken("")}
              onError={() => setCaptchaToken("")}
            />
            <button type="button" onClick={handleForgotPassword} disabled={state === "loading" || !recoveryReady} className="inline-flex w-full items-center justify-center text-sm font-bold text-[#0875d1] transition hover:text-[#065fa8] disabled:text-slate-400">
              Забыли пароль? Отправить письмо
            </button>
          </div>
        ) : null}
      </form>
      <p className={state === "error" ? "mt-4 text-sm font-semibold text-rose-600" : "mt-4 text-sm leading-6 text-slate-500"}>{message}</p>
      {state === "success" ? (
        <Link href="/cabinet" className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-lg border border-blue-200 bg-white font-bold text-[#0875d1]">
          Перейти в кабинет
        </Link>
      ) : null}
        </>
      )}
    </section>
  );
}
