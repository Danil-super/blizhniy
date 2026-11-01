/** Reuse the document nonce, including after client navigation. Never use URL/input values. */
export function documentCspNonce(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const value = document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce;
  return value && /^[A-Za-z0-9+/]{32}$/.test(value) ? value : undefined;
}
