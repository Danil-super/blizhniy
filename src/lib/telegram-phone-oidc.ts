import { createHash } from 'node:crypto';
import * as oidc from 'openid-client';
import type { TelegramPhoneConfig } from './telegram-phone-config.ts';
import { normalizeTelegramPhone, PhoneVerificationError } from './phone-verification-contract.ts';
export type TelegramPhoneAttemptSecrets = { state: string; nonce: string; verifier: string };
export type TelegramPhoneClaims = { subject: string; phone: string; tokenHash: string };
const issuer = 'https://oauth.telegram.org';
/** Uses the official fixed endpoints, not attacker-controlled discovery/JWK URLs. */
export function createTelegramPhoneOidc(config: TelegramPhoneConfig, fetcher: typeof fetch = globalThis.fetch) {
  if (typeof window !== 'undefined') throw new Error('Telegram verification is server-only');
  const client = new oidc.Configuration({ issuer, authorization_endpoint: issuer + '/auth', token_endpoint: issuer + '/token',
    jwks_uri: issuer + '/.well-known/jwks.json', response_types_supported: ['code'], id_token_signing_alg_values_supported: ['RS256'] },
  config.clientId, { client_secret: config.clientSecret, id_token_signed_response_alg: 'RS256', [oidc.clockTolerance]: 5 }, oidc.ClientSecretBasic(config.clientSecret));
  client.timeout = 8;
  client[oidc.customFetch] = async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== issuer || !['/token', '/.well-known/jwks.json'].includes(url.pathname) || url.search || url.hash) throw new PhoneVerificationError('UNAVAILABLE');
    const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000);
    const body = init.body instanceof Uint8Array ? new Uint8Array(init.body) : init.body;
    const response = await fetcher(url.href, { ...init, body, redirect: 'error', signal });
    if (!response.ok || !response.body) throw new PhoneVerificationError('UNAVAILABLE');
    const limit = url.pathname === '/token' ? 32768 : 131072;
    const reader = response.body.getReader(); let bytes = 0, chunks = 0, complete = false;
    const parts: Uint8Array[] = [];
    try {
      for (;;) {
        signal.throwIfAborted(); const part = await reader.read(); signal.throwIfAborted();
        if (part.done) { complete = true; break; }
        bytes += part.value.byteLength;
        if (bytes > limit || ++chunks > 2048) throw new PhoneVerificationError('UNAVAILABLE');
        parts.push(part.value);
      }
      return new Response(Buffer.concat(parts), { status: response.status, headers: response.headers });
    } finally { if (!complete) void reader.cancel().catch(() => undefined); reader.releaseLock(); }
  };
  // Code-grant back-channel TLS validation is insufficient for this contract:
  // explicitly require cryptographic ID-token signature validation using JWKS.
  oidc.enableNonRepudiationChecks(client);
  return {
    authorization(attempt: TelegramPhoneAttemptSecrets): string {
      const challenge = createHash('sha256').update(attempt.verifier).digest('base64url');
      return oidc.buildAuthorizationUrl(client, { response_type: 'code', redirect_uri: config.callbackUrl, scope: 'openid phone',
        state: attempt.state, nonce: attempt.nonce, code_challenge: challenge, code_challenge_method: 'S256' }).href;
    },
    async exchange(callback: URL, attempt: TelegramPhoneAttemptSecrets): Promise<TelegramPhoneClaims> {
      const fixed = new URL(config.callbackUrl);
      if (callback.origin !== fixed.origin || callback.pathname !== fixed.pathname || callback.hash || callback.href.length > 8192 ||
          [...callback.searchParams.keys()].some(key => callback.searchParams.getAll(key).length !== 1) ||
          callback.searchParams.get('state') !== attempt.state || !callback.searchParams.get('code') || callback.searchParams.has('error')) throw new PhoneVerificationError('INVALID_ATTEMPT');
      try {
        const tokens = await oidc.authorizationCodeGrant(client, callback, { expectedState: attempt.state, expectedNonce: attempt.nonce,
          pkceCodeVerifier: attempt.verifier, idTokenExpected: true });
        const claims = tokens.claims(), now = Math.floor(Date.now() / 1000), phone = normalizeTelegramPhone(claims?.phone_number);
        if (!claims || !phone || claims.phone_number_verified !== true || typeof claims.sub !== 'string' || !/^[^\s\u0000-\u001f\u007f]{1,128}$/.test(claims.sub) ||
            typeof claims.iat !== 'number' || claims.iat > now + 30 || claims.iat < now - 600 || typeof claims.exp !== 'number' || claims.exp <= now || !tokens.id_token) throw new PhoneVerificationError('INVALID_ATTEMPT');
        return { subject: claims.sub, phone, tokenHash: createHash('sha256').update(tokens.id_token).digest('hex') };
      } catch { throw new PhoneVerificationError('INVALID_ATTEMPT'); }
    },
  };
}
