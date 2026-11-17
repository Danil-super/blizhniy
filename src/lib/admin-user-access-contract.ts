import {ListingDraftInputError,parseListingDraftId,parseListingDraftRevision,parseListingDraftCursor} from './listing-draft-contract.ts';
import {validPlainText} from './cabinet-field-validation.ts';
export type UserAccessChange={id:string;targetId:string;expectedVersion:string;role:'user'|'admin';isBlocked:boolean;reason:string};
export type AdminUserAccessCommand={action:'inspect';expectedAdminId:string;targetId:string}|{action:'recover';expectedAdminId:string;targetId:string;id:string}|{action:'change';expectedAdminId:string;input:UserAccessChange};
export type UserAccessReceipt={id:string;actorId:string;targetId:string;expectedVersion:string;previousRole:'user'|'admin';role:'user'|'admin';previousBlocked:boolean;isBlocked:boolean;resultingVersion:string;reason:string;changed:boolean;createdAt:string};
export type AdminUserAccessResult={user:{id:string;role:'user'|'admin';isBlocked:boolean;emailVerified:boolean;authVersion:string};receipt:UserAccessReceipt|null;history:UserAccessReceipt[]};
function invalid():never{throw new ListingDraftInputError();}
function exact(value:unknown,keys:string[]):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||
    Reflect.ownKeys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))invalid();
  return value as Record<string,unknown>;
}
const version=(value:unknown)=>value==='0'?'0':parseListingDraftRevision(value);
const role=(value:unknown):'user'|'admin'=>value==='user'||value==='admin'?value:invalid();
const boolean=(value:unknown):boolean=>typeof value==='boolean'?value:invalid();
function reason(value:unknown){
  if(typeof value!=='string'||!validPlainText(value)||[...value].length>500)invalid();
  const result=value.trim();if([...result].length<3)invalid();return result;
}
export function parseAdminUserAccessCommand(value:unknown):AdminUserAccessCommand{
  if(!value||typeof value!=='object'||!('action'in value))invalid();
  if(value.action==='inspect'){
    const row=exact(value,['action','expectedAdminId','targetId']);
    return {action:'inspect',expectedAdminId:parseListingDraftId(row.expectedAdminId),targetId:parseListingDraftId(row.targetId)};
  }
  if(value.action==='recover'){
    const row=exact(value,['action','expectedAdminId','targetId','id']);
    return {action:'recover',expectedAdminId:parseListingDraftId(row.expectedAdminId),targetId:parseListingDraftId(row.targetId),id:parseListingDraftId(row.id)};
  }
  const row=exact(value,['action','expectedAdminId','input']);if(row.action!=='change')invalid();
  const input=exact(row.input,['id','targetId','expectedVersion','role','isBlocked','reason']);
  return {action:'change',expectedAdminId:parseListingDraftId(row.expectedAdminId),input:{id:parseListingDraftId(input.id),targetId:parseListingDraftId(input.targetId),
    expectedVersion:version(input.expectedVersion),role:role(input.role),isBlocked:boolean(input.isBlocked),reason:reason(input.reason)}};
}
export function parseUserAccessEnvelope(value:unknown){
  const row=exact(value,['token','command']);
  if(typeof row.token!=='string'||!/^[a-f0-9]{64}$/.test(row.token))invalid();
  return {token:row.token,command:parseAdminUserAccessCommand(row.command)};
}
function receipt(value:unknown):UserAccessReceipt{
  const row=exact(value,['id','actorId','targetId','expectedVersion','previousRole','role','previousBlocked','isBlocked','resultingVersion','reason','changed','createdAt']);
  const result:UserAccessReceipt={id:parseListingDraftId(row.id),actorId:parseListingDraftId(row.actorId),targetId:parseListingDraftId(row.targetId),
    expectedVersion:version(row.expectedVersion),previousRole:role(row.previousRole),role:role(row.role),previousBlocked:boolean(row.previousBlocked),isBlocked:boolean(row.isBlocked),
    resultingVersion:version(row.resultingVersion),reason:reason(row.reason),changed:boolean(row.changed),createdAt:parseListingDraftCursor({id:row.id,updatedAt:row.createdAt})!.updatedAt};
  if(result.reason!==row.reason||result.changed!==(result.previousRole!==result.role||result.previousBlocked!==result.isBlocked)||
    BigInt(result.resultingVersion)!==BigInt(result.expectedVersion)+(result.changed?BigInt(1):BigInt(0)))invalid();
  return result;
}
export function parseAdminUserAccessResult(input:AdminUserAccessCommand,value:unknown):AdminUserAccessResult{
  const command=parseAdminUserAccessCommand(input),row=exact(value,['user','receipt','history']);
  const raw=exact(row.user,['id','role','isBlocked','emailVerified','authVersion']);
  const user={id:parseListingDraftId(raw.id),role:role(raw.role),isBlocked:boolean(raw.isBlocked),emailVerified:boolean(raw.emailVerified),authVersion:version(raw.authVersion)};
  const target=command.action==='change'?command.input.targetId:command.targetId;if(user.id!==target)invalid();
  if(!Array.isArray(row.history)||row.history.length>10)invalid();const history=row.history.map(receipt);
  if(new Set(history.map(row=>row.id)).size!==history.length||history.some(row=>row.targetId!==target||BigInt(row.resultingVersion)>BigInt(user.authVersion)))invalid();
  for(let index=1;index<history.length;index++)if(history[index].createdAt>history[index-1].createdAt||history[index].createdAt===history[index-1].createdAt&&history[index].id>history[index-1].id)invalid();
  const saved=row.receipt===null?null:receipt(row.receipt);
  if(command.action==='inspect'){if(saved!==null)invalid();}
  else if(command.action==='recover'){
    if(saved&&(saved.id!==command.id||saved.actorId!==command.expectedAdminId||saved.targetId!==target||BigInt(saved.resultingVersion)>BigInt(user.authVersion)))invalid();
  }else{
    const intent=command.input;
    if(!saved||saved.id!==intent.id||saved.actorId!==command.expectedAdminId||saved.targetId!==target||saved.expectedVersion!==intent.expectedVersion||
      saved.role!==intent.role||saved.isBlocked!==intent.isBlocked||saved.reason!==intent.reason||BigInt(saved.resultingVersion)>BigInt(user.authVersion))invalid();
    if(saved.resultingVersion===user.authVersion&&(saved.role!==user.role||saved.isBlocked!==user.isBlocked))invalid();
    const same=history.find(row=>row.id===saved.id);if(same&&JSON.stringify(same)!==JSON.stringify(saved))invalid();
  }
  return {user,receipt:saved,history};
}
export const userAccessErrorStatus={ADMIN_REQUIRED:403,OPERATION_CONFLICT:409,STALE_ACCESS:409,LAST_ADMIN:409,SELF_CHANGE:409,USER_UNAVAILABLE:404,USER_NOT_READY:409,ACCESS_BUSY:409,ACCESS_UNAVAILABLE:503} as const;
export type UserAccessErrorCode=keyof typeof userAccessErrorStatus;
export class AdminUserAccessError extends Error{
  readonly code:UserAccessErrorCode;
  constructor(code:UserAccessErrorCode){
    const messages:Record<UserAccessErrorCode,string>={ADMIN_REQUIRED:'Доступ администратора не подтверждён.',OPERATION_CONFLICT:'Этот номер операции уже использован. Обновите данные.',
      STALE_ACCESS:'Доступ пользователя изменился. Обновите данные и проверьте решение.',LAST_ADMIN:'Нельзя лишить сайт последнего администратора.',SELF_CHANGE:'Нельзя изменить собственный доступ.',
      USER_UNAVAILABLE:'Пользователь недоступен.',USER_NOT_READY:'Администратором может стать только пользователь с подтверждённым email.',ACCESS_BUSY:'Данные сейчас изменяются. Повторите позже.',ACCESS_UNAVAILABLE:'Не удалось получить результат операции. Проверьте его перед новым изменением.'};
    super(messages[code]);this.code=code;
  }
}
