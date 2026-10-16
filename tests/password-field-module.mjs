import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as validation from '../src/lib/account-validation.ts';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const exports = {};
new Function('require', 'exports', ts.transpileModule(readFileSync(new URL('../src/components/auth/PasswordField.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText)(name => name === '@/lib/account-validation' ? validation : require(name), exports);
export const { PasswordField } = exports;
