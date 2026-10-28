const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function renderOpenAvatarEditor() {
  const source = readFileSync(path.join(__dirname, '../src/components/cabinet/CabinetClient.tsx'), 'utf8');
  const ast = ts.createSourceFile('CabinetClient.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'AvatarEditor');
  assert.ok(component, 'Exercise the real avatar editor');
  let stateIndex = 0;
  const values = [false, {src: 'data:image/png;base64,synthetic', zoom: 1, offsetX: 0, offsetY: 0}, {width: 512, height: 512}];
  const globals = {
    useState: initial => [stateIndex < values.length ? values[stateIndex++] : initial, () => {}],
    useRef: () => ({current: null}), useEffect() {}, useId: () => 'synthetic-avatar-crop',
    useCookieCabinetProfile: () => null,
    Camera: () => null, Trash2: () => null, X: () => null, Move: () => null,
    getAvatarTransform: () => ({width: 320, height: 320, offsetX: 0, offsetY: 0}),
  };
  const exports = {};
  const jsx = (type, props) => ({type, props});
  const code = ts.transpileModule(component.getText(ast) + '\nexports.AvatarEditor = AvatarEditor;', {
    compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX},
  }).outputText;
  new Function('exports', 'require', ...Object.keys(globals), code)(exports,
    name => { assert.equal(name, 'react/jsx-runtime'); return {jsx, jsxs: jsx}; }, ...Object.values(globals));
  return exports.AvatarEditor({ownerKey: 'synthetic-owner', profile: {name: 'Synthetic', avatarDataUrl: ''}, onChange() {}, onError() {}});
}
function nodes(root) {
  if (!root || typeof root !== 'object') return [];
  return [root, ...[root.props?.children].flat(Infinity).flatMap(nodes)];
}

test('avatar crop uses a labelled native dialog so navigation cannot overlap its controls', () => {
  const all = nodes(renderOpenAvatarEditor());
  const dialog = all.find(node => node.type === 'dialog');
  assert.ok(dialog, 'Avatar crop belongs in the browser top layer, not a z-index overlay behind mobile navigation');
  const title = all.find(node => node.props?.id === dialog.props['aria-labelledby']);
  assert.ok(dialog.props['aria-label'] || (title && nodes(title).some(node => node.props?.children === 'Выберите область аватарки')),
    'The crop dialog has an accessible name');
  assert.ok(nodes(dialog).some(node => node.type === 'button' && node.props['aria-label'] === 'Закрыть редактор аватарки'),
    'A named close action is present');
});

test('avatar crop contains a height-bounded scrolling area for controls in short viewports', () => {
  const all = nodes(renderOpenAvatarEditor());
  const dialog = all.find(node => node.type === 'dialog');
  assert.ok(dialog, 'Crop must be a native dialog');
  const scrollingArea = nodes(dialog).find(node => /(?:^|\s)overflow-y-auto(?:\s|$)|(?:^|\s)overflow-auto(?:\s|$)/.test(node.props?.className || ''));
  assert.ok(scrollingArea, 'Short windows must scroll the crop panel instead of clipping Apply');
  assert.ok(all.some(node => /max-h-|h-\[(?:100dvh|calc\(100)/.test(node.props?.className || '') || node.props?.style?.maxHeight),
    'Scroll area is bounded by viewport height');
});
