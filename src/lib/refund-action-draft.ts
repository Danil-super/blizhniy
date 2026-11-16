import {parseAdminRefundCommand,type AdminRefundCommand} from './admin-refund-contract.ts';
import {parseListingDraftId} from './listing-draft-contract.ts';
type Action=Extract<AdminRefundCommand,{action:'approve'|'recover'}>;
type Storage=Pick<globalThis.Storage,'getItem'|'setItem'|'removeItem'>;
/** Per-tab durable IDs contain no session token. An uncertain command must never be replaced automatically. */
export function createRefundActionDrafts(storage:Storage){
 const key=(actor:string)=>'blizhniy-refund-action:'+parseListingDraftId(actor);
 function read(actor:string):Action|null{
  const value=storage.getItem(key(actor));if(value===null)return null;if(value.length>4096)throw Error('Refund action unavailable');
  const command=parseAdminRefundCommand(JSON.parse(value));
  if(command.expectedAdminId!==actor||!['approve','recover'].includes(command.action))throw Error('Refund action unavailable');return command as Action;
 }
 return{read,save(actor:string,value:unknown){
  const command=parseAdminRefundCommand(value);if(command.expectedAdminId!==actor||!['approve','recover'].includes(command.action))throw Error('Refund action unavailable');
  const previous=read(actor),text=JSON.stringify(command);if(previous&&JSON.stringify(previous)!==text)throw Error('Refund action unresolved');
  storage.setItem(key(actor),text);if(storage.getItem(key(actor))!==text)throw Error('Refund action not retained');return command as Action;
 },clear(actor:string,id:string){const previous=read(actor);if(!previous||previous.input.id!==parseListingDraftId(id))throw Error('Refund action changed');storage.removeItem(key(actor));if(storage.getItem(key(actor))!==null)throw Error('Refund action not cleared');}};
}
