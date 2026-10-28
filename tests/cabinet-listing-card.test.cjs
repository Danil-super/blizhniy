const assert = require('node:assert/strict');
const {readFileSync, existsSync} = require('node:fs');
const {resolve, dirname} = require('node:path');
const test = require('node:test');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const ts = require('typescript');

function loadCard() {
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    const exports = {}; cache.set(path, exports);
    const code = ts.transpileModule(readFileSync(path, 'utf8'), {fileName: path, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    }}).outputText;
    new Function('require', 'exports', code)((id) => {
      if (id === 'next/link') return {__esModule: true, default: ({children, ...props}) => React.createElement('a', props, children)};
      if (id === 'next/image') return {__esModule: true, default: props => {const imageProps = {...props}; delete imageProps.unoptimized; return React.createElement('img', imageProps);}};
      if (id.endsWith('/PrivateDraftEditor')) return {draftButton: 'min-h-11 rounded-lg border px-3'};
      if (id === '@/lib/client-listing-media') return {productionListingMedia: {read: () => {throw Error('SSR must not read private image');}}};
      if (id === '@/lib/client-media-store') return {resolveStoredMediaUrl: async value => value};
      if (id === '@/lib/local-account') return {notifyAccountSessionChange() {}};
      if (id.endsWith('/ListingShareButton')) return {ListingShareButton: () => null};
      if (id.endsWith('/ListingViewCounter')) return {ListingViewCounter: () => null};
      if (!id.startsWith('.') && !id.startsWith('@/')) return require(id);
      const base = id.startsWith('@/') ? resolve(__dirname, '../src', id.slice(2)) : resolve(dirname(path), id);
      const filename = [base, `${base}.ts`, `${base}.tsx`].find(candidate => existsSync(candidate));
      assert.ok(filename, `Actual UI module ${id} exists`);
      return load(filename);
    }, exports);
    return exports;
  }
  return load(resolve(__dirname, '../src/components/listings/CabinetListingCard.tsx')).CabinetListingCard;
}
const item = (status, extra = {}) => ({id: '10000000-0000-4000-8000-000000000001', revision: '2', kind: 'prodam', title: 'Комод из дерева', price: '3500.00',
  card: {city: 'Сочи', district: 'Центральный', coverPhotoId: null, status, blockReason: null, ...extra}});
function html(status, extra) {
  return renderToStaticMarkup(React.createElement(loadCard(), {owner: '10000000-0000-4000-8000-000000000002', item: item(status, extra), open: false, onToggle() {}}, null));
}
for (const [status, label] of Object.entries({draft:'Черновик', pending_payment:'Ожидает оплату', paid:'Оплачено', published:'Опубликовано', sold:'Продано', archived:'Архив', expired:'Истек срок', blocked:'Заблокировано'})) {
  test(`cabinet catalogue card visibly conveys ${status} without opening payment`, () => {
    const markup = html(status);
    assert.ok(markup.includes(label));
    assert.ok(markup.includes('Комод из дерева'));
    assert.ok(markup.includes('3 500,00'));
    assert.ok(markup.includes('Сочи, Центральный'));
    assert.match(markup, /<article\b/);
    assert.doesNotMatch(markup, /<form\b/);
  });
}
test('only editable drafts link to the canonical editor; published cards link to public listing', () => {
  assert.ok(html('draft').includes('/razmestit/obyavlenie?draft='));
  const published = html('published');
  assert.doesNotMatch(published, /Редактировать|razmestit\/obyavlenie/);
  assert.ok(published.includes('/obyavlenie/10000000-0000-4000-8000-000000000001'));
});
test('blocked card shows escaped reason, not a payment action', () => {
  const markup = html('blocked', {blockReason: '<script>Нарушение правил</script>'});
  assert.ok(markup.includes('&lt;script&gt;Нарушение правил&lt;/script&gt;'));
  assert.doesNotMatch(markup, /<script>|Оплатить размещение/i);
});
test('published status keeps a high-contrast green foreground on the light badge', () => {
  assert.match(html('published'), /text-emerald-800/);
});
test('moderation image area is intrinsically bounded, not a full-width padded stage', () => {
  const source = readFileSync(resolve(__dirname, '../src/components/admin/ModerationPhotoPreview.tsx'), 'utf8');
  assert.match(source, /w-fit/);
  assert.match(source, /max-w-full/);
  assert.doesNotMatch(source, /min-h-80|h-56 w-full|sm:h-80/);
});
test('cabinet badges are shared without importing public-card tracking or stored-media dependencies', () => {
  const source = readFileSync(resolve(__dirname, '../src/components/listings/CabinetListingCard.tsx'), 'utf8');
  assert.match(source, /from ['"]\.\/ListingBadges['"]/);
  assert.doesNotMatch(source, /from ['"]\.\/ListingCard['"]/);
});
