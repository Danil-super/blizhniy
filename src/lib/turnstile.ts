import { TURNSTILE_ERROR_MESSAGE } from "@/lib/turnstile-shared";
import { withServerRequestTimeout } from "@/lib/server-request-timeout";
import { normalizeRemoteIp } from "@/lib/trusted-proxy-ip";

export { TURNSTILE_ERROR_MESSAGE };

const tokenPrefix = "quiet";
const minimumTokenAgeMs = 400;
const maximumTokenAgeMs = 2 * 60 * 60 * 1000;
const rateLimitWindowMs = 60 * 1000;
const maximumChecksPerWindow = 40;
const maximumGlobalChecksPerWindow = 600;
const maximumConcurrentChecks = 16;
const maximumRateLimitBuckets = 1024;
const maximumTokenLength = 2048;
const turnstileSiteverifyUrl = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const turnstileVerificationTimeoutMs = 5000;

type TurnstileRateLimitState = {
  buckets: Map<string, { count: number; resetAt: number }>;
  globalWindow: { count: number; resetAt: number };
  inFlight: number;
};

// Route bundles and development reloads must share one process-wide budget.
// Deployment intentionally runs one Next process; see deploy/captcha-boundary.md.
const runtime = globalThis as typeof globalThis & { __blizhniyTurnstileRateLimit?: TurnstileRateLimitState };
const rateLimitState = runtime.__blizhniyTurnstileRateLimit ??= {
  buckets: new Map(),
  globalWindow: { count: 0, resetAt: 0 },
  inFlight: 0,
};

type TurnstileSiteverifyResponse = {
  success: boolean;
  "error-codes"?: string[];
};

function isRateLimited(identity: string) {
  const now = Date.now();
  const globalWindow = rateLimitState.globalWindow;

  if (globalWindow.resetAt <= now) {
    globalWindow.count = 0;
    globalWindow.resetAt = now + rateLimitWindowMs;
  }

  if (globalWindow.count >= maximumGlobalChecksPerWindow) {
    return true;
  }

  const bucket = rateLimitState.buckets.get(identity);

  if (bucket && bucket.resetAt > now && bucket.count >= maximumChecksPerWindow) {
    return true;
  }

  // Capacity rejections consume the global budget too, bounding cleanup work
  // when an attacker rotates identities against a full map.
  globalWindow.count += 1;

  for (const [key, value] of rateLimitState.buckets) {
    if (value.resetAt <= now) {
      rateLimitState.buckets.delete(key);
    }
  }

  if (!bucket || bucket.resetAt <= now) {
    if (rateLimitState.buckets.size >= maximumRateLimitBuckets) {
      // Never evict live entries: rotation must not reset another IP's quota.
      return true;
    }

    rateLimitState.buckets.set(identity, { count: 1, resetAt: now + rateLimitWindowMs });
    return false;
  }

  bucket.count += 1;
  return false;
}

function isQuietDevelopmentToken(token: string) {
  const [prefix, issuedAtRaw, nonce] = token.split(":");
  const issuedAt = Number(issuedAtRaw);

  if (prefix !== tokenPrefix || !Number.isFinite(issuedAt) || !nonce || nonce.length < 12) {
    return false;
  }

  const age = Date.now() - issuedAt;
  return age >= minimumTokenAgeMs && age <= maximumTokenAgeMs;
}

async function verifyCloudflareTurnstileToken(token: string, secret: string, remoteIp?: string) {
  const body = new URLSearchParams({
    secret,
    response: token,
  });

  if (remoteIp) {
    body.set("remoteip", remoteIp);
  }

  return withServerRequestTimeout(turnstileVerificationTimeoutMs, async (signal) => {
    const response = await fetch(turnstileSiteverifyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal,
    });
    const payload = (await response.json().catch(() => null)) as TurnstileSiteverifyResponse | null;

    return Boolean(response.ok && payload?.success);
  });
}

export async function verifyTurnstileToken(token: unknown, remoteIp?: string): Promise<boolean> {
  if (typeof token !== "string" || token.length > maximumTokenLength) {
    return false;
  }

  const cleanToken = token.trim();

  if (!cleanToken) {
    return false;
  }

  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  const trustedIp = normalizeRemoteIp(remoteIp);

  if (!trustedIp && (remoteIp !== undefined || secret || process.env.NODE_ENV === "production")) {
    return false;
  }

  // Only the local, secret-free development simulator may use this one bounded
  // shared identity. Real provider calls and all production calls require an IP.
  if (isRateLimited(trustedIp ?? "development:unknown")) {
    return false;
  }

  if (secret) {
    if (rateLimitState.inFlight >= maximumConcurrentChecks) {
      return false;
    }

    rateLimitState.inFlight += 1;

    try {
      return await verifyCloudflareTurnstileToken(cleanToken, secret, trustedIp);
    } catch {
      // Captcha verification is an authorization boundary: an unavailable
      // provider must reject the request rather than let it continue.
      return false;
    } finally {
      rateLimitState.inFlight -= 1;
    }
  }

  if (process.env.NODE_ENV === "production") {
    return false;
  }

  return isQuietDevelopmentToken(cleanToken);
}

export async function verifyTurnstileFormData(formData: FormData, remoteIp?: string) {
  const honeypot = String(formData.get("captchaWebsite") ?? "").trim();

  if (honeypot) {
    return false;
  }

  return verifyTurnstileToken(formData.get("captchaToken"), remoteIp);
}
