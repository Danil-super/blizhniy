"use client";

import { useState } from "react";
import { TurnstileWidget } from "@/components/TurnstileWidget";

type TurnstileSubmitButtonProps = {
  className?: string;
  disabled?: boolean;
  label: string;
};

export function TurnstileSubmitButton({ className, disabled = false, label }: TurnstileSubmitButtonProps) {
  const [captchaToken, setCaptchaToken] = useState("");

  return (
    <div className="grid gap-3">
      <TurnstileWidget onVerify={setCaptchaToken} />
      <button
        type="submit"
        disabled={disabled || !captchaToken}
        className={
          className ??
          "inline-flex h-10 w-full items-center justify-center rounded-xl bg-[#0875d1] px-5 text-sm font-bold text-white transition hover:bg-[#0664b3] disabled:cursor-not-allowed disabled:bg-slate-300 sm:h-12 sm:w-fit sm:px-7 sm:text-base"
        }
      >
        {label}
      </button>
    </div>
  );
}
