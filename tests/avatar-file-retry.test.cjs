const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function avatarEditor(context = null) {
  const source = readFileSync(path.join(__dirname, '../src/components/cabinet/CabinetClient.tsx'), 'utf8');
  const ast = ts.createSourceFile('CabinetClient.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'AvatarEditor');
  assert.ok(component, 'Exercise the real editor rather than a second file-selection implementation');
  const states = [];
  const hooks = {
    useState(initial) { const index = states.length; states.push(initial); return [initial, value => { states[index] = value; }]; },
    useRef: () => ({current: null}), useEffect() {},
  };
  const jsx = (type, props) => ({type, props});
  const compiled = ts.transpileModule(component.getText(ast) + '\nexports.AvatarEditor = AvatarEditor;', {
    compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX},
  }).outputText;
  const exports = {};
  const prepare = async file => 'data:image/png;base64,' + file.name;
  const image = async () => ({naturalWidth: 512, naturalHeight: 512});
  new Function('exports', 'require', 'useState', 'useRef', 'useEffect', 'prepareAvatarImage', 'loadImage', 'Camera', 'Trash2', 'getAvatarTransform', 'useCookieCabinetProfile', compiled)(
    exports, name => { assert.equal(name, 'react/jsx-runtime'); return {jsx, jsxs: jsx}; },
    hooks.useState, hooks.useRef, hooks.useEffect, prepare, image, () => null, () => null, () => null, () => context,
  );
  return {render: exports.AvatarEditor, states};
}
function findFileInput(node) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'input' && node.props.type === 'file') return node;
  for (const child of [node.props?.children].flat(Infinity)) {
    const result = findFileInput(child);
    if (result) return result;
  }
  return null;
}

test('avatar file selection releases the input so the same photo can be selected again after cancelling its crop', async () => {
  const editor = avatarEditor();
  const tree = editor.render({ownerKey: 'synthetic-owner', profile: {name: 'Synthetic', avatarDataUrl: ''}, onChange() {}, onError() {}});
  const input = findFileInput(tree);
  assert.ok(input, 'The avatar editor has an image picker');
  const file = {name: 'synthetic-avatar.png', type: 'image/png'};
  const element = {files: [file], value: 'C:\\fakepath\\synthetic-avatar.png'};
  input.props.onChange({target: element, currentTarget: element});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(editor.states[1]?.src, 'data:image/png;base64,synthetic-avatar.png', 'A valid selection still reaches the crop editor');
  assert.equal(element.value, '', 'Clear the picker after capturing the File: browsers do not emit change for the same file twice');
});
test('avatar editor resumes the same selected frame from owner-scoped draft memory after remount', () => {
  const draft={src:'data:image/png;base64,synthetic-resume',zoom:1.4,offsetX:4,offsetY:8},imageSize={width:640,height:480};
  const editor=avatarEditor({avatarDraft:{draft,imageSize},setAvatarDraft(){}});
  editor.render({ownerKey:'synthetic-owner',profile:{name:'Synthetic',avatarDataUrl:''},onChange(){},onError(){}});
  assert.deepEqual(editor.states[1],draft);
  assert.deepEqual(editor.states[2],imageSize);
});
