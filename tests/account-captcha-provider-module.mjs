import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const exports = {};
new Function('require', 'exports', ts.transpileModule(readFileSync(new URL('../src/components/auth/AccountCaptchaProvider.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText)(require, exports);
export const { AccountCaptchaProvider, useAccountCaptcha } = exports;
