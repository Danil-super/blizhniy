import {parseListingDraftCursor,parseListingDraftId,parseListingDraftRevision} from './listing-draft-contract.ts';

export const publicationRestrictionErrorStatus={
 ADMIN_REQUIRED:403,INVALID_INPUT:422,PUBLICATION_NOT_FOUND:404,
 RESTRICTION_CONFLICT:409,ACCESS_BUSY:409,ACCESS_UNAVAILABLE:503,
} as const;
export type PublicationRestrictionErrorCode=keyof typeof publicationRestrictionErrorStatus;
export class PublicationRestrictionError extends Error{
 readonly code:PublicationRestrictionErrorCode;
 constructor(code:PublicationRestrictionErrorCode){super(code);this.name='PublicationRestrictionError';this.code=code;}
}

function exact(value:unknown,keys:readonly string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Object.getPrototypeOf(value)!==Object.prototype||
  Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))throw Error('Invalid restriction payload');
 return value as Record<string,unknown>;
}

const targetKeys=['expectedAdminId','kind','publicationId'] as const;
const commandKeys=[...targetKeys,'expectedRevision','caseId'] as const;

function parseTarget(row:Record<string,unknown>){
 const kind=row.kind;
 if(kind!=='vacancy'&&kind!=='workRequest'&&kind!=='specialist'&&kind!=='fair'&&kind!=='marquee')throw Error('Invalid publication kind');
 return {kind,expectedAdminId:parseListingDraftId(row.expectedAdminId),publicationId:parseListingDraftId(row.publicationId)} as const;
}

function parseCommand(row:Record<string,unknown>){
 return {...parseTarget(row),expectedRevision:parseListingDraftRevision(row.expectedRevision),caseId:parseListingDraftId(row.caseId)};
}

export function parsePublicationRestrictionEnvelope(value:unknown){
 try{
  const {token,command}=exact(value,['token','command']);
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw Error();
  return {token,command:parseCommand(exact(command,commandKeys))};
 }catch{throw new PublicationRestrictionError('INVALID_INPUT');}
}

export type PublicationRestrictionTarget=ReturnType<typeof parseTarget>;
export type PublicationRestrictionCommand=ReturnType<typeof parseCommand>;

export function parsePublicationRestrictionRequest(value:unknown){
 try{
  const action=(value as {action?:unknown}|null)?.action;
  if(action==='inspect')return {action,target:parseTarget(exact(value,['action',...targetKeys]))} as const;
  if(action==='restrict')return {action,command:parseCommand(exact(value,['action',...commandKeys]))} as const;
  throw Error('Invalid restriction request');
 }catch{throw new PublicationRestrictionError('INVALID_INPUT');}
}

export function parsePublicationRestrictionPreview(target:PublicationRestrictionTarget,value:unknown){
 const row=exact(value,['kind','publicationId','title','revision','restricted']);
 if(row.kind!==target.kind||row.publicationId!==target.publicationId||
  typeof row.title!=='string'||row.title.length>320||typeof row.restricted!=='boolean')throw Error('Invalid restriction preview');
 return {kind:target.kind,publicationId:target.publicationId,title:row.title,
  revision:parseListingDraftRevision(row.revision),restricted:row.restricted};
}

export function parsePublicationRestrictionReceipt(command:PublicationRestrictionCommand,value:unknown){
 const row=exact(value,['kind','publicationId','caseId','revision','restrictedAt']);
 if(row.kind!==command.kind||row.publicationId!==command.publicationId||
  row.caseId!==command.caseId||row.revision!==command.expectedRevision)throw Error('Invalid restriction receipt');
 const time=parseListingDraftCursor({id:row.publicationId,updatedAt:row.restrictedAt});
 if(!time)throw Error('Invalid restriction timestamp');
 return {kind:command.kind,publicationId:command.publicationId,caseId:command.caseId,
  revision:command.expectedRevision,restrictedAt:time.updatedAt};
}

export function parsePublicationRestrictionError(status:number|undefined,value:unknown){
 const {error}=exact(value,['error']),{code}=exact(error,['code']);
 if(typeof code!=='string'||!Object.hasOwn(publicationRestrictionErrorStatus,code)||
  publicationRestrictionErrorStatus[code as PublicationRestrictionErrorCode]!==status)throw Error('Invalid restriction error');
 return new PublicationRestrictionError(code as PublicationRestrictionErrorCode);
}
