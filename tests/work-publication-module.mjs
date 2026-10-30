import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {loadAdminModule} from './admin-module.mjs';
import * as contract from '../src/lib/work-publication-contract.ts';
import * as drafts from '../src/lib/listing-draft-contract.ts';
import * as limits from '../src/lib/media-limits.ts';
import * as fields from '../src/lib/cabinet-field-validation.ts';
import {loadLocalPrimaryModule} from '../scripts/local-primary-modules.cjs';
const ts=createRequire(import.meta.url)('typescript');
export function workPublicationModule(name,extra={}){
 const deps={'./app-session-transaction':loadAdminModule('app-session-transaction'),'./work-publication-contract.ts':contract,
  './listing-draft-contract.ts':drafts,'./media-limits.ts':limits,'./cabinet-field-validation.ts':fields,
  './listing-workflow-config':loadLocalPrimaryModule('listing-workflow-config'),
  './specialist-application-profile.ts':loadLocalPrimaryModule('specialist-application-profile'),
  './identity':loadLocalPrimaryModule('identity'),
  './work-checkout-validation':loadLocalPrimaryModule('work-checkout-validation'),...extra},exports={};
 deps['./publication-effective-status']=loadLocalPrimaryModule('publication-effective-status');
 deps['./profession-reference']=loadLocalPrimaryModule('profession-reference');
 deps['./profession-catalog-contract.ts']=loadLocalPrimaryModule('profession-catalog-contract');
 new Function('require','exports',ts.transpileModule(readFileSync(new URL(`../src/lib/${name}.ts`,import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
 }).outputText)(path=>{if(!Object.hasOwn(deps,path))throw Error('Unapproved work-publication test dependency');return deps[path];},exports);
 return exports;
}
