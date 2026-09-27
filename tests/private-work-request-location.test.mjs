import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const storeSource = readFileSync(new URL('../src/lib/work-request-store.ts', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('../src/app/rabota/zakazy/[slug]/page.tsx', import.meta.url), 'utf8');

test('an archived work request with an exact address does not expose its details through public metadata', async () => {
  const start = storeSource.indexOf('function publicWorkRequest(');
  const end = storeSource.indexOf('\nasync function findCity(', start);
  const lookupStart = storeSource.indexOf('export async function getStoredWorkRequestById(');
  const lookupEnd = storeSource.indexOf('\nexport async function listStoredWorkRequests(', lookupStart);
  assert.ok(start >= 0 && end > start && lookupStart >= 0 && lookupEnd > lookupStart);

  const raw = {
    id: '17c75a95-4667-47be-9a4d-74a3cdd5446b',
    status: 'archived',
    title: 'Private archived order',
    description: 'Meet at Synthetic Street, 18; 45.10101, 38.99999',
    address: 'Synthetic Street, 18',
    lat: 45.10101,
    lng: 38.99999,
    showExactAddress: true,
  };
  const requests = [];
  const storeExports = {};
  const storeJs = ts.transpileModule(`${storeSource.slice(start, end)}\n${storeSource.slice(lookupStart, lookupEnd)}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(storeJs, {
    exports: storeExports,
    console,
    encodeURIComponent,
    isSupabaseRestConfigured: () => true,
    isUuid: () => true,
    fetchWorkRequestRows: async (path) => {
      requests.push(path);
      return path.includes('&status=eq.published') ? [] : [raw];
    },
    mapWorkRequest: (row) => ({ ...row }),
  });

  const privateValue = await storeExports.getStoredWorkRequestById(raw.id);
  assert.equal(privateValue.address, raw.address);
  assert.equal(privateValue.lat, raw.lat);
  assert.equal(await storeExports.getStoredWorkRequestById(raw.id, { publicOnly: true }), undefined);
  assert.match(requests[1], /&status=eq\.published&limit=1/);

  const pageExports = {};
  const pageJs = ts.transpileModule(pageSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(pageJs, {
    exports: pageExports,
    require: (name) => name === '@/lib/work-request-store'
      ? { getStoredWorkRequestById: storeExports.getStoredWorkRequestById }
      : name === '@/lib/runtime-mode'
        ? { shouldShowFallbackContent: () => false }
        : {},
  });
  const metadata = await pageExports.generateMetadata({ params: Promise.resolve({ slug: raw.id }) });
  assert.equal(metadata.title, 'Заказ');
  assert.doesNotMatch(JSON.stringify(metadata), /Private archived order|Synthetic Street|45\.10101|38\.99999/);
});
