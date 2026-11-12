import {randomUUID} from 'node:crypto';
import {authJson,readAuthJson,AuthRequestError,type AuthRateLimiter} from './auth-http';
import {readAccountSessionToken} from './account-cookie';
import {getTrustedProxyIp} from './trusted-proxy-ip';
import {parseAdminRefundCommand,parseAdminRefundResult,type AdminRefundCommand} from './admin-refund-contract.ts';
type Runtime={limiter:Pick<AuthRateLimiter,'allowProduction'>;command(token:string,command:AdminRefundCommand,signal:AbortSignal):Promise<unknown>};
type Event={event:'admin_refund';requestId:string;status:number;durationMs:number;code?:string};
/** Mounted only by the inspected local ingress. The private operator remains the live administrator authority. */
export function createAdminRefundHandler(config:{origin:string},runtime:()=>Runtime|Promise<Runtime>,audit:(event:Event)=>void=event=>console.info(JSON.stringify(event))){
 return async(request:Request)=>{
  const requestId=randomUUID(),started=Date.now();let status=503,code:string|undefined;
  const reply=(body:unknown,next:number,headers?:Record<string,string>)=>{status=next;return authJson(body,next,{'X-Request-ID':requestId,...headers});};
  try{
   const raw=await readAuthJson(request,config,2000,'POST',4096);let command:AdminRefundCommand;
   try{command=parseAdminRefundCommand(raw);}catch{throw new AuthRequestError(422,'INVALID_INPUT');}
   const ip=getTrustedProxyIp(request.headers);if(!ip)throw new AuthRequestError(403,'UNTRUSTED_INGRESS');
   const token=readAccountSessionToken(request);if(!token)throw new AuthRequestError(401,'UNAUTHENTICATED');
   request.signal.throwIfAborted();const state=await runtime();
   if(!await state.limiter.allowProduction('session',ip))throw new AuthRequestError(429,'RATE_LIMITED');
   request.signal.throwIfAborted();return reply(parseAdminRefundResult(command,await state.command(token,command,request.signal)),200);
  }catch(error){
   code=error instanceof AuthRequestError?error.code:'REFUND_OPERATOR_UNAVAILABLE';const next=error instanceof AuthRequestError?error.status:503;
   return reply({error:{code}},next,next===429?{'Retry-After':'900'}:next===405?{Allow:'POST'}:undefined);
  }finally{audit({event:'admin_refund',requestId,status,durationMs:Date.now()-started,code});}
 };
}
