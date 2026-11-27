import {
 PublicationRestrictionError,parsePublicationRestrictionEnvelope,parsePublicationRestrictionError,parsePublicationRestrictionReceipt,
} from './admin-publication-restriction-contract.ts';
import {requestPrivateJsonOperator} from './private-json-operator-socket.ts';

export const hostedPublicationRestrictionSocket='/run/blizhniy-publication-restriction/operator.sock';

/** A lost response is resolved by repeating the same case and revision. */
export function callPublicationRestrictionOperator(socketPath:string,token:string,value:unknown,signal?:AbortSignal){
 return call(socketPath,token,value,signal);
}

export function callHostedPublicationRestrictionOperator(token:string,value:unknown,signal?:AbortSignal){
 return call(hostedPublicationRestrictionSocket,token,value,signal,hostedPublicationRestrictionSocket);
}

async function call(socketPath:string,token:string,value:unknown,signal?:AbortSignal,hostedPath?:string){
 const envelope=parsePublicationRestrictionEnvelope({token,command:value});
 try{
  const {status,payload}=await requestPrivateJsonOperator(socketPath,envelope,{signal,hostedPath,responseLimit:2048});
  if(status!==200)throw parsePublicationRestrictionError(status,payload);
  return parsePublicationRestrictionReceipt(envelope.command,payload);
 }catch(error){
  if(error instanceof PublicationRestrictionError)throw error;
  throw new PublicationRestrictionError('ACCESS_UNAVAILABLE');
 }
}
