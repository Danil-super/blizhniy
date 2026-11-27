import {guardedUserAccessSocket,hostedUserAccessSocket} from './hosted-user-access-config.ts';
import {requestPrivateJsonOperator} from './private-json-operator-socket.ts';
import {AdminUserAccessError,parseAdminUserAccessCommand,parseAdminUserAccessResult} from './admin-user-access-contract.ts';
import {AdminTariffError,parseAdminTariffCommand,parseAdminTariffResult} from './admin-tariff-contract.ts';
import {parseAdminOperatorEnvelope,parseAdminOperatorResult,adminOperatorErrorStatus,adminOperatorError} from './admin-operator-contract.ts';
/** Owned Unix IPC only; timeout never retries a mutation. Recover its original operation ID. */
async function callAdminOperator(socketPath:string,token:string,value:unknown,signal?:AbortSignal,hostedPath?:string){
  try{
    const envelope=parseAdminOperatorEnvelope({token,command:value});
    const {status,payload}=await requestPrivateJsonOperator(socketPath,envelope,{signal,hostedPath});
    if(status!==200){
      const result=payload as {error?:{code?:unknown}}|null,code=result?.error?.code;
      if(result?.error&&typeof code==='string'&&Object.hasOwn(adminOperatorErrorStatus,code)&&adminOperatorErrorStatus[code as keyof typeof adminOperatorErrorStatus]===status&&
        Object.keys(result).join()==='error'&&Object.keys(result.error).join()==='code')throw adminOperatorError(envelope.command,code);
      throw Error();
    }
    return parseAdminOperatorResult(envelope.command,payload);
  }catch(error){if(error instanceof AdminUserAccessError||error instanceof AdminTariffError)throw error;throw new AdminUserAccessError('ACCESS_UNAVAILABLE');}
}

export async function callLocalUserAccessOperator(socketPath:string,token:string,value:unknown,signal?:AbortSignal){
 try{const command=parseAdminUserAccessCommand(value);return parseAdminUserAccessResult(command,await callAdminOperator(socketPath,token,command,signal));}
 catch(error){if(error instanceof AdminUserAccessError)throw error;throw new AdminUserAccessError('ACCESS_UNAVAILABLE');}
}
export async function callLocalTariffOperator(socketPath:string,token:string,value:unknown,signal?:AbortSignal){
 try{const command=parseAdminTariffCommand(value);return parseAdminTariffResult(command,await callAdminOperator(socketPath,token,command,signal));}
 catch(error){if(error instanceof AdminTariffError)throw error;throw new AdminTariffError('TARIFF_UNAVAILABLE');}
}

export async function callHostedUserAccessOperator(token:string,value:unknown,signal?:AbortSignal,socketPath:string=hostedUserAccessSocket){
 try{const command=parseAdminUserAccessCommand(value);
  if(socketPath!==hostedUserAccessSocket&&socketPath!==guardedUserAccessSocket)throw Error();
  return parseAdminUserAccessResult(command,await callAdminOperator(socketPath,token,command,signal,socketPath));
 }catch(error){if(error instanceof AdminUserAccessError)throw error;throw new AdminUserAccessError('ACCESS_UNAVAILABLE');}
}

export async function callHostedTariffOperator(token:string,value:unknown,signal?:AbortSignal,socketPath:string=hostedUserAccessSocket){
 try{const command=parseAdminTariffCommand(value);
  if(socketPath!==hostedUserAccessSocket&&socketPath!==guardedUserAccessSocket)throw Error();
  return parseAdminTariffResult(command,await callAdminOperator(socketPath,token,command,signal,socketPath));
 }catch(error){if(error instanceof AdminTariffError)throw error;throw new AdminTariffError('TARIFF_UNAVAILABLE');}
}
