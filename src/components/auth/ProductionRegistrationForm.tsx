"use client";

import { useCallback, useState } from "react";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { LocalRegistrationForm } from "./LocalRegistrationForm";

export function ProductionRegistrationForm({ mode }: { mode: "register" | "confirm" }) {
  const [captchaToken, setCaptchaToken] = useState("");
  const [version, setVersion] = useState(0);
  const reset = useCallback(() => { setCaptchaToken(""); setVersion(value => value + 1); }, []);
  return <LocalRegistrationForm mode={mode} production captchaToken={captchaToken} onCaptchaReset={reset}
    captcha={mode === "register" ? <TurnstileWidget requireProvider onVerify={setCaptchaToken} resetKey={version} /> : undefined} />;
}
