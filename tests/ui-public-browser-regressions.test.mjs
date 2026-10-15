import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');
const { renderToString } = require('react-dom/server');
const { getPathMatch } = require('next/dist/shared/lib/router/utils/path-match');
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function load(code, dependencies = {}, globals = {}) {
  const module = { exports: {} };
  const compiled = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(compiled, {
    ...globals,
    module,
    exports: module.exports,
    require: (id) => {
      if (Object.hasOwn(dependencies, id)) return dependencies[id];
      if (id === 'react' || id === 'react/jsx-runtime') return require(id);
      throw new Error(`Unexpected UI test dependency: ${id}`);
    },
  });
  return module.exports;
}

function functionsFrom(path, names) {
  const code = source(path);
  const ast = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return ast.statements
    .filter((statement) => ts.isFunctionDeclaration(statement) && names.includes(statement.name?.text))
    .map((statement) => statement.getText(ast))
    .join('\n');
}

function findElement(element, predicate) {
  if (!element || typeof element !== 'object') return undefined;
  if (predicate(element)) return element;
  for (const child of [element.props?.children].flat(Infinity)) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return undefined;
}

test('UI classifier legacy URL resolves to the existing catalog before a wildcard can intercept it', async () => {
  const config = load(source('next.config.ts'), {}, { process: { env: {} } }).default;
  const redirects = await config.redirects();
  const rule = redirects.find((redirect) => getPathMatch(redirect.source)('/krasnodar/rabota/specialisty/klassifikator'));
  assert.ok(rule);
  assert.equal(rule.destination, '/rabota/specialisty');
  assert.equal(rule.permanent, true);
  const detailRule = redirects.find((redirect) => getPathMatch(redirect.source)('/krasnodar/rabota/specialisty/known-specialist'));
  assert.equal(detailRule.destination, '/rabota/specialisty/:path*', 'other specialist aliases keep their wildcard');
});

function listingPresentation() {
  const path = 'src/components/listings/ListingPages.tsx';
  const code = functionsFrom(path, ['listingImageTone', 'listingCategoryName', 'toDemoListing', 'slugifySubcategory', 'ListingDetailPage']);
  const componentNames = ['SiteHeader', 'ListingViewTracker', 'Breadcrumbs', 'BackLink', 'ListingKindBadge', 'StatusBadge', 'MapPin', 'ListingMediaGallery', 'Phone', 'Mail', 'MessageCircle', 'ListingShareButton', 'ListingSellerCard', 'LocationMap', 'BookingCalculator', 'DeliveryInfoCard'];
  return load(code, {}, {
    ...Object.fromEntries(componentNames.map((name) => [name, name])),
    fallbackCategories: [{ slug: 'sad-i-rasteniya', name: 'Сад и огород', children: ['Саженцы'] }],
    instrumentSubcategories: load(source('src/lib/instrument-subcategories.ts')).instrumentSubcategories,
    posudaSubcategories: load(source('src/lib/posuda-subcategories.ts')).posudaSubcategories,
    hasListingMapPoint: () => false,
    listingSellerStats: () => ({ registeredSince: '', listingCount: 1, soldCount: 0 }),
    normalizeMessengerHref: () => undefined,
    listingPlaceLabel: () => 'Краснодар',
    formatPublicationDateTime: () => '',
    formatListingDateOnly: () => '',
    listingSellerName: () => 'Продавец',
    sellerProfileHref: () => '/prodavets/owner',
    showDeliveryUi: false,
    notFound: () => { throw new Error('unexpected notFound'); },
  });
}

test('UI root-category listing has one category breadcrumb and never invents a child URL', () => {
  const presentation = listingPresentation();
  const listing = presentation.toDemoListing({
    id: 'root-listing', slug: 'root-listing', kind: 'kuplyu', title: 'Куплю саженцы гортензии',
    categorySlug: 'sad-i-rasteniya', subcategory: 'Сад и огород', city: 'Краснодар',
    status: 'published', imageTone: 'green',
  });
  const page = presentation.ListingDetailPage({ slug: listing.slug, listingOverride: listing });
  const breadcrumbs = findElement(page, (element) => element.type === 'Breadcrumbs').props.items;
  assert.deepEqual(JSON.parse(JSON.stringify(breadcrumbs)), [
    { label: 'Сад и огород', href: '/katalog/sad-i-rasteniya' },
    { label: 'Куплю саженцы гортензии' },
  ]);
  assert.equal(listing.subcategorySlug, '');
});

test('UI real child listing retains its subcategory breadcrumb', () => {
  const presentation = listingPresentation();
  const listing = presentation.toDemoListing({
    id: 'child-listing', slug: 'child-listing', kind: 'prodam', title: 'Саженцы',
    categorySlug: 'sad-i-rasteniya', subcategory: 'Саженцы', city: 'Краснодар',
    status: 'published', imageTone: 'green',
  });
  const breadcrumbs = findElement(presentation.ListingDetailPage({ slug: listing.slug, listingOverride: listing }), (element) => element.type === 'Breadcrumbs').props.items;
  assert.equal(breadcrumbs.length, 3);
  assert.equal(breadcrumbs[1].label, 'Саженцы');
  assert.equal(breadcrumbs[1].href, `/katalog/sad-i-rasteniya/${listing.subcategorySlug}`);
});

function hookRenderer() {
  const state = [];
  const refs = [];
  const effects = new Map();
  let cursor = 0;
  let pending = [];
  return {
    hooks: {
      useState(initial) {
        const index = cursor++;
        if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
        return [state[index], (value) => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
      },
      useRef(initial) {
        const index = cursor++;
        return refs[index] ??= { current: initial };
      },
      useEffect(effect, dependencies) {
        const index = cursor++;
        const previous = effects.get(index);
        if (!previous || dependencies.some((value, position) => value !== previous.dependencies[position])) {
          pending.push(() => {
            previous?.cleanup?.();
            effects.set(index, { dependencies, cleanup: effect() });
          });
        }
      },
    },
    render(Component, props) { cursor = 0; return Component(props); },
    mountEffects() { const queued = pending; pending = []; queued.forEach((effect) => effect()); },
    cleanup() { for (const effect of effects.values()) effect.cleanup?.(); },
  };
}

test('UI mobile menu Escape closes the panel and restores focus to its toggle', () => {
  const renderer = hookRenderer();
  const listeners = new Map();
  const document = {
    addEventListener: (type, handler) => listeners.set(type, handler),
    removeEventListener: (type, handler) => { if (listeners.get(type) === handler) listeners.delete(type); },
  };
  const { HeaderNav } = load(source('src/components/HeaderNav.tsx'), {
    react: renderer.hooks,
    'next/link': { default: 'a' },
    'lucide-react': { ChevronRight: 'svg', Menu: 'svg', X: 'svg' },
    '@/components/auth/useAuthState': { useAuthState: () => ({ state: 'anonymous' }) },
  }, { document });
  let focusCount = 0;
  const toggleNode = { focus() { focusCount++; } };
  let tree = renderer.render(HeaderNav);
  let toggle = findElement(tree, (element) => element.type === 'button');
  if (toggle.props.ref) toggle.props.ref.current = toggleNode;
  renderer.mountEffects();
  toggle.props.onClick();
  tree = renderer.render(HeaderNav);
  renderer.mountEffects();
  assert.equal(findElement(tree, (element) => element.type === 'button').props['aria-expanded'], true);
  listeners.get('keydown')?.({ key: 'Escape', preventDefault() {} });
  tree = renderer.render(HeaderNav);
  renderer.mountEffects();
  assert.equal(findElement(tree, (element) => element.type === 'button').props['aria-expanded'], false);
  assert.equal(focusCount, 1);
  renderer.cleanup();
  assert.equal(listeners.size, 0, 'menu event handlers are removed on unmount');
});

function viewModule(window) {
  return load(source('src/lib/listing-views.ts'), {}, { window, Event, CustomEvent });
}

function counterModule(hooks, views, window) {
  return load(source('src/components/listings/ListingViewCounter.tsx'), {
    react: hooks,
    'lottie-web': { default: { loadAnimation() { throw new Error('animation not mounted in small test'); } } },
    '@/lib/listing-views': views,
    '../../../eyes.json': { default: {} },
  }, { window, CustomEvent });
}

test('UI view-counter first client render equals SSR even when a previous visit added local views', () => {
  let storageReads = 0;
  const browserWindow = { localStorage: { getItem: () => { storageReads++; return JSON.stringify({ 'listing-ui-fixture': 7 }); } } };
  const serverViews = viewModule(undefined);
  const clientViews = viewModule(browserWindow);
  const server = counterModule(React, serverViews, undefined).ListingViewCounter;
  const client = counterModule(React, clientViews, browserWindow).ListingViewCounter;
  for (const initialViews of [undefined, 12, -4, 12.9, NaN, Infinity]) {
    const props = { listingId: 'listing-ui-fixture', initialViews };
    assert.equal(renderToString(React.createElement(client, props)), renderToString(React.createElement(server, props)));
  }
  assert.equal(storageReads, 0, 'browser-only storage must not be read before hydration');
});

test('UI view-counter synchronizes local views after hydration and listens for later changes', () => {
  const renderer = hookRenderer();
  const listeners = new Map();
  let extras = 7;
  const window = {
    localStorage: { getItem: () => JSON.stringify({ 'listing-ui-fixture': extras }) },
    addEventListener: (type, handler) => listeners.set(type, handler),
    removeEventListener: (type) => listeners.delete(type),
  };
  const views = viewModule(window);
  const { ListingViewCounter } = counterModule(renderer.hooks, views, window);
  const props = { listingId: 'listing-ui-fixture', initialViews: 12 };
  renderer.render(ListingViewCounter, props);
  renderer.mountEffects();
  assert.equal(renderer.render(ListingViewCounter, props).props['aria-label'], '19 просмотров');
  extras = 8;
  listeners.get('storage')();
  assert.equal(renderer.render(ListingViewCounter, props).props['aria-label'], '20 просмотров');
  renderer.cleanup();
  assert.equal(listeners.size, 0);
});

test('UI public category child labels are unique while all listing scope IDs remain intact', () => {
  const code = `${functionsFrom('src/lib/category-contract.ts', ['mapPublicCategoryRows'])}\nexports.mapPublicCategoryRows = mapPublicCategoryRows;`;
  const { mapPublicCategoryRows } = load(code);
  const [category] = mapPublicCategoryRows([
    { id: 'root', name: 'Красота и здоровье', slug: 'krasota-i-zdorovie', active: true },
    { id: 'first', parent_id: 'root', name: 'Парикмахеры', active: true, sort_order: 1 },
    { id: 'duplicate', parent_id: 'root', name: 'Парикмахеры', active: true, sort_order: 2 },
    { id: 'nails', parent_id: 'root', name: 'Маникюр и педикюр', active: true, sort_order: 3 },
    { id: 'hidden', parent_id: 'root', name: 'Неактивная услуга', active: false, sort_order: 4 },
  ]);
  assert.deepEqual(Array.from(category.children), ['Парикмахеры', 'Маникюр и педикюр']);
  assert.deepEqual(Array.from(category.listingScope.children, (child) => child.id), ['first', 'duplicate', 'nails', 'hidden']);
});

function authFormPresentation() {
  return load(source('src/components/auth/AuthForm.tsx'), {
    'next/link': { default: 'a' },
    'next/navigation': { useRouter: () => ({}) },
    'lucide-react': { Eye: 'svg', EyeOff: 'svg' },
    '@/components/TurnstileWidget': { TurnstileWidget: () => null },
    '@/lib/supabase-browser': { isSupabaseBrowserConfigured: () => false },
    '@/lib/turnstile-shared': { TURNSTILE_ERROR_MESSAGE: 'Captcha error' },
    '@/lib/turnstile-public-config': load(source('src/lib/turnstile-public-config.ts'), {}, { process: { env: {} } }),
    '@/lib/registration-legal': { REGISTRATION_LEGAL_VERSIONS: {} },
    '@/lib/local-development': load(source('src/lib/local-development.ts'), {}, { process: { env: {} } }),
  }, { process: { env: {} } }).AuthForm;
}

test('UI listing entry page has exactly one main h1 for all listing filters', async () => {
  const { ListingEntryNav } = load(source('src/components/ListingEntryNav.tsx'), {
    'next/link': { default: 'a' },
    'lucide-react': { Gift: 'svg', PlusCircle: 'svg', Search: 'svg', ShoppingBag: 'svg', Tags: 'svg' },
  });
  const { default: Page } = load(functionsFrom('src/app/obyavleniya/page.tsx', ['normalizeListingKind', 'Page']), {}, {
    SiteHeader: () => null,
    ListingEntryNav,
    HomeListings: () => React.createElement('section', null, React.createElement('h2', null, 'Объявления рядом')),
    parseListingPage: () => 1,
  });
  for (const kind of [undefined, 'prodam', 'kuplyu', 'otdam-darom', 'arenda']) {
    const markup = renderToString(await Page({ searchParams: Promise.resolve({ kind }) }));
    assert.equal((markup.match(/<h1(?:\s|>)/g) ?? []).length, 1, `one main h1 for kind=${kind}`);
  }
});

test('UI standalone authentication page has exactly one main h1 without changing shared form headings', () => {
  const { AuthPage } = load(functionsFrom('src/components/MvpDashboard.tsx', ['AuthPage']), {}, {
    SiteHeader: () => null,
    AuthForm: authFormPresentation(),
  });
  const markup = renderToString(React.createElement(AuthPage));
  assert.equal((markup.match(/<h1(?:\s|>)/g) ?? []).length, 1);
});

test('UI signed-out publication gate retains one main h1 when rendering the shared authentication form', () => {
  const { PublicationAuthGate } = load(source('src/components/auth/PublicationAuthGate.tsx'), {
    '@/components/auth/AuthForm': { AuthForm: authFormPresentation() },
    '@/components/auth/useAuthState': { useAuthState: () => ({ state: 'signed-out' }) },
    '@/components/auth/AccountAuthProvider': { usePrimaryAccountAuth: () => null },
    '@/components/auth/LocalAccountForm': { LocalAccountForm: () => { throw new Error('Legacy gate must not mount primary form'); } },
    '@/lib/local-account': {notifyAccountSessionChange:()=>{throw new Error('Legacy render must not refresh primary auth');}},
    'next/link': { default: ({ children }) => React.createElement('a', null, children) },
  });
  const markup = renderToString(React.createElement(PublicationAuthGate, { title: 'Войдите для размещения' }));
  assert.equal((markup.match(/<h1(?:\s|>)/g) ?? []).length, 1);
  assert.match(markup, /Войдите для размещения/);
});
