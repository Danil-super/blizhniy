/** Turn a Telegram handle into a link and reject unusable URL schemes. */
export function normalizeMessengerHref(value?: string) {
  const input = value?.trim();

  if (!input) {
    return undefined;
  }

  if (/^@[A-Za-z0-9_]{5,32}$/.test(input)) {
    return `https://t.me/${input.slice(1)}`;
  }

  if (!/^https?:\/\//i.test(input)) {
    return undefined;
  }

  try {
    const url = new URL(input);

    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      return undefined;
    }

    return url.href;
  } catch {
    return undefined;
  }
}
