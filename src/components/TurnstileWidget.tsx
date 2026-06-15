"use client";

import { useEffect, useRef, useState } from "react";

type TurnstileWidgetProps = {
  name?: string;
  resetKey?: number | string;
  onVerify?: (token: string) => void;
};

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      callback: (token: string) => void;
      sitekey: string;
      theme?: "light" | "dark" | "auto";
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
const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();

function createQuietToken() {
  const randomValue =
    window.crypto?.randomUUID?.() ??
    (window.crypto?.getRandomValues ? Array.from(window.crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(36).padStart(7, "0")).join("") : Math.random().toString(36).slice(2).padEnd(12, "0"));
  return `quiet:${Date.now()}:${randomValue}`;
}

function loadTurnstileScript() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Turnstile script can only be loaded in the browser"));
  }

  if (window.turnstile) {
    return Promise.resolve();
  }

  const existingScript = document.getElementById(turnstileScriptId) as HTMLScriptElement | null;

  if (existingScript) {
    return new Promise<void>((resolve, reject) => {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener("error", () => reject(new Error("Turnstile script failed to load")), { once: true });
    });
  }

  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.id = turnstileScriptId;
    script.src = turnstileScriptSrc;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("Turnstile script failed to load")), { once: true });
    document.head.appendChild(script);
  });
}

export function TurnstileWidget({ name = "captchaToken", onVerify, resetKey }: TurnstileWidgetProps) {
  const [token, setToken] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let cancelled = false;

    setToken("");
    onVerify?.("");

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
            callback: (nextToken) => {
              setToken(nextToken);
              onVerify?.(nextToken);
            },
          });
        })
        .catch(() => {
          setToken("");
          onVerify?.("");
        });

      return () => {
        cancelled = true;
        if (widgetIdRef.current && window.turnstile?.remove) {
          window.turnstile.remove(widgetIdRef.current);
          widgetIdRef.current = null;
        }
      };
    }

    const timerId = window.setTimeout(() => {
      const nextToken = createQuietToken();
      setToken(nextToken);
      onVerify?.(nextToken);
    }, quietTokenReadyDelayMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [onVerify, resetKey]);

  return (
    <>
      <input type="hidden" name={name} value={token} />
      {turnstileSiteKey ? <div ref={containerRef} className="mt-3 min-h-[65px]" /> : null}
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
