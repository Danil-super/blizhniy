import { NextRequest, NextResponse } from "next/server";
import { createCspNonce, createHtmlCsp, htmlCspMode } from "./lib/html-csp";
import { getPublicRuntimeSetting } from "./lib/public-runtime-config";
import { getMetricaCounterId, getMetricaTransport } from "./lib/metrica-config";

/** HTML/Flight only. Never authorizes a user; resource/API guards remain independent. */
export function middleware(request: NextRequest) {
  try {
    const mode = htmlCspMode({ BLIZHNIY_CSP_MODE: process.env.BLIZHNIY_CSP_MODE });
    const authMode = process.env.BLIZHNIY_AUTH_MODE;
    const legacy = !authMode || authMode === "local";
    const mapEnabled = Boolean(getPublicRuntimeSetting("dgis-key"));
    const isolation = process.env.BLIZHNIY_HTML_ISOLATION;
    if (isolation !== undefined && (isolation !== "enforce" || process.env.NODE_ENV !== "production" ||
        authMode !== "postgres" || mode !== "enforce" || mapEnabled)) {
      throw new Error("Invalid HTML isolation configuration");
    }
    const nonce = createCspNonce();
    const policy = createHtmlCsp(nonce, { development: process.env.NODE_ENV === "development",
      mapEnabled,
      metricaEnabled: getMetricaTransport() === "sdk" && getMetricaCounterId() !== null,
      legacyOrigin: legacy ? getPublicRuntimeSetting("legacy-url") : undefined });
    const headers = new Headers(request.headers);
    // Best effort for adapters exposing these headers. Next 15 hides/replays
    // Flight headers: the ingress must normalize them too (Caddyfile.example).
    if (headers.get("rsc") !== "1") {
      headers.delete("next-router-prefetch");
      headers.delete("next-router-segment-prefetch");
    }
    // Next reads this request header to nonce its SSR framework and Flight scripts.
    // Overwrite caller-selected values even on report-only / prefetch requests.
    headers.set("x-nonce", nonce);
    headers.set("Content-Security-Policy", policy);
    headers.delete("Content-Security-Policy-Report-Only");
    const response = NextResponse.next({ request: { headers } });
    response.headers.set(mode === "enforce" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only", policy);
    response.headers.set("Reporting-Endpoints", 'csp="/api/csp-report"');
    response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
    if (isolation === "enforce") {
      response.headers.set("Cross-Origin-Embedder-Policy", "require-corp");
      response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
    }
    response.headers.set("Cache-Control", "private, no-store, no-cache, max-age=0, must-revalidate");
    return response;
  } catch {
    return new NextResponse("Page security configuration unavailable", { status: 503, headers: {
      "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'", "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
    } });
  }
}

export const config = {
  // No missing/has rule: a client-selected prefetch header must not bypass HTML CSP.
  matcher: ["/((?!api(?:/|$)|_next/|images/|fonts/|assets/|favicon\\.ico$|robots\\.txt$|sitemap(?:-[0-9]+)?\\.xml$|icon\\.(?:svg|png)$|apple-icon\\.png$).*)"],
};
