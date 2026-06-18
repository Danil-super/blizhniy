"use client";

import Link from "next/link";
import type { ReactNode } from "react";

type LegalConsentCheckboxProps = {
  children: ReactNode;
  className?: string;
  errorMessage?: string;
  name: string;
  paymentConsent?: boolean;
  requiredConsent?: boolean;
};

export function LegalConsentCheckbox({
  children,
  className = "",
  errorMessage,
  name,
  paymentConsent = false,
  requiredConsent = true,
}: LegalConsentCheckboxProps) {
  return (
    <label className={`grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold leading-6 text-slate-700 ${className}`}>
      <input
        name={name}
        type="checkbox"
        value="1"
        required={requiredConsent}
        data-required-consent={requiredConsent ? "true" : undefined}
        data-payment-consent={paymentConsent ? "true" : undefined}
        data-error-message={errorMessage}
        className="mt-1 h-4 w-4 shrink-0 accent-[#0875d1]"
      />
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </label>
  );
}

export function LegalLink({ children, href }: { children: ReactNode; href: string }) {
  return (
    <Link href={href} className="font-bold text-[#0875d1] underline-offset-2 transition hover:underline">
      {children}
    </Link>
  );
}
