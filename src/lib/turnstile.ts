import { TURNSTILE_ERROR_MESSAGE } from "@/lib/turnstile-shared";

type TurnstileVerificationResponse = {
  success?: boolean;
  "error-codes"?: string[];
};

export { TURNSTILE_ERROR_MESSAGE };

export async function verifyTurnstileToken(token: string, remoteIp?: string): Promise<boolean> {
  const cleanToken = token.trim();

  if (!cleanToken) {
    return false;
  }

  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();

  if (!secret) {
    // Local development can run without Cloudflare credentials so designers and QA
    // are not blocked by an external challenge. Production must fail closed.
    return process.env.NODE_ENV !== "production";
  }

  const body = new FormData();
  body.append("secret", secret);
  body.append("response", cleanToken);

  if (remoteIp) {
    body.append("remoteip", remoteIp);
  }

  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      body,
      method: "POST",
    });

    if (!response.ok) {
      return false;
    }

    const payload = (await response.json()) as TurnstileVerificationResponse;
    return payload.success === true;
  } catch {
    return false;
  }
}

export async function verifyTurnstileFormData(formData: FormData, remoteIp?: string) {
  return verifyTurnstileToken(String(formData.get("captchaToken") ?? ""), remoteIp);
}
