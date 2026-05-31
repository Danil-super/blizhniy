"use client";

import { useEffect, useRef, useState } from "react";

type TurnstileWidgetProps = {
  siteKey?: string;
  name?: string;
  resetKey?: number | string;
  onError?: () => void;
  onExpire?: () => void;
  onVerify?: (token: string) => void;
};

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      callback: (token: string) => void;
      "error-callback": () => void;
      "expired-callback": () => void;
      sitekey: string;
      theme?: "light" | "dark" | "auto";
    },
  ) => string;
  remove?: (widgetId: string) => void;
  reset?: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const scriptId = "cloudflare-turnstile-script";
const devToken = "development-turnstile-bypass";

function loadTurnstileScript() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Turnstile доступен только в браузере"));
  }

  if (window.turnstile) {
    return Promise.resolve();
  }

  const existingScript = document.getElementById(scriptId) as HTMLScriptElement | null;

  if (existingScript) {
    return new Promise<void>((resolve, reject) => {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener("error", () => reject(new Error("Не удалось загрузить Turnstile")), { once: true });
    });
  }

  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.id = scriptId;
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Не удалось загрузить Turnstile"));
    document.head.appendChild(script);
  });
}

export function TurnstileWidget({ siteKey, name = "captchaToken", onError, onExpire, onVerify, resetKey }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onErrorRef = useRef(onError);
  const onExpireRef = useRef(onExpire);
  const onVerifyRef = useRef(onVerify);
  const widgetIdRef = useRef<string | null>(null);
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const isDevelopmentBypass = !siteKey && process.env.NODE_ENV !== "production";

  useEffect(() => {
    onErrorRef.current = onError;
    onExpireRef.current = onExpire;
    onVerifyRef.current = onVerify;
  }, [onError, onExpire, onVerify]);

  useEffect(() => {
    if (isDevelopmentBypass) {
      setToken(devToken);
      onVerifyRef.current?.(devToken);
      return;
    }

    if (!siteKey) {
      setToken("");
      setMessage("Проверка временно недоступна.");
      onErrorRef.current?.();
      return;
    }

    let cancelled = false;

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile || widgetIdRef.current) {
          return;
        }

        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: "light",
          callback: (nextToken) => {
            setToken(nextToken);
            setMessage("");
            onVerifyRef.current?.(nextToken);
          },
          "expired-callback": () => {
            setToken("");
            setMessage("Проверка истекла. Пройдите ее еще раз.");
            onExpireRef.current?.();
          },
          "error-callback": () => {
            setToken("");
            setMessage("Не удалось пройти проверку. Попробуйте еще раз.");
            onErrorRef.current?.();
          },
        });
      })
      .catch(() => {
        setToken("");
        setMessage("Не удалось загрузить проверку. Обновите страницу.");
        onErrorRef.current?.();
      });

    return () => {
      cancelled = true;

      if (widgetIdRef.current && window.turnstile?.remove) {
        window.turnstile.remove(widgetIdRef.current);
      }

      widgetIdRef.current = null;
    };
  }, [isDevelopmentBypass, siteKey]);

  useEffect(() => {
    if (isDevelopmentBypass) {
      setToken(devToken);
      onVerifyRef.current?.(devToken);
      return;
    }

    setToken("");
    onExpireRef.current?.();

    if (widgetIdRef.current && window.turnstile?.reset) {
      window.turnstile.reset(widgetIdRef.current);
    }
  }, [isDevelopmentBypass, resetKey]);

  return (
    <>
      <input type="hidden" name={name} value={token} />
      {isDevelopmentBypass ? null : (
        <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-3 sm:p-4">
          <div className="min-h-[65px]">
            <div ref={containerRef} className="overflow-hidden" />
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-500">Проверка защищает сайт от спама и автоматических публикаций.</p>
          {message ? <p className="mt-1 text-xs font-semibold text-amber-700">{message}</p> : null}
        </div>
      )}
    </>
  );
}
