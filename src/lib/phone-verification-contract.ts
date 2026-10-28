/** Strict E.164 syntax. Telegram attests ownership; syntax alone never verifies it. */
export function normalizeTelegramPhone(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\+?[1-9]\d{6,14}$/.test(value)) return null;
  return value.startsWith('+') ? value : '+' + value;
}
export function normalizeProfilePhone(value: string): string | null {
  if (!/^[+\d ().-]{1,40}$/.test(value) || (value.match(/\+/g)?.length ?? 0) > 1 || value.includes('+') && !value.startsWith('+')) return null;
  let digits = value.replace(/\D/g, '');
  if (!value.startsWith('+') && !(digits.length === 10 || digits.length === 11 && /^[78]/.test(digits))) return null;
  if (!value.startsWith('+') && digits.length === 10) digits = '7' + digits;
  if (!value.startsWith('+') && digits.length === 11 && digits.startsWith('8')) digits = '7' + digits.slice(1);
  if (digits.startsWith('7') && digits.length !== 11) return null;
  return normalizeTelegramPhone(digits);
}
type PhoneCode = 'INVALID_ATTEMPT' | 'UNAVAILABLE' | 'PHONE_CONFLICT' | 'PROFILE_CHANGED' | 'PHONE_REQUIRED' | 'CANCELLED' | 'INVALID_INPUT' | 'RATE_LIMITED' | 'REPLACEMENT_REQUIRED';
export class PhoneVerificationError extends Error {
  readonly code: PhoneCode;
  constructor(code: PhoneCode) {
    super('Phone verification failed'); this.name = 'PhoneVerificationError'; this.code = code;
  }
}

export function phoneReturnPath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value) || !/^\/(?:cabinet(?:\/|$)|razmestit(?:\/|$)|rabota(?:\/|$)|oplata\/|obyavlenie\/)/.test(value)) throw new PhoneVerificationError('INVALID_INPUT');
  const url = new URL(value, 'https://local.invalid');
  if (url.origin !== 'https://local.invalid') throw new PhoneVerificationError('INVALID_INPUT');
  return url.pathname + url.search;
}
