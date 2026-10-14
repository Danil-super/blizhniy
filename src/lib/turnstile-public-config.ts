/** Public site key only. Browser initialization uses the current server response, not build-time env. */
export function getTurnstileSiteKey(): string | undefined {
  if (typeof document !== "undefined") {
    return document.querySelector('meta[name="blizhniy-turnstile-site-key"]')?.getAttribute("content")?.trim() || undefined;
  }
  // Dynamic lookup deliberately avoids Next's NEXT_PUBLIC_* build-time substitution.
  // https://nextjs.org/docs/15/app/guides/environment-variables#bundling-environment-variables-for-the-browser
  const name = "NEXT_PUBLIC_TURNSTILE_SITE_KEY";
  return process.env[name]?.trim() || undefined;
}
