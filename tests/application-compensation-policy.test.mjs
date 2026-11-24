import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
const load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
const applicationId='10000000-0000-4000-8000-000000000001',otherId='10000000-0000-4000-8000-000000000002';
const sentAt='2026-11-01T10:00:00.000001Z',deadline='2026-11-06T10:00:00.000001Z';
const now='2026-11-07T10:00:00.000001Z',selectedAt='2026-11-02T10:00:00.000001Z';
const facts=(patch={})=>({applicationId,kind:'workRequest',paid:true,status:'sent',sentAt,contactViews:[],selected:null,customerClosedAt:null,...patch});
const check=(input,at=now)=>load('application-compensation-policy').assessApplicationCompensation(input,at);
test('response compensation waits exactly120 hours from delivery with microsecond precision',()=>{
 assert.deepEqual(check(facts(),'2026-11-06T10:00:00.000000Z'),{state:'waiting',eligibleAt:deadline});
 assert.deepEqual(check(facts(),deadline),{state:'eligible',reason:'unread-five-days',eligibleAt:deadline});
 assert.deepEqual(check(facts({kind:'vacancy'})),{state:'eligible',reason:'unread-five-days',eligibleAt:deadline});
});
test('terminally blocked delivery qualifies only with an untouched response and no delivery evidence',()=>{
 const undelivered=facts({paid:false,status:'pending_payment',sentAt:null,deliveryBlocked:true});
 assert.deepEqual(check(undelivered),{state:'eligible',reason:'delivery-blocked',eligibleAt:now});
 assert.deepEqual(check({...undelivered,deliveryBlocked:undefined}),{state:'ineligible',reason:'not-delivered'});
 for(const patch of [
  {paid:true},{status:'paid'},{sentAt},{contactViews:[{evidence:'recipient_read',recordedAt:sentAt}]},
  {selected:{applicationId:otherId,selectedAt}},{customerClosedAt:selectedAt},{deliveryBlocked:false},
 ])assert.throws(()=>check({...undelivered,...patch}),{name:'ApplicationCompensationInputError'});
});
test('first disclosure at or before the qualifying event excludes compensation; a late view preserves accrued eligibility',()=>{
 for(const recordedAt of [sentAt,'2026-11-06T10:00:00.000000Z',deadline])assert.deepEqual(check(facts({contactViews:[{evidence:'recipient_read',recordedAt}]})),{state:'ineligible',reason:'viewed'});
 assert.deepEqual(check(facts({status:'viewed',contactViews:[{evidence:'recipient_read',recordedAt:'2026-11-06T10:00:00.000002Z'}]})),{state:'eligible',reason:'unread-five-days',eligibleAt:deadline});
});
test('other-executor selection and customer closure compensate unread responses before the timer',()=>{
 assert.deepEqual(check(facts({status:'rejected',selected:{applicationId:otherId,selectedAt}})),{state:'eligible',reason:'other-selected-unread',eligibleAt:selectedAt});
 assert.deepEqual(check(facts({customerClosedAt:selectedAt})),{state:'eligible',reason:'customer-closed-unread',eligibleAt:selectedAt});
 assert.deepEqual(check(facts({selected:{applicationId:otherId,selectedAt},contactViews:[{evidence:'recipient_read',recordedAt:selectedAt}]})),{state:'ineligible',reason:'viewed'});
 assert.deepEqual(check(facts({selected:{applicationId:otherId,selectedAt},contactViews:[{evidence:'recipient_read',recordedAt:'2026-11-03T00:00:00.000000Z'}]})),{state:'eligible',reason:'other-selected-unread',eligibleAt:selectedAt});
});
test('chooses earliest qualifying event rather than the current rejected state',()=>{
 assert.deepEqual(check(facts({status:'rejected',selected:{applicationId:otherId,selectedAt:'2026-11-07T00:00:00.000000Z'},customerClosedAt:selectedAt})),{state:'eligible',reason:'customer-closed-unread',eligibleAt:selectedAt});
 assert.deepEqual(check(facts({status:'rejected'}),'2026-11-02T00:00:00.000000Z'),{state:'waiting',eligibleAt:deadline});
});
test('unknown history prevents automation and early self-selection differs from late self-selection',()=>{
 assert.deepEqual(check(facts({contactViews:[{evidence:'legacy_unknown',recordedAt:selectedAt}]})),{state:'ineligible',reason:'legacy-unknown'});
 assert.deepEqual(check(facts({status:'selected',selected:{applicationId,selectedAt},contactViews:[{evidence:'recipient_read',recordedAt:selectedAt}]})),{state:'ineligible',reason:'selected-self'});
 assert.deepEqual(check(facts({kind:'vacancy',status:'selected',selected:{applicationId,selectedAt},contactViews:[{evidence:'recipient_read',recordedAt:selectedAt}]})),{state:'ineligible',reason:'selected-self'});
 const late='2026-11-07T00:00:00.000000Z';
 assert.deepEqual(check(facts({status:'selected',selected:{applicationId,selectedAt:late},contactViews:[{evidence:'recipient_read',recordedAt:late}]})),{state:'eligible',reason:'unread-five-days',eligibleAt:deadline});
 for(const patch of [{paid:false},{sentAt:null,status:'paid'},{status:'pending_payment',paid:false,sentAt:null}])assert.deepEqual(check(facts(patch)),{state:'ineligible',reason:'not-delivered'});
});
test('canonical UTC instants preserve precision across month boundaries and dates before1970',()=>{
 assert.deepEqual(check(facts({sentAt:'2026-02-27T10:00:00.999999Z'}),'2026-03-04T10:00:00.999999Z'),{state:'eligible',reason:'unread-five-days',eligibleAt:'2026-03-04T10:00:00.999999Z'});
 assert.deepEqual(check(facts({sentAt:'1969-12-01T10:00:00.000001Z'}),'1969-12-06T10:00:00.000001Z'),{state:'eligible',reason:'unread-five-days',eligibleAt:'1969-12-06T10:00:00.000001Z'});
});
test('case-insensitive UUID identity cannot classify the same chosen response as another specialist',()=>{
 const lower='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 assert.deepEqual(check(facts({applicationId:lower,status:'selected',selected:{applicationId:lower.toUpperCase(),selectedAt},contactViews:[{evidence:'recipient_read',recordedAt:selectedAt}]})),{state:'ineligible',reason:'selected-self'});
 assert.throws(()=>check(facts({applicationId:lower,selected:{applicationId:lower.toUpperCase(),selectedAt}})),{name:'ApplicationCompensationInputError'});
});
test('invalid, contradictory, future or unsupported facts fail closed without an eligibility decision',()=>{
 const bad=[{kind:'listing'},{paid:'true'},{status:'unknown'},{applicationId:'foreign'},{sentAt:'2026-11-31T10:00:00.000001Z'},{sentAt:'2026-11-01T10:00:00.000001+03:00'},
  {sentAt:'2026-11-08T10:00:00.000001Z'},
  {contactViews:[{evidence:'recipient_read',recordedAt:'2026-10-31T10:00:00.000001Z'}]},
  {contactViews:[{evidence:'recipient_read',recordedAt:'2026-11-08T10:00:00.000001Z'}]},
  {contactViews:[{evidence:'unknown',recordedAt:selectedAt}]},
  {contactViews:[{evidence:'recipient_read',recordedAt:selectedAt},{evidence:'recipient_read',recordedAt:selectedAt}]},
  {selected:{applicationId:otherId,selectedAt:'2026-10-31T10:00:00.000001Z'}},
  {customerClosedAt:'2026-11-08T00:00:00.000000Z'},
  {status:'selected',selected:null},
  {status:'sent',selected:{applicationId,selectedAt}},
  {status:'viewed',contactViews:[]},
  {kind:'vacancy',selected:{applicationId:otherId,selectedAt}},
  {kind:'vacancy',customerClosedAt:selectedAt}];
 for(const patch of bad)assert.throws(()=>check(facts(patch)),{name:'ApplicationCompensationInputError'});
 assert.throws(()=>check(facts(),'not-a-date'),{name:'ApplicationCompensationInputError'});
});
