const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const signed = userId => ({state: 'signed-in', userId});
const jsx = (type, props) => ({type, props});
const compile = source => ts.transpileModule(source, {compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
}}).outputText;
function provider() {
  const slots = []; let index = 0;
  const react = {createContext: () => ({Provider: 'provider'}), useEffect() {},
    useState(initial) { const slot = index++; if (!(slot in slots)) slots[slot] = initial;
      return [slots[slot], next => { slots[slot] = typeof next === 'function' ? next(slots[slot]) : next; }]; },
    useRef(initial) { const slot = index++; if (!(slot in slots)) slots[slot] = {current: initial}; return slots[slot]; }};
  const exports = {};
  new Function('require', 'exports', compile(fs.readFileSync(path.join(__dirname, '../src/components/cabinet/CookieCabinetProfileProvider.tsx'), 'utf8') + '\nexports.ProfileScope = ProfileScope;'))(name => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return {jsx, jsxs: jsx};
    if (name.endsWith('/AccountAuthProvider') || name.endsWith('/local-account')) return {};
    if (name.endsWith('/client-postgres-profile')) return {CookieProfileError: class extends Error {}};
    assert.fail('Unexpected avatar fixture import ' + name);
  }, exports);
  return auth => { index = 0; return exports.ProfileScope({auth, children: null}).props.value; };
}
function startSelection(context, prepare) {
  const source = fs.readFileSync(path.join(__dirname, '../src/components/cabinet/CabinetClient.tsx'), 'utf8');
  const ast = ts.createSourceFile('CabinetClient.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'AvatarEditor');
  assert.ok(component);
  const exports = {}, states = [];
  const globals = {useCookieCabinetProfile: () => context,
    useState: initial => { const slot = states.length; states.push(initial); return [initial, next => { states[slot] = next; }]; },
    useRef: () => ({current: null}), useEffect() {}, Camera: () => null, Trash2: () => null,
    prepareAvatarImage: prepare, loadImage: async () => ({naturalWidth: 640, naturalHeight: 480}),
    getAvatarTransform: () => null};
  new Function('exports', 'require', ...Object.keys(globals), compile(component.getText(ast) + '\nexports.AvatarEditor=AvatarEditor;'))(
    exports, name => { assert.equal(name, 'react/jsx-runtime'); return {jsx, jsxs: jsx}; }, ...Object.values(globals));
  const tree = exports.AvatarEditor({ownerKey: owner, profile: {name: 'Synthetic', avatarDataUrl: ''}, onChange() {}, onError() {}});
  function find(node) {
    if (!node || typeof node !== 'object') return null;
    if (node.type === 'input' && node.props.type === 'file') return node;
    for (const child of [node.props?.children].flat(Infinity)) { const match = find(child); if (match) return match; }
    return null;
  }
  const input = find(tree); assert.ok(input);
  const element = {files: [{name: 'slow-avatar.png', type: 'image/png'}], value: 'synthetic'};
  input.props.onChange({target: element, currentTarget: element});
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('slow avatar selection completing during identity recheck survives editor removal for the same owner', async () => {
  const render = provider(); let finish;
  startSelection(render(signed(owner)), () => new Promise(resolve => { finish = resolve; }));
  assert.equal(render(signed(owner)).avatarPreparation?.loading, true, 'Pending selection is captured before file decode finishes');
  render({state: 'checking'});
  finish('data:image/png;base64,synthetic-slow'); await tick();
  assert.equal(render({state: 'checking'}).avatarDraft, null, 'Unverified identity cannot view the selected file');
  assert.equal(render(signed(owner)).avatarDraft?.draft.src, 'data:image/png;base64,synthetic-slow');
});

test('a slow selection cannot reappear after logout or an account round trip', async () => {
  for (const transition of [render => render({state: 'signed-out'}), render => { render(signed(other)); render(signed(owner)); }]) {
    const render = provider(); let finish;
    startSelection(render(signed(owner)), () => new Promise(resolve => { finish = resolve; }));
    transition(render);
    finish('data:image/png;base64,must-not-return'); await tick();
    assert.equal(render(signed(owner)).avatarDraft, null, 'Stale preparation cannot restore a discarded private file');
  }
});

test('decode errors remain owner-scoped and visible after a transient recheck', async () => {
  const render = provider(); let fail;
  startSelection(render(signed(owner)), () => new Promise((resolve, reject) => { fail = reject; }));
  render({state: 'checking'}); fail(new Error('Не удалось подготовить изображение.')); await tick();
  assert.equal(render({state: 'checking'}).avatarPreparation, null);
  assert.equal(render(signed(owner)).avatarPreparation?.message, 'Не удалось подготовить изображение.');
  assert.equal(render(signed(other)).avatarPreparation, null);
});

test('closing account settings cancels a pending decoder and prevents it reopening the editor', async () => {
  const render = provider(); let finish;
  startSelection(render(signed(owner)), () => new Promise(resolve => { finish = resolve; }));
  render(signed(owner)).clearSettingsDraft();
  finish('data:image/png;base64,cancelled-selection'); await tick();
  assert.equal(render(signed(owner)).avatarDraft, null);
  assert.equal(render(signed(owner)).avatarPreparation, null);
});

test('a newer selection supersedes a slow older file without restoring the previous frame', async () => {
  const render = provider(); let first, second;
  startSelection(render(signed(owner)), () => new Promise(resolve => { first = resolve; }));
  startSelection(render(signed(owner)), () => new Promise(resolve => { second = resolve; }));
  second('data:image/png;base64,new-selection'); await tick();
  first('data:image/png;base64,old-selection'); await tick();
  assert.equal(render(signed(owner)).avatarDraft?.draft.src, 'data:image/png;base64,new-selection');
});
