import assert from 'node:assert/strict';
import { test } from 'node:test';
import { issueBrowserProof, readBrowserProof, clearBrowserProofCookie } from '../src/lib/account-browser-proof.ts';

const secret = 's'.repeat(64);
const ip = '192.0.2.1';
const userAgent = 'SyntheticBrowser/1.0';
const now = Date.UTC(2026, 0, 1, 12);
const lifetime = 15 * 60 * 1000;
const cookieName = '__Host-blizhniy_human';
const pair = cookie => cookie.split(';')[0];
const headers = (cookie, agent = userAgent) => new Headers({ cookie, 'user-agent': agent });

test('browser proof is an opaque host cookie with exactly fifteen minutes of validity', () => {
  const issued = issueBrowserProof(secret, ip, userAgent, now);
  assert.equal(issued.expiresAt, now + lifetime);
  assert.match(issued.cookie, /^__Host-blizhniy_human=[^;\s]+;/);
  assert.match(issued.cookie, /(?:^|;\s*)Max-Age=900(?:;|$)/);
  for (const attribute of ['Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/']) {
    assert.ok(issued.cookie.split(';').map(value => value.trim()).includes(attribute), attribute);
  }
  assert.equal(/(?:^|;\s*)Domain=/i.test(issued.cookie), false);
  for (const privateValue of [ip, userAgent, secret, 'synthetic@example.invalid']) {
    assert.equal(issued.cookie.includes(privateValue), false);
  }
  assert.equal(readBrowserProof(headers(pair(issued.cookie)), secret, ip, now), issued.expiresAt);
});

test('reading a proof does not extend its fixed expiry and the exact expiry is denied', () => {
  const issued = issueBrowserProof(secret, ip, userAgent, now);
  const requestHeaders = headers(pair(issued.cookie));
  assert.equal(readBrowserProof(requestHeaders, secret, ip, now + lifetime - 1), issued.expiresAt);
  assert.equal(readBrowserProof(requestHeaders, secret, ip, now + lifetime), 0);
  assert.equal(readBrowserProof(requestHeaders, secret, ip, now + lifetime + 1), 0);
});

test('a correctly signed proof issued in the future is rejected', () => {
  const issued = issueBrowserProof(secret, ip, userAgent, now + 1);
  assert.equal(readBrowserProof(headers(pair(issued.cookie)), secret, ip, now), 0);
});

test('browser proof cannot be reused after an IP, user agent, or signing key change', () => {
  const issued = issueBrowserProof(secret, ip, userAgent, now);
  const cookie = pair(issued.cookie);
  assert.equal(readBrowserProof(headers(cookie), secret, '192.0.2.2', now), 0);
  assert.equal(readBrowserProof(headers(cookie, 'OtherSyntheticBrowser/2.0'), secret, ip, now), 0);
  assert.equal(readBrowserProof(new Headers({ cookie }), secret, ip, now), 0);
  assert.equal(readBrowserProof(headers(cookie), 't'.repeat(64), ip, now), 0);
});

test('every single-character proof mutation and a truncated or extended proof are denied', () => {
  const issued = issueBrowserProof(secret, ip, userAgent, now);
  const value = pair(issued.cookie).slice(cookieName.length + 1);
  for (let index = 0; index < value.length; index++) {
    const replacement = value[index] === 'a' ? 'b' : 'a';
    const tampered = value.slice(0, index) + replacement + value.slice(index + 1);
    assert.equal(readBrowserProof(headers(`${cookieName}=${tampered}`), secret, ip, now), 0, `mutation at ${index}`);
  }
  for (const malformed of [value.slice(0, -1), `${value}a`, '', 'malformed', '%00', '.'.repeat(5)]) {
    assert.equal(readBrowserProof(headers(`${cookieName}=${malformed}`), secret, ip, now), 0);
  }
});

test('missing, unrelated, and duplicate browser proof cookies are rejected', () => {
  const issued = issueBrowserProof(secret, ip, userAgent, now);
  const cookie = pair(issued.cookie);
  assert.equal(readBrowserProof(new Headers({ 'user-agent': userAgent }), secret, ip, now), 0);
  assert.equal(readBrowserProof(headers('unrelated=synthetic'), secret, ip, now), 0);
  assert.equal(readBrowserProof(headers(`${cookie}; ${cookie}`), secret, ip, now), 0);
  assert.equal(readBrowserProof(headers(`${cookieName}=malformed; ${cookie}`), secret, ip, now), 0);
  assert.equal(readBrowserProof(headers(`${cookie}; ${cookieName}=malformed`), secret, ip, now), 0);
  assert.equal(readBrowserProof(headers(`unrelated=synthetic; ${cookie}`), secret, ip, now), issued.expiresAt);
});

test('clearing browser proof expires the same secure host cookie', () => {
  const cleared = clearBrowserProofCookie();
  assert.match(cleared, /^__Host-blizhniy_human=;/);
  assert.match(cleared, /(?:^|;\s*)Max-Age=0(?:;|$)/);
  for (const attribute of ['Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/']) {
    assert.ok(cleared.split(';').map(value => value.trim()).includes(attribute), attribute);
  }
  assert.equal(/(?:^|;\s*)Domain=/i.test(cleared), false);
  assert.equal(readBrowserProof(headers(pair(cleared)), secret, ip, now), 0);
});
