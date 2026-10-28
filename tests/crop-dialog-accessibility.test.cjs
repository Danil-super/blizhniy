const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const ts = require('typescript');

test('photo crop dialog exposes its visible title as an accessible name', () => {
  const output = {};
  const code = ts.transpileModule(readFileSync(resolve(__dirname, '../src/components/SquareImageCropper.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  new Function('require', 'exports', code)(name => {
    if (name === '@/lib/client-media-store') return { resolveStoredMediaUrl: async source => source };
    return require(name);
  }, output);
  const title = 'Кадр для карточки';
  const html = renderToStaticMarkup(React.createElement(output.SquareImageCropper, {
    src: 'blob:synthetic-local-photo', alt: 'Фото 2', title, onApply() {}, onCancel() {},
  }));
  const dialog = html.match(/<[^>]+role="dialog"[^>]*>/)?.[0];
  assert.ok(dialog, 'Photo editor must expose a dialog role');
  const label = dialog.match(/\baria-label="([^"]+)"/)?.[1];
  const references = dialog.match(/\baria-labelledby="([^"]+)"/)?.[1]?.split(/\s+/) ?? [];
  const referencedTitle = references.some(id => {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`<h[1-6][^>]*\\bid="${escaped}"[^>]*>${title}</h[1-6]>`).test(html);
  });
  assert.ok(label === title || referencedTitle, 'A visible heading alone does not name the dialog; connect aria-labelledby or provide aria-label');
});
