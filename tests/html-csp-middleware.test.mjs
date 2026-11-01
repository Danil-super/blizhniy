import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { NextRequest, NextResponse } = require('next/server');
const { unstable_doesMiddlewareMatch } = require('next/experimental/testing/server');
const { loadLocalPrimaryModule } = require('../scripts/local-primary-modules.cjs');
const exports = {};
const javascript = ts.transpileModule(readFileSync(new URL('../src/middleware.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
new Function('require', 'exports', javascript)(specifier => {
  if (specifier === 'next/server') return require(specifier);
  if (specifier.startsWith('./lib/')) return loadLocalPrimaryModule(specifier.slice('./lib/'.length));
  throw new Error(`Unexpected middleware dependency: ${specifier}`);
}, exports);
const { middleware, config } = exports;

// Node runs this file in its own process. Keep environment changes scoped to
// sequential tests, including assertion failures, without touching local .env.
async function withEnvironment(settings, run) {
  const selected = { NODE_ENV: 'production', BLIZHNIY_AUTH_MODE: 'postgres', BLIZHNIY_CSP_MODE: undefined,
    NEXT_PUBLIC_SUPABASE_URL: undefined, ...settings };
  const original = new Map(Object.keys(selected).map(key => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(selected)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return await run();
  } finally {
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function request(path = '/', headers = {}) {
  return new NextRequest(new URL(path, 'https://app.example.invalid'), { headers });
}

function forwarded(response, name) {
  return response.headers.get(`x-middleware-request-${name}`);
}

function assertNextPolicy(response, header) {
  assert.ok(response instanceof NextResponse);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-middleware-next'), '1');
  const nonce = forwarded(response, 'x-nonce');
  assert.match(nonce, /^[A-Za-z0-9+/]{32}$/);
  assert.equal(Buffer.from(nonce, 'base64').length, 24);
  const policy = response.headers.get(header);
  assert.ok(policy);
  assert.equal(forwarded(response, 'content-security-policy'), policy);
  assert.ok(policy.includes(`'nonce-${nonce}'`));
  const overridden = response.headers.get('x-middleware-override-headers').split(',');
  assert.ok(overridden.includes('x-nonce'));
  assert.ok(overridden.includes('content-security-policy'));
  assert.equal(forwarded(response, 'content-security-policy-report-only'), null);
  assert.equal(response.headers.get('x-nonce'), null);
  assert.match(response.headers.get('cache-control'), /private/);
  assert.match(response.headers.get('cache-control'), /no-store/);
  return { nonce, policy };
}

test('production defaults to report-only while Next receives a nonce-bearing rendering policy', { concurrency: false }, async () => {
  await withEnvironment({}, () => {
    const response = middleware(request('/katalog'));
    const { policy } = assertNextPolicy(response, 'content-security-policy-report-only');
    assert.equal(response.headers.get('content-security-policy'), null);
    assert.ok(policy.includes("'strict-dynamic'"));
    const script = policy.split(';').find(value => value.trim().startsWith('script-src '));
    assert.ok(!script.includes('unsafe-inline'));
    assert.ok(!script.includes('unsafe-eval'));
  });
});

test('explicit enforce uses the same nonce and policy for renderer and browser', { concurrency: false }, async () => {
  await withEnvironment({ BLIZHNIY_CSP_MODE: 'enforce' }, () => {
    const response = middleware(request('/kabinet'));
    assertNextPolicy(response, 'content-security-policy');
    assert.equal(response.headers.get('content-security-policy-report-only'), null);
  });
});

test('SSR, Flight and prefetch requests replace every caller-selected policy and nonce', { concurrency: false }, async () => {
  await withEnvironment({}, () => {
    const nonces = new Set();
    for (const headers of [{}, { rsc: '1', 'next-router-state-tree': 'synthetic-tree' },
      { 'next-router-prefetch': '1', purpose: 'prefetch', 'sec-purpose': 'prefetch' }]) {
      const incoming = request('/katalog?_rsc=synthetic', { ...headers, 'x-nonce': 'client-selected',
        'content-security-policy': "default-src *; script-src 'unsafe-inline'",
        'content-security-policy-report-only': 'default-src *' });
      const response = middleware(incoming);
      const { nonce, policy } = assertNextPolicy(response, 'content-security-policy-report-only');
      nonces.add(nonce);
      assert.ok(!policy.includes('client-selected'));
      assert.equal(response.headers.get('content-security-policy'), null);
      assert.equal(incoming.headers.get('x-nonce'), 'client-selected');
    }
    assert.equal(nonces.size, 3);
  });
});

test('each middleware invocation creates a fresh 192-bit nonce', { concurrency: false }, async () => {
  await withEnvironment({ BLIZHNIY_CSP_MODE: 'enforce' }, () => {
    const nonces = new Set();
    for (let index = 0; index < 64; index += 1) {
      nonces.add(assertNextPolicy(middleware(request('/')), 'content-security-policy').nonce);
    }
    assert.equal(nonces.size, 64);
  });
});

test('primary backend never grants legacy access even when stale legacy configuration is invalid', { concurrency: false }, async () => {
  for (const origin of ['https://legacy.example.invalid', 'http://legacy.example.invalid', 'not a URL']) {
    await withEnvironment({ NEXT_PUBLIC_SUPABASE_URL: origin }, () => {
      const { policy } = assertNextPolicy(middleware(request()), 'content-security-policy-report-only');
      assert.ok(!policy.includes('legacy.example.invalid'));
      assert.ok(!policy.includes('supabase'));
    });
  }
});

test('selected legacy backend adds only the configured canonical HTTPS and WSS origin', { concurrency: false }, async () => {
  for (const authMode of [undefined, 'local']) {
    await withEnvironment({ BLIZHNIY_AUTH_MODE: authMode, NEXT_PUBLIC_SUPABASE_URL: 'https://legacy.example.invalid' }, () => {
      const { policy } = assertNextPolicy(middleware(request()), 'content-security-policy-report-only');
      const directives = new Map(policy.split(';').map(value => {
        const [name, ...sources] = value.trim().split(/\s+/);
        return [name, sources];
      }));
      assert.ok(directives.get('connect-src').includes('https://legacy.example.invalid'));
      assert.ok(directives.get('connect-src').includes('wss://legacy.example.invalid'));
      assert.ok(directives.get('img-src').includes('https://legacy.example.invalid'));
      assert.ok(!directives.get('script-src').includes('https://legacy.example.invalid'));
      assert.ok(!directives.get('frame-src').includes('https://legacy.example.invalid'));
    });
  }
});

test('unknown mode and unsafe selected legacy configuration fail closed without caching', { concurrency: false }, async () => {
  const invalid = ['', 'off', 'Enforce', "enforce; default-src *"].map(mode => ({ BLIZHNIY_CSP_MODE: mode }));
  invalid.push(...['http://legacy.example.invalid', 'https://legacy.example.invalid/path',
    'https://user:password@legacy.example.invalid', 'https://legacy.example.invalid?query=1',
    "https://legacy.example.invalid';script-src *"].map(origin => ({ BLIZHNIY_AUTH_MODE: 'local', NEXT_PUBLIC_SUPABASE_URL: origin })));
  for (const settings of invalid) {
    await withEnvironment(settings, async () => {
      const response = middleware(request('/kabinet'));
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('content-security-policy'), "default-src 'none'; frame-ancestors 'none'");
      assert.equal(response.headers.get('content-security-policy-report-only'), null);
      assert.equal(response.headers.get('x-middleware-next'), null);
      assert.equal(response.headers.get('x-middleware-override-headers'), null);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(await response.text(), 'Page security configuration unavailable');
    });
  }
});

test('request authentication context is preserved for downstream guards without new browser response headers', { concurrency: false }, async () => {
  await withEnvironment({}, () => {
    const response = middleware(request('/kabinet', { cookie: 'synthetic-session=value',
      authorization: 'Bearer synthetic-token', 'x-csrf-token': 'synthetic-csrf' }));
    assertNextPolicy(response, 'content-security-policy-report-only');
    for (const [name, value] of [['cookie', 'synthetic-session=value'], ['authorization', 'Bearer synthetic-token'],
      ['x-csrf-token', 'synthetic-csrf']]) {
      // x-middleware-request-* is Next's internal request forwarding protocol.
      assert.equal(forwarded(response, name), value);
      assert.equal(response.headers.get(name), null);
    }
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(response.headers.get('location'), null);
  });
});

test('Next matcher protects HTML and Flight including prefetch, unknown extensions and normalized paths', () => {
  for (const path of ['/', '/katalog', '/kabinet', '/not-found', '/unknown.foo', '/apiary',
    '/catalog.json', '/api/../kabinet', '/api/%2e%2e/kabinet', '/images/../kabinet']) {
    const incoming = request(path);
    for (const headers of [{}, { 'next-router-prefetch': '1', purpose: 'prefetch' }, { rsc: '1' }]) {
      assert.equal(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: incoming.url, headers }), true, path);
    }
  }
});

test('Next matcher excludes API, immutable assets and metadata without an extension-wide bypass', () => {
  for (const path of ['/api', '/api/health', '/api/csp-report', '/api/../api/health',
    '/_next/static/chunks/app.js', '/_next/image?url=%2Fimages%2Fphoto.webp&w=256&q=75',
    '/images/categories/home-dacha.webp', '/fonts/primary.woff2', '/assets/animation.json',
    '/favicon.ico', '/robots.txt', '/sitemap.xml', '/sitemap-1.xml', '/icon.svg', '/icon.png', '/apple-icon.png']) {
    assert.equal(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: request(path).url }), false, path);
  }
});

test('document prefetch hints cannot force the renderer into an incomplete Flight tree', { concurrency: false }, async () => {
  await withEnvironment({}, () => {
    const hints = { 'next-router-prefetch': '1', 'next-router-segment-prefetch': '/synthetic', purpose: 'prefetch' };
    const document = middleware(request('/', hints));
    assertNextPolicy(document, 'content-security-policy-report-only');
    assert.equal(forwarded(document, 'next-router-prefetch'), null);
    assert.equal(forwarded(document, 'next-router-segment-prefetch'), null);
    assert.equal(forwarded(document, 'purpose'), 'prefetch');
    const flight = middleware(request('/', { ...hints, rsc: '1' }));
    assert.equal(forwarded(flight, 'rsc'), '1');
    assert.equal(forwarded(flight, 'next-router-prefetch'), '1');
    assert.equal(forwarded(flight, 'next-router-segment-prefetch'), '/synthetic');
  });
});
