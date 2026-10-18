import {parseListingDraftId,parseListingDraftRevision} from './listing-draft-contract.ts';
export type ApplicationKind='vacancy'|'workRequest';
type ReviewedInput={message:string;expectedTargetRevision:string;specialistId:string;expectedSpecialistRevision:string};
export type ApplicationCreateInput=ReviewedInput&{kind:ApplicationKind;targetId:string;creationKey:string};
export type ApplicationEditInput=ReviewedInput&{applicationId:string;expectedRevision:string};
export class ApplicationInputError extends Error{constructor(){super('Invalid application input');this.name='ApplicationInputError';}}
export function parseApplicationKind(value:unknown):ApplicationKind{if(value!=='vacancy'&&value!=='workRequest')throw new ApplicationInputError();return value;}
function parse(value:unknown,creating:boolean):ApplicationCreateInput|ApplicationEditInput{
 try{
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error();
  const row=value as Record<string,unknown>,keys=['message','expectedTargetRevision','specialistId','expectedSpecialistRevision',...(creating?['kind','targetId','creationKey']:['applicationId','expectedRevision'])];
  if(Reflect.ownKeys(row).length!==keys.length||keys.some(key=>!Object.hasOwn(row,key)))throw Error();
  if(typeof row.message!=='string'||row.message.length>3000||!row.message.isWellFormed()||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(row.message))throw Error();
  const common={message:row.message.trim(),expectedTargetRevision:parseListingDraftRevision(row.expectedTargetRevision),specialistId:parseListingDraftId(row.specialistId),expectedSpecialistRevision:parseListingDraftRevision(row.expectedSpecialistRevision)};
  return creating?{...common,kind:parseApplicationKind(row.kind),targetId:parseListingDraftId(row.targetId),creationKey:parseListingDraftId(row.creationKey)}:
   {...common,applicationId:parseListingDraftId(row.applicationId),expectedRevision:parseListingDraftRevision(row.expectedRevision)};
 }catch{throw new ApplicationInputError();}
}
export const parseApplicationCreate=(value:unknown)=>parse(value,true) as ApplicationCreateInput;
export const parseApplicationEdit=(value:unknown)=>parse(value,false) as ApplicationEditInput;
