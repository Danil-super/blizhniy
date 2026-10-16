"use client";

import { useEffect, useRef, useState } from "react";
import { getTurnstileSiteKey } from "@/lib/turnstile-public-config";

type TurnstileWidgetProps = {
  name?: string;
  resetKey?: number | string;
  onVerify?: (token: string) => void;
  inline?: boolean;
  requireProvider?: boolean;
  size?: "normal" | "compact" | "flexible";
  manualRetry?: boolean;
};

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      callback: (token: string) => void;
      sitekey: string;
      theme?: "light" | "dark" | "auto";
      size?: "normal" | "compact" | "flexible";
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
      "timeout-callback"?: () => void;
      retry?: "never";
      "refresh-expired"?: "manual";
      "refresh-timeout"?: "manual";
    },
  ) => string;
  remove?: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const quietTokenReadyDelayMs = 450;
const turnstileScriptId = "cloudflare-turnstile-script";
const turnstileScriptSrc = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function createQuietToken() {
  const randomValue =
    window.crypto?.randomUUID?.() ??
    (window.crypto?.getRandomValues ? Array.from(window.crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(36).padStart(7, "0")).join("") : Math.random().toString(36).slice(2).padEnd(12, "0"));
  return `quiet:${Date.now()}:${randomValue}`;
}

let scriptPromise: Promise<void> | undefined;
function loadTurnstileScript() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Turnstile script can only be loaded in the browser"));
  }

  if (window.turnstile) {
    return Promise.resolve();
  }

  if (scriptPromise) return scriptPromise;
  const existingScript = document.getElementById(turnstileScriptId) as HTMLScriptElement | null;
  const script = existingScript ?? document.createElement("script");
  scriptPromise = new Promise<void>((resolve, reject) => {
    const finish = (failed: boolean) => {
      window.clearTimeout(timer);
      script.removeEventListener("load", loaded);
      script.removeEventListener("error", failedLoad);
      if (failed || !window.turnstile) {
        script.remove(); reject(new Error("Turnstile script failed to load"));
      } else resolve();
    };
    const loaded = () => finish(false);
    const failedLoad = () => finish(true);
    const timer = window.setTimeout(failedLoad, 12000);
    script.id = turnstileScriptId;
    script.src = turnstileScriptSrc;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", loaded, { once: true });
    script.addEventListener("error", failedLoad, { once: true });
    if (!existingScript) document.head.appendChild(script);
  }).catch(error => { scriptPromise = undefined; throw error; });
  return scriptPromise;
}

export function TurnstileWidget({ inline = false, name = "captchaToken", onVerify, resetKey, requireProvider = false, size, manualRetry = false }: TurnstileWidgetProps) {
  const turnstileSiteKey = getTurnstileSiteKey();
  const [token, setToken] = useState("");
  const [failure, setFailure] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let cancelled = false;
    const publish = (value: string) => {
      if (cancelled) return;
      setToken(value); onVerify?.(value);
    };

    setToken("");
    setFailure(false);
    onVerify?.("");
    const failed = () => { if (!cancelled) { publish(""); setFailure(true); } };

    if (turnstileSiteKey) {
      loadTurnstileScript()
        .then(() => {
          if (cancelled || !window.turnstile || !containerRef.current) {
            return;
          }

          if (widgetIdRef.current && window.turnstile.remove) {
            window.turnstile.remove(widgetIdRef.current);
            widgetIdRef.current = null;
          }

          widgetIdRef.current = window.turnstile.render(containerRef.current, {
            sitekey: turnstileSiteKey,
            theme: "light",
            size: size ?? (requireProvider ? "compact" : undefined),
            ...(manualRetry ? { retry: "never" as const, "refresh-expired": "manual" as const, "refresh-timeout": "manual" as const } : {}),
            callback: value => { if (!cancelled) setFailure(false); publish(value); },
            "expired-callback": manualRetry ? failed : () => publish(""),
            "error-callback": manualRetry ? failed : () => publish(""),
            "timeout-callback": manualRetry ? failed : undefined,
          });
        })
        .catch(() => {
          failed();
        });

      return () => {
        cancelled = true;
        if (widgetIdRef.current && window.turnstile?.remove) {
          window.turnstile.remove(widgetIdRef.current);
          widgetIdRef.current = null;
        }
      };
    }

    if (requireProvider) return () => { cancelled = true; };

    const timerId = window.setTimeout(() => {
      const nextToken = createQuietToken();
      setToken(nextToken);
      onVerify?.(nextToken);
    }, quietTokenReadyDelayMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [onVerify, resetKey, requireProvider, turnstileSiteKey, size, manualRetry, retryVersion]);

  return (
    <>
      <input type="hidden" name={name} value={token} />
      {turnstileSiteKey ? <div ref={containerRef} className={`${inline ? "" : "mt-3 "}min-h-[65px]`} /> : null}
      {manualRetry && failure && <div className="text-sm text-red-800" role="alert">
        <p>Проверка не завершена или срок истёк. Введённые данные сохранены.</p>
        <button type="button" className="min-h-11 font-semibold text-brand-blue underline" onClick={() => setRetryVersion(value => value + 1)}>Повторить проверку</button>
      </div>}
      {!turnstileSiteKey && requireProvider && <p role="alert" className="text-sm text-red-800">Проверка безопасности временно недоступна. Попробуйте позже.</p>}
      <input
        type="text"
        name="captchaWebsite"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="pointer-events-none absolute h-px w-px -translate-x-[200vw] opacity-0"
      />
    </>
  );
}
