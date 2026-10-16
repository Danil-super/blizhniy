"use client";

import { useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { PASSWORD_MAX_CODE_UNITS } from "@/lib/account-validation";

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "new-password" | "current-password";
  minLength?: number;
  describedBy?: string;
  toggleLabel?: string;
  error?: string;
  onBlur?: () => void;
};

export function PasswordField({ label, value, onChange, autoComplete, minLength, describedBy, toggleLabel = "пароль", error, onBlur }: Props) {
  const id = useId();
  const errorId = `${id}-error`;
  const description = [describedBy, error ? errorId : undefined].filter(Boolean).join(" ") || undefined;
  const [visible, setVisible] = useState(false);
  return <div>
    <label htmlFor={id} className="block text-sm font-semibold text-brand-ink">{label}</label>
    <div className="relative mt-1">
      <input id={id} type={visible ? "text" : "password"} required autoComplete={autoComplete}
        minLength={minLength} maxLength={PASSWORD_MAX_CODE_UNITS} value={value} onChange={event => onChange(event.target.value)}
        aria-describedby={description} aria-invalid={error ? true : undefined} onBlur={onBlur} spellCheck={false} autoCapitalize="none"
        className={`min-h-12 w-full rounded-xl border bg-slate-50/50 py-2.5 pl-3.5 pr-12 text-base text-brand-ink transition-colors focus:border-brand-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-blue/20 ${error ? "border-red-500" : "border-slate-300 hover:border-slate-400"}`} />
      <button type="button" aria-label={`${visible ? "Скрыть" : "Показать"} ${toggleLabel}`} aria-pressed={visible}
        aria-controls={id} onClick={() => setVisible(value => !value)}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-lg text-slate-600 hover:text-brand-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue">
        {visible ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
      </button>
    </div>
    {(onBlur || error) && <p id={errorId} aria-hidden={!error} className="mt-1 min-h-5 text-xs leading-5 text-red-700">{error || "\u00a0"}</p>}
  </div>;
}
