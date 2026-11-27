import {parseAdminRefundCommand,parseAdminRefundPage,parseAdminRefundApproval,parseAdminRefundRecovery} from './admin-refund-contract.ts';
import {parseAdminPasskeyAssertion} from './admin-passkey-contract.ts';
import {hashSessionToken} from './identity';
import type {PlacementRefundApproval} from './postgres-refund-approvals';
import type {createPrimaryRefundRecovery} from './primary-refund-recovery';
import type {AdminRefundPage} from './postgres-admin-refund-journal';
type Credential=ReturnType<typeof parseAdminPasskeyAssertion>;
type Runtime={readonly shopId?:string;readonly passkey?:true;listForAdmin(token:string,actor:string,after:string|null):Promise<AdminRefundPage>;
 approve(token:string,actor:string,input:unknown,credential?:Credential):Promise<PlacementRefundApproval>;
 readForAdmin(token:string,actor:string,id:string):Promise<PlacementRefundApproval>;
 recover(token:string,actor:string,input:unknown,credential?:Credential):ReturnType<ReturnType<typeof createPrimaryRefundRecovery>['recover']>};
/** Private socket commands use the same live app session; no caller-selected SQL, merchant, actor role or send method. */
export function createAdminRefundCommands(runtime:Runtime){
 const shopId=runtime.shopId;
 return async(value:unknown)=>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Refund command unavailable');
 const hasCredential=runtime.passkey===true&&Object.hasOwn(value,'credential');
 if(Reflect.ownKeys(value).length!==(shopId===undefined?2:3)+Number(hasCredential)||
  !Object.hasOwn(value,'token')||!Object.hasOwn(value,'command')||
  (shopId!==undefined&&(!Object.hasOwn(value,'shopId')||!('shopId' in value)||value.shopId!==shopId)))throw Error('Refund command unavailable');
 const {token,command:raw}=value as {token:string;command:unknown};if(!hashSessionToken(token))throw Error('Refund command unavailable');
 const command=parseAdminRefundCommand(raw),actor=command.expectedAdminId;
 if(hasCredential&&(command.action==='list'||command.action==='read'))throw Error('Refund command unavailable');
 const credential=hasCredential?parseAdminPasskeyAssertion((value as {credential:unknown}).credential):undefined;
 if(command.action==='list')return parseAdminRefundPage(await runtime.listForAdmin(token,actor,command.input));
 if(command.action==='recover'){
  const result=await (hasCredential?runtime.recover(token,actor,command.input,credential):runtime.recover(token,actor,command.input));
  return parseAdminRefundRecovery({actionId:result.audit.id,operationId:result.verification.operationId,providerRefundId:result.verification.providerRefundId,status:result.verification.status,state:result.state});
 }
 const result=command.action==='approve'?
  await (hasCredential?runtime.approve(token,actor,command.input,credential):runtime.approve(token,actor,command.input)):
  await runtime.readForAdmin(token,actor,command.input);
 return parseAdminRefundApproval({id:result.id,paymentIntentId:result.paymentIntentId,reason:result.reason,amount:result.amount,approvedAt:result.approvedAt});
};}
