"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type AuthMode = "login" | "register";
type AuthState = "idle" | "loading" | "success" | "error";

export function AuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [fullName, setFullName] = useState("");
  const [acceptedAgreement, setAcceptedAgreement] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [state, setState] = useState<AuthState>("idle");
  const [message, setMessage] = useState("Создайте аккаунт или войдите, чтобы открыть личный кабинет.");

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setState("success");
        setMessage("Вы уже вошли. Можно перейти в кабинет.");
      }
    });
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("loading");
    setMessage(mode === "register" ? "Регистрируем аккаунт..." : "Входим в аккаунт...");

    try {
      if (mode === "register") {
        if (password !== passwordConfirm) {
          throw new Error("Пароли не совпадают");
        }

        if (!acceptedAgreement || !acceptedPrivacy) {
          throw new Error("Для регистрации нужно принять пользовательское соглашение и политику конфиденциальности");
        }
      }

      const supabase = getSupabaseBrowserClient();
      const result =
        mode === "register"
          ? await supabase.auth.signUp({
              email,
              password,
              options: {
                data: {
                  display_name: fullName,
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
        return;
      }

      setState("success");
      setMessage("Готово, открываю личный кабинет...");
      router.push("/cabinet");
      router.refresh();
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Не удалось выполнить авторизацию");
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-card">
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
              onChange={(event) => setFullName(event.target.value)}
              placeholder="Анна Иванова"
              autoComplete="name"
            />
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
        </label>
        <label className="mt-4 block">
          <span className="text-sm font-bold text-slate-600">{mode === "register" ? "Придумайте пароль" : "Пароль"}</span>
          <input
            className="mt-2 h-12 w-full rounded-lg border border-slate-300 px-4 outline-none focus:border-[#0875d1]"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Минимум 6 символов"
            type="password"
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            minLength={6}
            required
          />
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
                minLength={6}
                required
              />
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
        <button
          type="submit"
          disabled={state === "loading" || (mode === "register" && (!acceptedAgreement || !acceptedPrivacy))}
          className="mt-6 inline-flex h-12 w-full items-center justify-center rounded-lg bg-[#0875d1] font-bold text-white transition hover:bg-[#0664b3] disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {state === "loading" ? "Подождите..." : mode === "register" ? "Зарегистрироваться" : "Войти"}
        </button>
      </form>
      <p className={state === "error" ? "mt-4 text-sm font-semibold text-rose-600" : "mt-4 text-sm leading-6 text-slate-500"}>{message}</p>
      {state === "success" ? (
        <Link href="/cabinet" className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-lg border border-blue-200 bg-white font-bold text-[#0875d1]">
          Перейти в кабинет
        </Link>
      ) : null}
    </section>
  );
}
