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
    new Function('require', 'exports', code)(id => {
      if (id === 'next/link') return {__esModule: true, default: ({children, ...props}) => React.createElement('a', props, children)};
      if (id === 'next/image') return {__esModule: true, default: props => {const image = {...props}; delete image.unoptimized; return React.createElement('img', image);}};
      if (id === '@/lib/client-listing-media') return {productionListingMedia: {read: () => {throw Error('SSR cannot read a private thumbnail');}}};
      if (id === '@/lib/local-account') return {notifyAccountSessionChange() {}};
      if (!id.startsWith('.') && !id.startsWith('@/')) return require(id);
      const base = id.startsWith('@/') ? resolve(__dirname, '../src', id.slice(2)) : resolve(dirname(path), id);
      const filename = [base, `${base}.ts`, `${base}.tsx`].find(candidate => existsSync(candidate));
      assert.ok(filename, `UI dependency ${id} exists`);
      return load(filename);
    }, exports);
    return exports;
  }
  return load(resolve(__dirname, '../src/components/listings/CabinetListingCard.tsx')).CabinetListingCard;
}

const id = '10000000-0000-4000-8000-000000000001';
function blockedCard() {
  const item = {id, revision: '7', kind: 'prodam', title: 'Моё заблокированное объявление', price: '3500.00',
    card: {city: 'Сочи', district: null, coverPhotoId: null, status: 'blocked', blockReason: 'Исправьте описание'}};
  return renderToStaticMarkup(React.createElement(loadCard(), {
    owner: '10000000-0000-4000-8000-000000000002', item, open: false, onToggle() {}, managePublication: true,
  }, null));
}

test('postmoderation owner can reopen a blocked listing in the canonical editor', () => {
  const html = blockedCard();
  assert.match(html, new RegExp(`href="/razmestit/obyavlenie\\?draft=${id}"[^>]*>Редактировать</a>`));
});

test('blocked owner card retains its reason and does not offer payment or self-unblocking', () => {
  const html = blockedCard();
  assert.match(html, /Исправьте описание/);
  assert.doesNotMatch(html, /Оплатить|Опубликовать снова|Восстановить публикацию/);
});
