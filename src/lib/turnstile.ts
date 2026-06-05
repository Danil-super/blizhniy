import { TURNSTILE_ERROR_MESSAGE } from "@/lib/turnstile-shared";

export { TURNSTILE_ERROR_MESSAGE };

const tokenPrefix = "quiet";
const minimumTokenAgeMs = 400;
const maximumTokenAgeMs = 2 * 60 * 60 * 1000;
const rateLimitWindowMs = 60 * 1000;
const maximumChecksPerWindow = 40;
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

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

export async function verifyTurnstileToken(token: string, remoteIp?: string): Promise<boolean> {
  const cleanToken = token.trim();

  if (!cleanToken) {
    return false;
  }

  if (isRateLimited(remoteIp)) {
    return false;
  }

  const [prefix, issuedAtRaw, nonce] = cleanToken.split(":");
  const issuedAt = Number(issuedAtRaw);

  if (prefix !== tokenPrefix || !Number.isFinite(issuedAt) || !nonce || nonce.length < 12) {
    return false;
  }

  const age = Date.now() - issuedAt;
  if (age < minimumTokenAgeMs || age > maximumTokenAgeMs) {
    return false;
  }

  return true;
}

export async function verifyTurnstileFormData(formData: FormData, remoteIp?: string) {
  const honeypot = String(formData.get("captchaWebsite") ?? "").trim();

  if (honeypot) {
    return false;
  }

  return verifyTurnstileToken(String(formData.get("captchaToken") ?? ""), remoteIp);
}
