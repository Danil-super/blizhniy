import {parseAdminRefundCommand,parseAdminRefundPage,parseAdminRefundApproval,parseAdminRefundRecovery} from './admin-refund-contract.ts';
import {hashSessionToken} from './identity';
import type {PlacementRefundApproval} from './postgres-refund-approvals';
import type {createPrimaryRefundRecovery} from './primary-refund-recovery';
import type {AdminRefundPage} from './postgres-admin-refund-journal';
type Runtime={readonly shopId?:string;listForAdmin(token:string,actor:string,after:string|null):Promise<AdminRefundPage>;approve(token:string,actor:string,input:unknown):Promise<PlacementRefundApproval>;
 readForAdmin(token:string,actor:string,id:string):Promise<PlacementRefundApproval>;recover:ReturnType<typeof createPrimaryRefundRecovery>['recover']};
/** Private socket commands use the same live app session; no caller-selected SQL, merchant, actor role or send method. */
export function createAdminRefundCommands(runtime:Runtime){
 const shopId=runtime.shopId;
 return async(value:unknown)=>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Reflect.ownKeys(value).length!==(shopId===undefined?2:3)||
  !Object.hasOwn(value,'token')||!Object.hasOwn(value,'command')||
  (shopId!==undefined&&(!Object.hasOwn(value,'shopId')||!('shopId' in value)||value.shopId!==shopId)))throw Error('Refund command unavailable');
 const {token,command:raw}=value as {token:string;command:unknown};if(!hashSessionToken(token))throw Error('Refund command unavailable');
 const command=parseAdminRefundCommand(raw),actor=command.expectedAdminId;
 if(command.action==='list')return parseAdminRefundPage(await runtime.listForAdmin(token,actor,command.input));
 if(command.action==='recover'){
  const result=await runtime.recover(token,actor,command.input);
  return parseAdminRefundRecovery({actionId:result.audit.id,operationId:result.verification.operationId,providerRefundId:result.verification.providerRefundId,status:result.verification.status,state:result.state});
 }
 const result=command.action==='approve'?await runtime.approve(token,actor,command.input):await runtime.readForAdmin(token,actor,command.input);
 return parseAdminRefundApproval({id:result.id,paymentIntentId:result.paymentIntentId,reason:result.reason,amount:result.amount,approvedAt:result.approvedAt});
};}
