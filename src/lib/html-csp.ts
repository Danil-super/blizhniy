export type HtmlCspMode = "report-only" | "enforce";
export function htmlCspMode(env: { BLIZHNIY_CSP_MODE?: string }): HtmlCspMode {
  const mode = env.BLIZHNIY_CSP_MODE ?? "report-only";
  if (mode !== "report-only" && mode !== "enforce") throw new Error("Invalid HTML CSP mode");
  return mode;
}
export function createCspNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes));
}
export function createHtmlCsp(nonce: string, options: { development?: boolean; legacyOrigin?: string; mapEnabled?: boolean; metricaEnabled?: boolean } = {}): string {
  if (!/^[A-Za-z0-9+/]{32}$/.test(nonce)) throw new Error("Invalid CSP nonce");
  let legacy = "", realtime = "";
  if (options.legacyOrigin) {
    const url = new URL(options.legacyOrigin);
    const localDevelopment = options.development && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !localDevelopment || url.pathname !== "/" || url.search || url.hash || url.username || url.password) throw new Error("Invalid legacy CSP origin");
    legacy = ` ${url.origin}`; realtime = ` ${url.protocol === "https:" ? "wss" : "ws"}://${url.host}`;
  }
  const metrica = options.metricaEnabled === true ? " https://mc.yandex.ru" : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://challenges.cloudflare.com https://mapgl.2gis.com${metrica}${options.development ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'",
    // The map SDK and development style loader still need inline CSS.
    options.development || options.mapEnabled ? "style-src 'self' 'unsafe-inline'" : "style-src 'self'",
    `img-src 'self' data: blob: https://*.2gis.com https://*.2gis.ru${legacy}${metrica}`,
    "font-src 'self' data: https://*.2gis.com https://*.2gis.ru",
    `connect-src 'self' https://challenges.cloudflare.com https://*.2gis.com https://*.2gis.ru${legacy}${realtime}${metrica}${options.development ? " ws://localhost:* ws://127.0.0.1:*" : ""}`,
    "frame-src https://challenges.cloudflare.com",
    "worker-src 'self' blob:", "media-src 'self' blob:", "manifest-src 'self'",
    "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'self'",
    "report-to csp",
  ].join('; ');
}
