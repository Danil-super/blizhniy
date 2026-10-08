const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const root = resolve(__dirname, '..');
const uuid = '00000004-1111-4111-8111-000000000004';
const privateVacancy = { id: uuid, title: 'Owner-only vacancy', organization: 'Synthetic employer',
  city: 'Synthetic city', salary: '80000', status: 'published', phone: 'owner-only-phone',
  email: 'owner-only@example.invalid', description: 'Synthetic owner description' };

// Complete actual editor module; only initial hook scheduling, UI children,
// browser/auth/HTTP and demo storage boundaries are doubles. No save is invoked.
async function mount({ vacancyId = uuid, vacancies = [privateVacancy], initialVacancy,
  storedItems = [] } = {}) {
  let cursor = 0, identityReads = 0;
  const states = [], effects = [], calls = [];
  const jsx = (type, props) => ({ type: typeof type === 'function' ? type.name : type, props });
  const unused = () => { assert.fail('Read-only editor mount must not invoke a save/media boundary'); };
  const boundaries = {
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    react: {
      useState(initial) {
        const index = cursor++;
        if (!Object.hasOwn(states, index)) states[index] = initial;
        return [states[index], value => { states[index] = value; }];
      },
      useEffect(callback) { cursor++; effects.push(callback); },
      useMemo(callback) { cursor++; return callback(); },
    },
    '@/components/BackLink': { BackLink: 'BackLink' },
    '@/components/FormPanel': { FormPanel: 'FormPanel', Field: 'Field', PhotoField: 'PhotoField', TextAreaField: 'TextAreaField' },
    '@/components/VacancyEmployerFields': { VacancyEmployerFields: 'VacancyEmployerFields' },
    '@/components/VacancyFormValidator': { VacancyFormValidator: 'VacancyFormValidator' },
    '@/components/listings/ListingFormControls': { ListingLocationFields: 'ListingLocationFields' },
    '@/lib/cabinet-data-cache': { markCabinetDataChanged: unused },
    '@/lib/client-publication-media': { uploadPublicationImageSources: unused },
    '@/lib/client-user-profile': { resolveAuthenticatedClientUserIdentity: async () => {
      identityReads++; return { accessToken: 'synthetic-owner-token' };
    } },
    '@/lib/client-media-store': { storeMediaFile: unused },
    '@/lib/demo-publications': { readStoredDemoPublications: () => JSON.stringify(storedItems),
      writeStoredDemoPublications: unused, appendPublicationHistory: unused,
      withPublicationHistory: unused, withPublicationStatusHistory: unused, unpublishedVacancyStatus: 'Снята с публикации' },
    '@/lib/listing-price': { normalizeListingPrice: unused },
    '@/lib/vacancy-requisites': { normalizeVacancyRequisites: unused, validateVacancyRequisites: unused },
  };
  const module = { exports: {} };
  const js = ts.transpileModule(readFileSync(resolve(root, 'src/components/VacancyEditClient.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(js, { module, exports: module.exports, console, Promise, Date, Error,
    require: name => { assert.ok(Object.hasOwn(boundaries, name), 'Unexpected boundary: ' + name); return boundaries[name]; },
    fetch: async (path, options) => {
      calls.push({ path, options });
      assert.equal(path, '/api/cabinet/vacancies');
      assert.equal(options.method ?? 'GET', 'GET');
      return { ok: true, json: async () => ({ vacancies }) };
    },
  });
  const render = () => { cursor = 0; return module.exports.VacancyEditClient({ vacancyId, initialVacancy }); };
  const first = render();
  const cleanups = effects.splice(0).map(effect => effect());
  for (let i = 0; i < 30; i++) await Promise.resolve();
  const rendered = render();
  for (const cleanup of cleanups) if (cleanup) cleanup();
  return { first, rendered, calls, identityReads };
}

test('valid persisted vacancy UUID loads the owner API and renders its private editor fields', async () => {
  const h = await mount();
  assert.equal(h.identityReads, 1);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].options.cache, 'no-store');
  assert.equal(h.calls[0].options.headers.Authorization, 'Bearer synthetic-owner-token');
  assert.match(JSON.stringify(h.rendered), /Редактировать вакансию/);
  assert.match(JSON.stringify(h.rendered), /Owner-only vacancy/);
  assert.match(JSON.stringify(h.rendered), /owner-only-phone/);
  assert.doesNotMatch(JSON.stringify(h.first), /owner-only-phone/);
});

test('persisted UUID absent from owner API never falls back to initial or stale demo private contacts', async () => {
  const h = await mount({ vacancies: [], initialVacancy: privateVacancy,
    storedItems: [{ ...privateVacancy, type: 'vacancy', phone: 'stale-other-account-phone' }] });
  assert.equal(h.calls.length, 1);
  assert.match(JSON.stringify(h.rendered), /Вакансия не найдена/);
  assert.doesNotMatch(JSON.stringify([h.first, h.rendered]), /owner-only-phone|stale-other-account-phone/);
});

test('truncated malformed identity is not classified as a persisted UUID', async () => {
  const h = await mount({ vacancyId: '00000004-1111-4111-8000000000000', vacancies: [] });
  assert.equal(h.identityReads, 0);
  assert.deepEqual(h.calls, []);
  assert.match(JSON.stringify(h.rendered), /Вакансия не найдена/);
});

test('explicit non-UUID demo editor retains its existing local initial-data path', async () => {
  const vacancyId = 'demo-vacancy-local';
  const h = await mount({ vacancyId, initialVacancy: { ...privateVacancy, id: vacancyId, title: 'Explicit synthetic demo' } });
  assert.equal(h.identityReads, 0);
  assert.deepEqual(h.calls, []);
  assert.match(JSON.stringify(h.rendered), /Редактировать вакансию/);
  assert.match(JSON.stringify(h.rendered), /Explicit synthetic demo/);
});
