import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require = createRequire(import.meta.url);
const ts = require('typescript');

test('cabinet start explains the next step and links to existing private actions without advertising a working payment', () => {
  const exports = {};
  new Function('require', 'exports', ts.transpileModule(readFileSync(new URL('../src/components/cabinet/CabinetStart.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText)(name => require(name), exports);
  const html = renderToStaticMarkup(createElement(exports.CabinetStart));
  for (const href of ['/razmestit/obyavlenie', '/cabinet/obyavleniya', '#cabinet-profile']) assert.ok(html.includes(`href="${href}"`));
  assert.match(html, /С чего начать/);
  assert.match(html, /модераци/);
  assert.doesNotMatch(html, /Оплатить|Публикация оплачена|Email пользователя/);
});
