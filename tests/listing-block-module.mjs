import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import * as contract from '../src/lib/listing-block-contract.ts';
import * as draft from '../src/lib/listing-draft-contract.ts';
import * as form from '../src/lib/listing-form-contract.ts';
import * as limits from '../src/lib/media-limits.ts';
import {loadAdminModule} from './admin-module.mjs';
import {formModule} from './listing-form-module.mjs';
import * as http from '../src/lib/auth-http.ts';
import * as cookie from '../src/lib/account-cookie.ts';
import * as proxy from '../src/lib/trusted-proxy-ip.ts';
import * as mediaAdmission from '../src/lib/media-read-admission.ts';
import * as media from '../src/lib/production-media-http.ts';
import * as mediaContract from '../src/lib/media-upload-contract.ts';
const require=createRequire(import.meta.url),ts=require('typescript');
export function blockModule(name,extra={}){
 const dependencies={'./media-read-admission.ts':mediaAdmission,'node:crypto':require('node:crypto'),'./listing-block-contract.ts':contract,'./listing-draft-contract.ts':draft,'./listing-form-contract.ts':form,'./media-limits.ts':limits,
 './postgres-notification-inbox':formModule('postgres-notification-inbox'),'./app-session-transaction':loadAdminModule('app-session-transaction'),'./admin-authorization':loadAdminModule('admin-authorization'),
 './auth-http':http,'./account-cookie':cookie,'./trusted-proxy-ip':proxy,'./production-media-http':media,'./media-upload-contract.ts':mediaContract,...extra};
 const exports={};new Function('require','exports',ts.transpileModule(readFileSync(new URL(`../src/lib/${name}.ts`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(path=>{if(!Object.hasOwn(dependencies,path))throw Error('Unapproved listing-block dependency');return dependencies[path];},exports);return exports;
}
