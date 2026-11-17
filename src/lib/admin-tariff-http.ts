import {randomUUID} from 'node:crypto';
import {authJson,readAuthJson,AuthRequestError,type AuthRateLimiter} from './auth-http';
import {readAccountSessionToken} from './account-cookie';
import {getTrustedProxyIp} from './trusted-proxy-ip';
import {ListingDraftInputError} from './listing-draft-contract.ts';
import {AdminTariffError,parseAdminTariffCommand,parseAdminTariffResult,tariffAdminErrorStatus,type AdminTariffCommand,type AdminTariffResult} from './admin-tariff-contract.ts';
type Runtime={limiter:Pick<AuthRateLimiter,'allowProduction'>;execute:(token:string,command:AdminTariffCommand,signal:AbortSignal)=>Promise<AdminTariffResult>};
type Event={event:'admin_tariff';requestId:string;status:number;durationMs:number;code?:string};
export function createAdminTariffHandler(config:{origin:string},runtime:()=>Promise<Runtime>|Runtime,audit:(event:Event)=>void=event=>console.info(JSON.stringify(event))){
  return async(request:Request)=>{
    const requestId=randomUUID(),started=Date.now();let status=503,code:string|undefined;
    const reply=(body:unknown,next:number,headers?:Record<string,string>)=>{status=next;return authJson(body,next,{'X-Request-ID':requestId,...headers});};
    try{
      const raw=await readAuthJson(request,config,2000,'POST',4096);let command:AdminTariffCommand;
      try{command=parseAdminTariffCommand(raw);}catch(error){if(error instanceof ListingDraftInputError)throw new AuthRequestError(422,'INVALID_INPUT');throw error;}
      const ip=getTrustedProxyIp(request.headers);if(!ip)throw new AuthRequestError(403,'UNTRUSTED_INGRESS');
      const token=readAccountSessionToken(request);if(!token)throw new AuthRequestError(401,'UNAUTHENTICATED');
      const state=await runtime();if(!await state.limiter.allowProduction('session',ip))throw new AuthRequestError(429,'RATE_LIMITED');
      return reply(parseAdminTariffResult(command,await state.execute(token,command,request.signal)),200);
    }catch(error){
      code=error instanceof AuthRequestError||error instanceof AdminTariffError?error.code:'TARIFF_UNAVAILABLE';
      const next=error instanceof AuthRequestError?error.status:error instanceof AdminTariffError?tariffAdminErrorStatus[error.code]:503;
      return reply({error:{code}},next,next===429?{'Retry-After':'900'}:next===405?{Allow:'POST'}:undefined);
    }finally{audit({event:'admin_tariff',requestId,status,durationMs:Date.now()-started,code});}
  };
}
