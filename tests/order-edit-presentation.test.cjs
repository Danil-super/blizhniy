const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { dirname, resolve } = require('node:path');
const test = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const ts = require('typescript');

const root = resolve(__dirname, '..');
const owner = '11111111-1111-4111-8111-111111111111';

function formTree(initial, localPayment = true) {
  const jsx = (type, props) => ({ type, props });
  const amount = () => null, terms = () => null, calls = [];
  const dependencies = {
    react: { useRef: () => ({ current: null }), useState: value => [value, () => {}], useId: () => 'profession' },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/components/FormPanel': {}, '@/components/VacancyEmployerFields': {}, './VacancyEmployerFlow': {},
    '@/components/listings/ListingWorkflowProvider': { useListingPostmoderation: () => localPayment,useLocalPaymentSimulation:()=>localPayment },
    '@/components/listings/ListingFormControls': {}, '@/components/LegalConsentCheckbox': {},
    '@/lib/data': { professions: [] }, '@/components/listings/PrivateDraftEditor': { draftButton: 'button' },
    './WorkAmountField': { WorkAmountField: amount }, './ProfessionSelect': {},
    './VacancyTermsFields': { VacancyTermsFields: terms }, '@/components/PublicationPhotoEditor': {}, '@/components/CabinetFormValidation': {},
    './useWorkPublicationSave': { useWorkPublicationSave: () => ({ active: false, done: false, busy: false, uncertain: false, start: value => calls.push(value) }) },
  };
  const out = {};
  const code = ts.transpileModule(readFileSync(resolve(root, 'src/components/work/WorkPublicationForm.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function('exports', 'require', code)(out, name => {
    if (!Object.hasOwn(dependencies, name)) throw Error(`Unapproved test dependency: ${name}`);
    return dependencies[name];
  });
  const tree = out.WorkPublicationForm({ owner, kind: initial?.kind ?? 'workRequest', initial });
  const nodes = [];
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    nodes.push(node);
    [node.props?.children, node.props?.actions].flat(Infinity).forEach(walk);
  }
  walk(tree);
  return { tree, nodes, calls, amount, terms };
}

function snapshot({ paid = true, status = 'published', kind = 'workRequest', value = '3576.00' } = {}) {
  return { id: owner, kind, revision: '3', status, paid, photos: [],
    form: { kind, title: 'Ремонт в ванной', professionName: 'Сантехник', cityName: 'Крымск', description: 'Нужен ремонт', budget: value, salary: value } };
}

for (const kind of ['workRequest', 'vacancy']) {
  test(`${kind}: paid edits say save changes without draft or upcoming payment, using the existing update path`, () => {
    const { tree, nodes, calls } = formTree(snapshot({ kind }));
    const button = nodes.find(node => node.type === 'button' && node.props.children === 'Сохранить изменения');
    assert.ok(button, 'server-confirmed paid snapshots must expose Save changes');
    const text = JSON.stringify(nodes.filter(node => ['button', 'p'].includes(node.type)).map(node => node.props.children));
    assert.doesNotMatch(text, /Сохранить черновик|затем откроем оплату|после подтверждения оплаты|Отправить на модерацию/);
    button.props.onClick();
    assert.deepEqual(calls, [true], 'label changes must retain the canonical save/update path rather than create checkout');
    let prevented = false;
    tree.props.onSubmit({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.deepEqual(calls, [true, true], 'keyboard form submission must use the same paid update path, not checkout');
  });
}

test('a published-looking status without a confirmed paid flag still offers draft and payment', () => {
  const { nodes } = formTree(snapshot({ paid: false, status: 'published' }));
  const labels = nodes.filter(node => node.type === 'button').map(node => node.props.children);
  assert.ok(labels.includes('Сохранить черновик'));
  assert.ok(labels.includes('Оплатить'));
  assert.ok(!labels.includes('Сохранить изменения'), 'status text alone must not count as paid authority');
});

for (const [input, expected] of [['3576.00', '3576'], ['3576.50', '3576,50'], ['3576.05', '3576,05']]) {
  test(`work request edit presents ${input} as ${expected} without losing real kopecks`, () => {
    const { nodes, amount } = formTree(snapshot({ value: input }));
    assert.equal(nodes.find(node => node.type === amount).props.value, expected);
  });
}

test('vacancy payment terms use the same no-fake-decimals money presentation', () => {
  const { nodes, terms } = formTree(snapshot({ kind: 'vacancy', value: '3576.00' }));
  assert.equal(nodes.find(node => node.type === terms).props.salary, '3576');
});

function actualLoader(overrides = {}) {
  const cache = new Map();
  function load(relative) {
    const base = resolve(root, relative);
    const file = [base, `${base}.tsx`, `${base}.ts`].find(candidate => existsSync(candidate));
    if (!file) throw Error(`Cannot resolve ${relative}`);
    if (cache.has(file)) return cache.get(file);
    const out = {};
    cache.set(file, out);
    const code = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    new Function('require', 'exports', code)(name => {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name.endsWith('/SquareImageCropper')) return { SquareImageCropper: () => null };
      if (name.endsWith('/StoredMedia')) return { StoredMediaImage: ({ src, alt, ...props }) => React.createElement('img', { src, alt, ...props }) };
      if (name.endsWith('/client-listing-media')) return { productionListingMedia: { read() { throw Error('SSR must not fetch media'); } } };
      if (name.startsWith('@/')) return load(`src/${name.slice(2)}`);
      if (name.startsWith('.')) return load(resolve(dirname(file), name));
      return require(name);
    }, out);
    return out;
  }
  return load;
}

test('photo editing is one compact block with full uncropped images and controls outside each image', () => {
  const load = actualLoader();
  const { FormPhotoUploader } = load('src/components/FormPhotoUploader');
  const html = renderToStaticMarkup(React.createElement(FormPhotoUploader, {
    label: 'Фотографии', description: 'Первое фото — обложка.', maxPhotos: 6,
    defaultPhotos: ['https://example.invalid/portrait.png', 'https://example.invalid/landscape.png'],
  }));
  assert.match(html, /2\/6/);
  assert.doesNotMatch(html, /Превью/, 'there must not be a second titled preview panel below the uploader');
  assert.doesNotMatch(html, /sm:min-h-32/, 'the photo header must not reserve a large empty upload panel');
  const images = html.match(/<img\b[^>]*>/g) ?? [];
  assert.equal(images.length, 2);
  for (const image of images) {
    assert.match(image, /object-contain/, 'portrait and landscape photos must both be fully visible');
    assert.doesNotMatch(image, /object-cover/);
  }
  const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
  assert.ok(buttons.some(button => button.includes('Изменить кадр')));
  assert.ok(buttons.some(button => button.includes('Сделать обложкой')));
  assert.ok(buttons.some(button => button.includes('Убрать')));
  for (const button of buttons) assert.doesNotMatch(button, /class="[^"]*\babsolute\b/, 'editing controls must not obscure the image');
  assert.equal((html.match(/name="existingPhotos"/g) ?? []).length, 2, 'presentation changes must retain unchanged photos');
});

test('the actual public order page puts title first and omits the placeholder author heading', async () => {
  const request = { id: owner, title: 'Ремонт в ванной', author: 'Автор заказа', profession: 'Сантехник', city: 'Крымск',
    budget: '3 576 ₽', status: 'published', description: 'Нужен ремонт', images: [], createdAt: '2026-10-23T10:00:00Z' };
  const noop = () => null;
  const load = actualLoader({
    'next/navigation': { notFound() { throw Error('Unexpected notFound'); } },
    '@/components/BackLink': { BackLink: ({ children }) => React.createElement('a', null, children) },
    '@/components/DetailImageGallery': { DetailImageGallery: () => React.createElement('div', { 'data-testid': 'order-gallery' }) },
    '@/components/LocationMap': { LocationMap: noop }, '@/components/SiteHeader': { SiteHeader: noop },
    '@/components/VacancyApplicationButton': { VacancyApplicationButton: noop },
    '@/components/listings/ListingViewTracker': { ListingViewTracker: noop },
    '@/lib/map-location': { hasMapCoordinates: () => false }, '@/lib/mock-store': { listWorkRequests: () => [] },
    '@/lib/runtime-mode': { shouldShowFallbackContent: () => false }, '@/lib/supabase-rest': { isUuid: () => true },
    '@/lib/work-request-store': { getStoredWorkRequestById: async () => request, listWorkRequestsWithStored: () => [] },
  });
  const Page = load('src/app/rabota/zakazy/[slug]/page').default;
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ slug: owner }) }));
  assert.doesNotMatch(html, /Автор заказа/);
  assert.match(html, /<h1\b[^>]*>Ремонт в ванной<\/h1>/);
  assert.ok(html.indexOf('<h1') < html.indexOf('Сантехник'), 'the profession is supporting metadata below the title');
  assert.ok(html.indexOf('<h1') < html.indexOf('data-testid="order-gallery"'), 'title heads the order, not only the narrow side column');
  assert.match(html, /Сантехник/);
});
