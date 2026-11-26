import { ECDH } from "node:crypto";

export class PushSubscriptionInputError extends Error {
  constructor() {
    super("Invalid push subscription");
    this.name = "PushSubscriptionInputError";
  }
}

export type BrowserPushSubscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
  expirationTime: number | null;
};

const endpointPath = /^https:\/\/(?:fcm\.googleapis\.com\/fcm\/send\/[A-Za-z0-9_:-]+|updates\.push\.services\.mozilla\.com\/wpush\/v2\/[A-Za-z0-9_-]+|web\.push\.apple\.com\/[A-Za-z0-9_-]+)$/;

function exact(input: unknown, keys: string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Reflect.ownKeys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key))) {
    throw new PushSubscriptionInputError();
  }
  return input as Record<string, unknown>;
}

function decodeKey(value: unknown, size: number): Buffer {
  if (typeof value !== "string" || value.length !== Math.ceil(size * 4 / 3) || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new PushSubscriptionInputError();
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== size || bytes.toString("base64url") !== value) throw new PushSubscriptionInputError();
  return bytes;
}

export function parsePushVapidPublicKey(input: unknown): string {
  const bytes = decodeKey(input, 65);
  if (bytes[0] !== 4) throw new PushSubscriptionInputError();
  try { ECDH.convertKey(bytes, "prime256v1"); }
  catch { throw new PushSubscriptionInputError(); }
  return bytes.toString("base64url");
}

/** Accept only the public Web Push routes served by supported providers. */
export function parsePushSubscription(input: unknown): BrowserPushSubscription {
  const { endpoint, keys, expirationTime } = exact(input, ["endpoint", "keys", "expirationTime"]);
  if (typeof endpoint !== "string" || endpoint.length > 2048 || !endpointPath.test(endpoint) || endpoint.trim() !== endpoint) {
    throw new PushSubscriptionInputError();
  }
  if (expirationTime !== null && (typeof expirationTime !== "number" || !Number.isSafeInteger(expirationTime) ||
      expirationTime <= Date.now() || expirationTime > 8.64e15)) throw new PushSubscriptionInputError();
  const { p256dh, auth } = exact(keys, ["p256dh", "auth"]);
  return { endpoint, p256dh: parsePushVapidPublicKey(p256dh), auth: decodeKey(auth, 16).toString("base64url"), expirationTime };
}
