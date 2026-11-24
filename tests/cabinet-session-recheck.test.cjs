const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const test = require('node:test');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const ts = require('typescript');
class CabinetError extends Error {constructor(code) {super(code); this.code = code;}}
const owner = '11111111-1111-4111-8111-111111111111';
function fixture(code, paginated = false) {
  const states = [], effects = [], events = []; let index = 0;
  const initial = {workflow: 'postmoderation', nextCursor: null, items: [{id: '22222222-2222-4222-8222-222222222222', revision: '1', kind: 'prodam', title: 'Приватное объявление', price: '10.00',
    card: {status: 'draft', city: null, district: null, coverPhotoId: null, blockReason: null}}]};
  if (paginated) initial.nextCursor = {id: initial.items[0].id, updatedAt: '2026-10-20T12:00:00.123456Z'};
  const react = {...React, useState(value) {
    const slot = index++; if (!(slot in states)) states[slot] = slot === 0 ? initial : value;
    return [states[slot], next => {states[slot] = typeof next === 'function' ? next(states[slot]) : next;}];
  }, useRef(value) {const slot = index++; if (!(slot in states)) states[slot] = {current: value}; return states[slot];},
  useEffect(effect) {effects.push(effect);}};
  const dependencies = {
    react,
    '@/components/cabinet/TwoRowCardViewport': require('./load-two-row-viewport.cjs')(require('react/jsx-runtime')),
    'next/link': {__esModule: true, default: ({children, ...props}) => React.createElement('a', props, children)},
    '@/lib/client-listing-drafts': {productionDrafts: {list: async () => initial}},
    '@/lib/client-listing-cabinet': {ListingCabinetClientError: CabinetError, listingCabinet: {list: async () => {throw new CabinetError(code);}}},
    '@/lib/local-account': {notifyAccountSessionChange: value => events.push(value)},
    './PrivateDraftModeration': {PrivateDraftModeration: () => null},
    './PrivateListingCheckout': {PrivateListingCheckout: () => null},
    './PrivateDraftEditor': {draftButton: 'border'},
    './CabinetListingCard': {CabinetListingCard: ({item, open}) => React.createElement('article', {'data-open':open}, item.title)},
    './ListingOwnerRemoveButton': {ListingOwnerRemoveButton: () => null},
    './ListingWorkflowProvider': {useDraftRemovals: () => false},
  };
  const exports = {};
  new Function('require', 'exports', ts.transpileModule(readFileSync(new URL('../src/components/listings/ListingCabinetList.tsx', `file://${__filename}`), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true},
  }).outputText)(name => {
    if (name === 'react/jsx-runtime') return require(name);
    assert.ok(Object.hasOwn(dependencies, name), `Approved UI dependency ${name}`); return dependencies[name];
  }, exports);
  const tree = () => {index = 0; effects.length = 0; return exports.ListingCabinetList({owner, visible: true, enriched: true});};
  const render = () => renderToStaticMarkup(tree());
  function nextButton(node) {
    if (!node || typeof node !== 'object') return null;
    if (typeof node.props?.onLoadMore === 'function') return {props:{onClick:node.props.onLoadMore}};
    if (node.type === 'button' && node.props.children === 'Следующая страница') return node;
    return React.Children.toArray(node.props?.children).map(nextButton).find(Boolean);
  }
  return {render, events, refresh: async () => {const cleanups = effects.map(effect=>effect()).filter(value=>typeof value==='function'); for (let i = 0; i < 20; i++) await Promise.resolve(); return ()=>cleanups.forEach(cleanup=>cleanup());},
    next: async () => {const button = nextButton(tree()); assert.ok(button); button.props.onClick(); for (let i = 0; i < 20; i++) await Promise.resolve();}};
}
for (const code of ['UNAUTHENTICATED', 'SESSION_CHANGED']) {
  test(`pagination ${code} also hides already loaded owner cards`, async () => {
    const f = fixture(code, true); assert.ok(f.render().includes('Приватное объявление'));
    await f.next(); assert.doesNotMatch(f.render(), /Приватное объявление/); assert.deepEqual(f.events, [true, false]);
  });
}
for (const code of ['UNAUTHENTICATED', 'SESSION_CHANGED']) {
  test(`enriched cabinet hides previously loaded private cards and rechecks identity on ${code}`, async () => {
    const f = fixture(code); assert.ok(f.render().includes('Приватное объявление'));
    const cleanup = await f.refresh();
    assert.doesNotMatch(f.render(), /Приватное объявление/);
    assert.deepEqual(f.events, [true, false]); cleanup();
  });
}
test('a transient network failure keeps same-owner cards and offers a retry, not an identity reset', async () => {
  const f = fixture('UNKNOWN'); f.render(); const cleanup = await f.refresh();
  const markup = f.render();
  assert.ok(markup.includes('Приватное объявление')); assert.ok(markup.includes('role="alert"'));
  assert.deepEqual(f.events, []); cleanup();
});

test('payment return query opens only a card already present in the owned response, without a payment write',async()=>{
 const previous=global.window;
 try{
  global.window={location:{search:'?pay=22222222-2222-4222-8222-222222222222'}};
  const f=fixture('UNKNOWN');f.render();const cleanup=await f.refresh();
  assert.match(f.render(),/data-open="true"/);assert.deepEqual(f.events,[]);cleanup();
  global.window={location:{search:'?pay=33333333-3333-4333-8333-333333333333'}};
  const foreign=fixture('UNKNOWN');foreign.render();const end=await foreign.refresh();
  assert.match(foreign.render(),/data-open="false"/);end();
 }finally{if(previous===undefined)delete global.window;else global.window=previous;}
});
