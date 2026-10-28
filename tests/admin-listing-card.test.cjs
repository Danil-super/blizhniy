const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {resolve} = require('node:path');
const test = require('node:test');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const ts = require('typescript');
function load(name) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(resolve(__dirname, '../src/components/admin', name + '.tsx'), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true},
  }).outputText;
  new Function('require', 'exports', code)(id => {
    if (id === './ListingManagementPhoto') return {ListingManagementPhoto: props => React.createElement('div', {'data-photo': props.photoId, 'data-listing': props.listingId, 'data-alt': props.alt})};
    if (id.endsWith('/PrivateDraftEditor')) return {draftButton: 'min-h-11'};
    if (id.endsWith('/ListingBadges')) return {ListingKindBadge: ({kind}) => React.createElement('span', null, kind), StatusBadge: ({status}) => React.createElement('span', null, status)};
    return require(id);
  }, exports);
  return exports[name];
}
test('admin catalogue card shows the same useful fields as an owner card and keeps admin-only actions', () => {
  const item = {id: '10000000-0000-4000-8000-000000000001', revision:'1', title:'Комод', status:'published', paid:true, blocked:false, blockReason:null,
    card:{kind:'prodam',price:'3500.00',city:'Сочи',district:'Центральный',coverPhotoId:'10000000-0000-4000-8000-000000000002'}};
  const html = renderToStaticMarkup(React.createElement(load('ListingManagementCard'), {actor:'admin', item, selected:false, busy:false, onOpen() {}}));
  assert.match(html, /<article/);
  for (const value of ['Комод', '3 500,00', 'Сочи, Центральный', 'published', 'data-photo="'+item.card.coverPhotoId+'"', 'Открыть объявление: Комод']) assert.ok(html.includes(value));
  assert.doesNotMatch(html, /razmestit|Снять с публикации|Оплатить/);
});
test('admin gallery bounds rendered thumbnails but exposes navigation to every saved photograph', () => {
  const photos = Array.from({length:12}, (_, index) => ({id:String(index)}));
  const html = renderToStaticMarkup(React.createElement(load('ListingManagementGallery'), {actor:'admin', listingId:'listing', photos}));
  assert.equal((html.match(/Показать фото /g) || []).length, 8);
  assert.ok(html.includes('1 / 12'));
  assert.ok(html.includes('Следующее фото'));
  assert.ok(html.includes('Фотография 1 из 12'));
  const empty = renderToStaticMarkup(React.createElement(load('ListingManagementGallery'), {actor:'admin', listingId:'listing', photos:[]}));
  assert.ok(empty.includes('Нет фотографий'));
});
