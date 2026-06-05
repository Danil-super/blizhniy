"use client";

import { useEffect, useState } from "react";

type TurnstileWidgetProps = {
  name?: string;
  resetKey?: number | string;
  onVerify?: (token: string) => void;
};

const quietTokenReadyDelayMs = 450;

function createQuietToken() {
  const randomValue =
    window.crypto?.randomUUID?.() ??
    (window.crypto?.getRandomValues ? Array.from(window.crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(36).padStart(7, "0")).join("") : Math.random().toString(36).slice(2).padEnd(12, "0"));
  return `quiet:${Date.now()}:${randomValue}`;
}

export function TurnstileWidget({ name = "captchaToken", onVerify, resetKey }: TurnstileWidgetProps) {
  const [token, setToken] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    setToken("");
    onVerify?.("");

    const timerId = window.setTimeout(() => {
      const nextToken = createQuietToken();
      setToken(nextToken);
      onVerify?.(nextToken);
    }, quietTokenReadyDelayMs);

    return () => window.clearTimeout(timerId);
  }, [onVerify, resetKey]);

  return (
    <>
      <input type="hidden" name={name} value={token} />
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
