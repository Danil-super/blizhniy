"use client";

import { useCallback, useState } from "react";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { LocalRegistrationForm } from "./LocalRegistrationForm";
import { useAccountCaptcha } from "./AccountCaptchaProvider";

export function ProductionRegistrationForm({ mode }: { mode: "register" | "confirm" }) {
  const [captchaToken, setCaptchaToken] = useState("");
  const [version, setVersion] = useState(0);
  const remembered = useAccountCaptcha();
  const reset = useCallback(() => { setCaptchaToken(""); setVersion(value => value + 1); }, []);
  return <LocalRegistrationForm mode={mode} production captchaToken={captchaToken} captchaReady={remembered || Boolean(captchaToken)} onCaptchaReset={reset}
    captcha={mode === "register" && !remembered ? <div className="-mx-3 flex justify-center sm:mx-0"><TurnstileWidget requireProvider manualRetry size="normal" inline onVerify={setCaptchaToken} resetKey={version} /></div> : undefined} />;
}
