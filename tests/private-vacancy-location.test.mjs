import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../src/lib/vacancy-store.ts', import.meta.url), 'utf8');

function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing source section ${start}`);
  return source.slice(from, to);
}

const selectedSource = [
  section('function publicVacancy(', '\nasync function findCity('),
  section('export async function getStoredVacancyById(', '\nexport async function getStoredVacancyForUser('),
  section('export async function listStoredVacancies(', '\nexport async function listStoredVacanciesForAdmin('),
].join('\n');

function harness(showExactAddress) {
  const exports = {};
  const raw = {
    id: '17c75a95-4667-47be-9a4d-74a3cdd5446b',
    address: 'Synthetic Street, 18',
    lat: 45.10101,
    lng: 38.99999,
    hasMapPoint: showExactAddress,
    showExactAddress,
  };
  const paths = [];
  const js = ts.transpileModule(selectedSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(js, {
    exports,
    Date,
    console,
    encodeURIComponent,
    isSupabaseRestConfigured: () => true,
    isUuid: () => true,
    vacancySelect: 'id,address,latitude,longitude,show_exact_address',
    mapVacancy: (row) => ({ ...row }),
    supabaseRest: async (path) => { paths.push(path); return [raw]; },
  });
  return { ...exports, raw, paths };
}

test('public vacancy detail/feed redact hidden exact location; owner can edit it', async () => {
  const store = harness(false);
  const publicValues = [
    await store.getStoredVacancyById(store.raw.id, { publicOnly: true }),
    ...(await store.listStoredVacancies()),
  ];
  for (const vacancy of publicValues) {
    assert.equal(vacancy.address, undefined);
    assert.equal(vacancy.lat, undefined);
    assert.equal(vacancy.lng, undefined);
    assert.equal(vacancy.hasMapPoint, false);
    assert.doesNotMatch(JSON.stringify(vacancy), /Synthetic Street|45\.10101|38\.99999/);
  }
  assert.equal((await store.getStoredVacancyById(store.raw.id)).address, store.raw.address);
  assert.equal(store.raw.address, 'Synthetic Street, 18');
});

test('public vacancy preserves an exact address when author selected public display', async () => {
  const store = harness(true);
  const values = [
    await store.getStoredVacancyById(store.raw.id, { publicOnly: true }),
    ...(await store.listStoredVacancies()),
  ];
  for (const vacancy of values) {
    assert.equal(vacancy.address, store.raw.address);
    assert.equal(vacancy.lat, store.raw.lat);
    assert.equal(vacancy.lng, store.raw.lng);
  }
});

test('anonymous vacancy edit route serializes no service-role vacancy data', async () => {
  const pageSource = readFileSync(new URL('../src/app/rabota/vakansii/[slug]/edit/page.tsx', import.meta.url), 'utf8');
  const js = ts.transpileModule(pageSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  const jsx = (type, props) => ({ type: typeof type === 'function' ? type.name : type, props });
  vm.runInNewContext(js, {
    exports,
    require: (name) => name === 'react/jsx-runtime'
      ? { jsx, jsxs: jsx, Fragment: 'Fragment' }
      : name === '@/lib/runtime-mode'
        ? { shouldShowFallbackContent: () => false }
        : name === '@/lib/data'
          ? { vacancies: [] }
          : { SiteHeader: () => null, VacancyEditClient: () => null, PublicationAuthGate: () => null },
  });
  const rendered = await exports.default({ params: Promise.resolve({ slug: '17c75a95-4667-47be-9a4d-74a3cdd5446b' }) });
  assert.equal(rendered.props.children[1].props.children.props.initialVacancy, undefined);
  assert.doesNotMatch(JSON.stringify(rendered), /Synthetic Street|latitude|longitude|address/);
});
