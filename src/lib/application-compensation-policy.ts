import {parseListingDraftId} from './listing-draft-contract.ts';

export class ApplicationCompensationInputError extends Error {
 constructor(){super('Application compensation evidence requires verification');this.name='ApplicationCompensationInputError';}
}
export type ApplicationCompensationFacts={
 applicationId:string;kind:'vacancy'|'workRequest';paid:boolean;
 status:'pending_payment'|'paid'|'sent'|'viewed'|'selected'|'rejected';sentAt:string|null;
 contactViews:{evidence:'recipient_read'|'legacy_unknown';recordedAt:string}[];
 selected:{applicationId:string;selectedAt:string}|null;
 /** Verified customer withdrawal/removal event, never inferred from current publication status. */
 customerClosedAt:string|null;
};
type Reason='unread-five-days'|'other-selected-unread'|'customer-closed-unread';
export type ApplicationCompensationAssessment=
 |{state:'eligible';reason:Reason;eligibleAt:string}
 |{state:'waiting';eligibleAt:string}
 |{state:'ineligible';reason:'not-delivered'|'legacy-unknown'|'viewed'|'selected-self'};
const day=BigInt(86_400_000_000);
function instant(value:string):bigint {
 if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(value)||value.startsWith('0000'))throw new ApplicationCompensationInputError();
 const milliseconds=Date.parse(value);
 if(!Number.isFinite(milliseconds)||new Date(milliseconds).toISOString()!==value.slice(0,23)+'Z')throw new ApplicationCompensationInputError();
 return BigInt(milliseconds)*BigInt(1000)+BigInt(value.slice(23,26));
}
function stamp(value:bigint):string {
 const remainder=(value%BigInt(1000)+BigInt(1000))%BigInt(1000);
 const iso=new Date(Number((value-remainder)/BigInt(1000))).toISOString();
 const result=iso.slice(0,-1)+remainder.toString().padStart(3,'0')+'Z';
 instant(result);return result;
}
/** Pure classification of a locked server snapshot. NOT payment authorization.
 * A future claimant must re-read/serialize the evidence and persist its unique case.
 */
export function assessApplicationCompensation(facts:ApplicationCompensationFacts,now:string):ApplicationCompensationAssessment {
 try{
  const at=instant(now),applicationId=parseListingDraftId(facts.applicationId);
  if(!['vacancy','workRequest'].includes(facts.kind)||typeof facts.paid!=='boolean'||
   !['pending_payment','paid','sent','viewed','selected','rejected'].includes(facts.status)||!Array.isArray(facts.contactViews)||facts.contactViews.length>2)throw Error();
  const sent=facts.sentAt===null?null:instant(facts.sentAt);
  if(sent!==null&&sent>at)throw Error();
  const seen=new Set<string>();let viewed:bigint|null=null,legacy=false;
  for(const evidence of facts.contactViews){
   if(!['recipient_read','legacy_unknown'].includes(evidence.evidence)||seen.has(evidence.evidence))throw Error();
   seen.add(evidence.evidence);const recorded=instant(evidence.recordedAt);
   if(sent===null||recorded<sent||recorded>at)throw Error();
   if(evidence.evidence==='recipient_read')viewed=recorded;else legacy=true;
  }
  const selected=facts.selected===null?null:instant(facts.selected.selectedAt);
  const closed=facts.customerClosedAt===null?null:instant(facts.customerClosedAt);
  const selectedId=facts.selected===null?null:parseListingDraftId(facts.selected.applicationId);
  for(const event of [selected,closed])if(event!==null&&(sent===null||event<sent||event>at))throw Error();
  const selfSelected=selectedId===applicationId;
  if(facts.kind!=='workRequest'&&(closed!==null||(selected!==null&&!selfSelected)))throw Error();
  if((facts.status==='selected')!==selfSelected)throw Error();
  if(!facts.paid||sent===null||!['sent','viewed','selected','rejected'].includes(facts.status))return{state:'ineligible',reason:'not-delivered'};
  if(legacy)return{state:'ineligible',reason:'legacy-unknown'};
  if((facts.status==='viewed'||selfSelected)&&viewed===null)throw Error();
  if(selfSelected&&(viewed===null||selected===null||viewed>selected))throw Error();
  const events:{time:bigint;reason:Reason}[]=[{time:sent+BigInt(5)*day,reason:'unread-five-days'}];
  if(selected!==null&&!selfSelected)events.push({time:selected,reason:'other-selected-unread'});
  if(closed!==null)events.push({time:closed,reason:'customer-closed-unread'});
  const first=events.reduce((a,b)=>b.time<a.time?b:a);
  // Viewing/selection after a condition matures does not erase accrued eligibility.
  if(selfSelected&&selected!==null&&selected<=first.time)return{state:'ineligible',reason:'selected-self'};
  if(viewed!==null&&viewed<=first.time)return{state:'ineligible',reason:'viewed'};
  const eligibleAt=stamp(first.time);
  return first.time>at?{state:'waiting',eligibleAt}:{state:'eligible',reason:first.reason,eligibleAt};
 }catch{throw new ApplicationCompensationInputError();}
}
