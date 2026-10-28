const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

// Exercise the component's real input/change handlers. Only the React hook/JSX
// boundary is replaced; all formatting and dependency functions remain real.
function phoneInput(initialValue) {
  const slots = [];
  let cursor = 0;
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (next) => {
        slots[index] = typeof next === 'function' ? next(slots[index]) : next;
      }];
    },
    useRef(initial) {
      const index = cursor++;
      return slots[index] ??= { current: initial };
    },
    useEffect() {},
  };
  const jsx = (type, props) => ({ type, props });
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    const module = { exports: {} };
    const output = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
    new Function('module', 'exports', 'require', output)(module, module.exports, (id) => {
      if (id === 'react') return hooks;
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (id.startsWith('@/lib/')) return load(`src/${id.slice(2)}.ts`);
      throw new Error(`Unexpected phone-input dependency: ${id}`);
    });
    cache.set(path, module.exports);
    return module.exports;
  }
  const { ValidatedInput } = load('src/components/ValidatedInput.tsx');
  const changes = [];
  const props = {
    name: 'phone', validation: 'phone', defaultValue: initialValue,
    onChange: (event) => changes.push(event.currentTarget.value),
  };
  function render() {
    cursor = 0;
    return ValidatedInput(props);
  }
  let element = render();
  let value = element.props.value;
  const target = {
    get value() { return value; },
    set value(next) {
      if (next !== value) {
        value = next;
        this.selectionStart = this.selectionEnd = next.length;
      }
    },
    selectionStart: value.length,
    selectionEnd: value.length,
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
  };

  function edit(inputType, text = '') {
    const event = {
      currentTarget: target, target, data: text || null, inputType,
      nativeEvent: { inputType, data: text || null },
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
    };
    element.props.onBeforeInput?.(event);
    if (!event.defaultPrevented) {
      let start = target.selectionStart;
      const end = target.selectionEnd;
      if (inputType === 'deleteContentBackward' && start === end) start = Math.max(0, start - 1);
      target.value = value.slice(0, start) + text + value.slice(end);
      target.setSelectionRange(start + text.length, start + text.length);
      element.props.onInput?.(event);
      element.props.onChange?.(event);
    }
    element = render();
    target.value = element.props.value;
    return value;
  }

  return {
    target, changes, edit,
    value: () => value,
    selectAll: () => target.setSelectionRange(0, value.length),
  };
}

test('phone can be completely erased by repeated Backspace after entering a complete number', () => {
  const input = phoneInput('+7-(900)-123-45-67');
  for (let press = 0; press < 30 && input.value(); press++) {
    input.target.setSelectionRange(input.value().length, input.value().length);
    input.edit('deleteContentBackward');
  }
  assert.equal(input.value(), '', 'Backspace must not get stuck at the automatically restored area-code bracket');
  assert.equal(input.changes.at(-1), '', 'the enclosing form receives the cleared phone');
});

test('phone can be erased by Backspace when only the first four digits remain', () => {
  const input = phoneInput('+7-(900)');
  for (let press = 0; press < 12 && input.value(); press++) input.edit('deleteContentBackward');
  assert.equal(input.value(), '', 'country code and first three national digits must remain editable');
});

for (const inputType of ['deleteContentBackward', 'deleteContentForward']) {
  test(`phone select-all plus ${inputType} clears both rendered and submitted value`, () => {
    const input = phoneInput('+7-(900)-123-45-67');
    input.selectAll();
    input.edit(inputType);
    assert.equal(input.value(), '');
    assert.equal(input.changes.at(-1), '');
  });
}

test('phone select-all can replace the whole formatted value with a pasted national-format number', () => {
  const input = phoneInput('+7-(900)-123-45-67');
  input.selectAll();
  input.edit('insertFromPaste', '8 (901) 234-56-78');
  assert.equal(input.value(), '+7-(901)-234-56-78');
  assert.equal(input.changes.at(-1), '+7-(901)-234-56-78');
});

test('phone accepts an international-format paste after being cleared', () => {
  const input = phoneInput('+7-(900)-123-45-67');
  input.selectAll();
  input.edit('deleteContentForward');
  input.edit('insertFromPaste', '+7 902 345 67 89');
  assert.equal(input.value(), '+7-(902)-345-67-89');
  assert.equal(input.changes.at(-1), '+7-(902)-345-67-89');
});
