import {parseListingDraftId,parseListingDraftRevision} from './listing-draft-contract.ts';
import {validPlainText} from './cabinet-field-validation.ts';
import {readPostmoderationEnabled} from './listing-workflow-config.ts';
export class WorkOwnerActionInputError extends Error{constructor(){super('Invalid work owner action');this.name='WorkOwnerActionInputError';}}
export type WorkOwnerAction={operationId:string;publicationId:string;kind:'vacancy'|'workRequest';expectedRevision:string;action:'withdraw'|'restore'|'remove';reason:string|null};
export function parseWorkOwnerAction(value:unknown):WorkOwnerAction{
 try{
  const keys=['operationId','publicationId','kind','expectedRevision','action','reason'];
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Reflect.ownKeys(value).length!==keys.length)throw Error();
  const row=value as Record<string,unknown>;
  if(keys.some(key=>!Object.hasOwn(row,key))||(row.kind!=='vacancy'&&row.kind!=='workRequest')||!['withdraw','restore','remove'].includes(String(row.action)))throw Error();
  if(row.action==='restore'?row.reason!==null:typeof row.reason!=='string'||row.reason.length>500||!row.reason.trim()||!validPlainText(row.reason))throw Error();
  return{operationId:parseListingDraftId(row.operationId),publicationId:parseListingDraftId(row.publicationId),kind:row.kind,expectedRevision:parseListingDraftRevision(row.expectedRevision),action:row.action as WorkOwnerAction['action'],reason:typeof row.reason==='string'?row.reason.trim():null};
 }catch{throw new WorkOwnerActionInputError();}
}
export function readWorkOwnerActionsEnabled(env:NodeJS.ProcessEnv=process.env):boolean{
 if(typeof window!=='undefined')throw Error('Work actions configuration is server-only');
 if(env.BLIZHNIY_WORK_OWNER_ACTIONS===undefined)return false;
 if(env.BLIZHNIY_WORK_OWNER_ACTIONS==='production-v1'){
  if(env.BLIZHNIY_LOCAL_PRIMARY!==undefined||!readPostmoderationEnabled(env))throw Error('Invalid production work owner action activation');
  return true;
 }
 if(env.BLIZHNIY_WORK_OWNER_ACTIONS!=='local-v1'||env.BLIZHNIY_LOCAL_PRIMARY!=='enabled'||env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN!=='https://127.0.0.1:3045')throw Error('Invalid work owner action activation');
 return true;
}
