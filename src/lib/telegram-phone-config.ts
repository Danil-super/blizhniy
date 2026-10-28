export const telegramPhoneCallbackPath = '/api/account/phone/telegram/callback';
export type TelegramPhoneConfig = { clientId: string; clientSecret: string; callbackUrl: string; origin: string };
/** Server-only opt-in. Callback is operator configuration, never a browser URL. */
export function readTelegramPhoneConfig(env: NodeJS.ProcessEnv = process.env): TelegramPhoneConfig | null {
  if (typeof window !== 'undefined') throw new Error('Telegram configuration is server-only');
  if (env.BLIZHNIY_TELEGRAM_PHONE === undefined || env.BLIZHNIY_TELEGRAM_PHONE === 'disabled') return null;
  const invalid = (): never => { throw new Error('Invalid Telegram phone configuration'); };
  if (env.BLIZHNIY_TELEGRAM_PHONE !== 'enabled') return invalid();
  const clientId = env.BLIZHNIY_TELEGRAM_CLIENT_ID ?? '', clientSecret = env.BLIZHNIY_TELEGRAM_CLIENT_SECRET ?? '';
  if (typeof clientId!=='string' || typeof clientSecret!=='string' || !/^[1-9]\d{4,19}$/.test(clientId) || clientSecret.length < 20 || clientSecret.length > 512 || /[\u0000-\u0020\u007f]/.test(clientSecret)) return invalid();
  const callbackUrl = env.BLIZHNIY_TELEGRAM_CALLBACK_URL ?? '';
  try {
    const url = new URL(callbackUrl), production = 'https://xn----9sbphbgks4a4a.xn--p1ai';
    const local = env.BLIZHNIY_LOCAL_PRIMARY === 'enabled' && /^https:\/\/127\.0\.0\.1:\d{4,5}$/.test(env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN ?? '')
      ? env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN : null;
    if (![production, local].includes(url.origin) || url.pathname !== telegramPhoneCallbackPath || url.search || url.hash || url.username || url.password || url.href !== callbackUrl) return invalid();
    return { clientId, clientSecret, callbackUrl, origin: url.origin };
  } catch { return invalid(); }
}
