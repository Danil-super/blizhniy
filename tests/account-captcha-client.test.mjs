import assert from 'node:assert/strict';
import { test } from 'node:test';
import { consumeAccountCaptchaResponse } from '../src/lib/local-account.ts';

test('only bounded server expiry hints update the human-check UI; no identity is conveyed', () => {
  const previous = globalThis.window;
  const events = [];
  globalThis.window = { dispatchEvent: event => { events.push(event); return true; } };
  try {
    for (const value of [null, 'garbage', '-1', String(Date.now() + 3600000)]) {
      consumeAccountCaptchaResponse(new Response(null, { headers: value === null ? {} : { 'X-Blizhniy-Human-Proof': value } }));
    }
    assert.equal(events.length, 0);
    const expiry = Date.now() + 899000;
    consumeAccountCaptchaResponse(new Response(null, { headers: { 'X-Blizhniy-Human-Proof': String(expiry) } }));
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'blizhniy-human-proof');
    assert.deepEqual(events[0].detail, { expiresAt: expiry });
    consumeAccountCaptchaResponse(new Response(null, { headers: { 'X-Blizhniy-Human-Proof': '0' } }));
    assert.deepEqual(events[1].detail, { expiresAt: 0 });
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});
