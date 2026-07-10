import { TURNSTILE_ERROR_MESSAGE } from "@/lib/turnstile-shared";

export { TURNSTILE_ERROR_MESSAGE };

const tokenPrefix = "quiet";
const minimumTokenAgeMs = 400;
const maximumTokenAgeMs = 2 * 60 * 60 * 1000;
const rateLimitWindowMs = 60 * 1000;
const maximumChecksPerWindow = 40;
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();
const turnstileSiteverifyUrl = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

type TurnstileSiteverifyResponse = {
  success: boolean;
  "error-codes"?: string[];
};

function isRateLimited(remoteIp?: string) {
  if (!remoteIp) {
    return false;
  }

  const now = Date.now();
  const bucket = rateLimitBuckets.get(remoteIp);

  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(remoteIp, { count: 1, resetAt: now + rateLimitWindowMs });
    return false;
  }

  bucket.count += 1;
  return bucket.count > maximumChecksPerWindow;
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

  const response = await fetch(turnstileSiteverifyUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const payload = (await response.json().catch(() => null)) as TurnstileSiteverifyResponse | null;

  return Boolean(response.ok && payload?.success);
}

export async function verifyTurnstileToken(token: string, remoteIp?: string): Promise<boolean> {
  const cleanToken = token.trim();

  if (!cleanToken) {
    return false;
  }

  if (isRateLimited(remoteIp)) {
    return false;
  }

  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();

  if (secret) {
    return verifyCloudflareTurnstileToken(cleanToken, secret, remoteIp);
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

  return verifyTurnstileToken(String(formData.get("captchaToken") ?? ""), remoteIp);
}
