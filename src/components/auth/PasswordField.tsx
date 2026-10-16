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
};

export function PasswordField({ label, value, onChange, autoComplete, minLength, describedBy, toggleLabel = "пароль" }: Props) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return <div>
    <label htmlFor={id} className="block text-sm font-semibold text-brand-ink">{label}</label>
    <div className="relative mt-1">
      <input id={id} type={visible ? "text" : "password"} required autoComplete={autoComplete}
        minLength={minLength} maxLength={PASSWORD_MAX_CODE_UNITS} value={value} onChange={event => onChange(event.target.value)}
        aria-describedby={describedBy} spellCheck={false} autoCapitalize="none"
        className="min-h-11 w-full rounded-lg border border-slate-300 bg-white py-2 pl-3 pr-12 text-brand-ink focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue" />
      <button type="button" aria-label={`${visible ? "Скрыть" : "Показать"} ${toggleLabel}`} aria-pressed={visible}
        aria-controls={id} onClick={() => setVisible(value => !value)}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-lg text-slate-600 hover:text-brand-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue">
        {visible ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
      </button>
    </div>
  </div>;
}
