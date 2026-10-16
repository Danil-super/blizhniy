"use client";

import { createContext, useContext, useEffect, useState } from "react";

const HumanContext = createContext(false);

/** Shared across account routes, but never an authority for authentication or CAPTCHA. */
export function AccountCaptchaProvider({ expiresAt: initial, children }: { expiresAt: number; children: React.ReactNode }) {
  const [expiresAt, setExpiresAt] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const update = (event: Event) => {
      const expiry = (event as CustomEvent<{ expiresAt?: unknown }>).detail?.expiresAt;
      if (typeof expiry === "number" && Number.isSafeInteger(expiry) && expiry >= 0 && expiry <= Date.now() + 900000) {
        setExpiresAt(expiry); setNow(Date.now());
      }
    };
    window.addEventListener("blizhniy-human-proof", update);
    return () => window.removeEventListener("blizhniy-human-proof", update);
  }, []);
  useEffect(() => {
    if (expiresAt <= Date.now()) return;
    const timer = window.setTimeout(() => setNow(Date.now()), expiresAt - Date.now() + 1);
    return () => window.clearTimeout(timer);
  }, [expiresAt]);
  return <HumanContext.Provider value={expiresAt > now}>{children}</HumanContext.Provider>;
}

export function useAccountCaptcha(): boolean { return useContext(HumanContext); }
