import {ListingDraftInputError} from './listing-draft-contract.ts';
import {parseAdminUserAccessCommand,parseAdminUserAccessResult,userAccessErrorStatus,AdminUserAccessError,type AdminUserAccessCommand,type UserAccessErrorCode} from './admin-user-access-contract.ts';
import {parseAdminTariffCommand,parseAdminTariffResult,tariffAdminErrorStatus,AdminTariffError,type AdminTariffCommand,type TariffAdminErrorCode} from './admin-tariff-contract.ts';
export type AdminOperatorCommand=AdminUserAccessCommand|AdminTariffCommand;
export const adminOperatorErrorStatus={...userAccessErrorStatus,...tariffAdminErrorStatus};
export function isTariffCommand(command:AdminOperatorCommand):command is AdminTariffCommand{return 'resource'in command&&command.resource==='tariffs';}
export function parseAdminOperatorEnvelope(value:unknown){
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||
  Reflect.ownKeys(value).length!==2||!('token'in value)||!('command'in value)||typeof value.token!=='string'||!/^[a-f0-9]{64}$/.test(value.token))throw new ListingDraftInputError();
 const input=value.command,command=input&&typeof input==='object'&&'resource'in input?parseAdminTariffCommand(input):parseAdminUserAccessCommand(input);
 return {token:value.token,command};
}
export function parseAdminOperatorResult(command:AdminOperatorCommand,value:unknown){return isTariffCommand(command)?parseAdminTariffResult(command,value):parseAdminUserAccessResult(command,value);}
export function adminOperatorError(command:AdminOperatorCommand,code:string){
 return isTariffCommand(command)?new AdminTariffError(Object.hasOwn(tariffAdminErrorStatus,code)?code as TariffAdminErrorCode:'TARIFF_UNAVAILABLE'):
  new AdminUserAccessError(Object.hasOwn(userAccessErrorStatus,code)?code as UserAccessErrorCode:'ACCESS_UNAVAILABLE');
}
