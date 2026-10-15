import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import * as contract from '../src/lib/listing-form-contract.ts';
import * as draftContract from '../src/lib/listing-draft-contract.ts';
import * as drafts from './listing-draft-module.mjs';
import * as limits from '../src/lib/media-limits.ts';
import {loadAdminModule} from './admin-module.mjs';
import {publicationCheck} from './listing-publication-check-module.mjs';
const ts=createRequire(import.meta.url)('typescript');
export function formModule(name,extra={}){
 const dependencies={'./listing-form-contract.ts':contract,'./listing-draft-contract.ts':draftContract,'./postgres-listing-drafts':drafts,
  './app-session-transaction':loadAdminModule('app-session-transaction'),'./media-limits.ts':limits,'./listing-publication-check':publicationCheck,...extra};
 const exports={};new Function('require','exports',ts.transpileModule(readFileSync(new URL(`../src/lib/${name}.ts`,import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
 }).outputText)(path=>{if(!Object.hasOwn(dependencies,path))throw new Error('Unapproved form test dependency');return dependencies[path];},exports);return exports;
}
