import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import * as contract from '../src/lib/listing-form-contract.ts';
import * as draftContract from '../src/lib/listing-draft-contract.ts';
import * as drafts from './listing-draft-module.mjs';
import * as limits from '../src/lib/media-limits.ts';
import {loadAdminModule} from './admin-module.mjs';
import {publicationCheck} from './listing-publication-check-module.mjs';
import * as mediaAdmission from '../src/lib/media-read-admission.ts';
import * as bookingExpiry from '../src/lib/postgres-booking-expiry.ts';
import * as bookingAvailability from '../src/lib/booking-availability.ts';
import * as workflow from '../src/lib/listing-workflow-config.ts';
import {loadLocalPrimaryModule} from '../scripts/local-primary-modules.cjs';
const ts=createRequire(import.meta.url)('typescript');
export function formModule(name,extra={}){
 const dependencies={'./publication-restriction-eligibility':loadLocalPrimaryModule('publication-restriction-eligibility'),'./placement-renewal-config':loadLocalPrimaryModule('placement-renewal-config'),'./specialist-purchase-eligibility':loadLocalPrimaryModule('specialist-purchase-eligibility'),'./specialist-checkout-config':loadLocalPrimaryModule('specialist-checkout-config'),'./identity':loadLocalPrimaryModule('identity'),'./postgres-service-publications':loadLocalPrimaryModule('postgres-service-publications'),'./booking-lifecycle.ts':loadLocalPrimaryModule('booking-lifecycle'),'./media-read-admission.ts':mediaAdmission,'./listing-form-contract.ts':contract,'./listing-draft-contract.ts':draftContract,'./postgres-listing-drafts':drafts,
  './app-session-transaction':loadAdminModule('app-session-transaction'),'./media-limits.ts':limits,'./listing-publication-check':publicationCheck,'./listing-workflow-config':workflow,'./booking-availability.ts':bookingAvailability,
  './work-publication-contract':loadLocalPrimaryModule('work-publication-contract'),'./vacancy-purchase-eligibility':loadLocalPrimaryModule('vacancy-purchase-eligibility'),'./postgres-work-publications':loadLocalPrimaryModule('postgres-work-publications'),...extra};
 dependencies['./publication-location-withdrawal']=loadLocalPrimaryModule('publication-location-withdrawal');
 dependencies['./publication-consent-terms.ts']=loadLocalPrimaryModule('publication-consent-terms');
 if(name==='postgres-bookings')dependencies['./postgres-booking-expiry.ts']=bookingExpiry;
 const exports={};new Function('require','exports',ts.transpileModule(readFileSync(new URL(`../src/lib/${name}.ts`,import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
 }).outputText)(path=>{if(!Object.hasOwn(dependencies,path))throw new Error('Unapproved form test dependency');return dependencies[path];},exports);return exports;
}
