"use client";

import { MouseEvent, ReactNode, useState } from "react";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { TURNSTILE_ERROR_MESSAGE } from "@/lib/turnstile-shared";

type TurnstileVerifiedLinkButtonProps = {
  children: ReactNode;
  className: string;
  href: string;
  siteKey?: string;
};

export function TurnstileVerifiedLinkButton({ children, className, href, siteKey }: TurnstileVerifiedLinkButtonProps) {
  const [captchaToken, setCaptchaToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  async function handleClick(event: MouseEvent<HTMLButtonElement>) {
    const form = event.currentTarget.form;

    if (form && !form.reportValidity()) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/turnstile/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: captchaToken }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? TURNSTILE_ERROR_MESSAGE);
      }

      window.location.href = href;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : TURNSTILE_ERROR_MESSAGE);
      setCaptchaToken("");
      setResetKey((value) => value + 1);
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-2">
      <TurnstileWidget
        resetKey={resetKey}
        siteKey={siteKey}
        onVerify={setCaptchaToken}
        onExpire={() => setCaptchaToken("")}
        onError={() => setCaptchaToken("")}
      />
      <button type="button" disabled={loading || !captchaToken} onClick={handleClick} className={className}>
        {loading ? "Проверяем..." : children}
      </button>
      {error ? <p className="text-sm font-semibold text-rose-600">{error}</p> : null}
    </div>
  );
}
