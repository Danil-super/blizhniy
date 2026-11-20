import {randomUUID} from 'node:crypto';
import {authJson,readAuthJson,AuthRequestError,type AuthRateLimiter} from './auth-http';
import {readAccountSessionToken} from './account-cookie';
import {getTrustedProxyIp} from './trusted-proxy-ip';
import {AppSessionAccessError} from './app-session-transaction';
import {parsePaymentHistoryRequest} from './payment-history-contract.ts';
import type {PostgresPaymentHistoryStore} from './postgres-payment-history';
type Runtime={store:Pick<PostgresPaymentHistoryStore,'list'|'readSpecialistOrder'>;limiter:Pick<AuthRateLimiter,'allowProduction'>};
type Event={event:'payment_history';requestId:string;status:number;durationMs:number;code?:string};
export function createPaymentHistoryHandler(config:{origin:string},runtime:()=>Promise<Runtime>|Runtime,audit:(event:Event)=>void=event=>console.info(JSON.stringify(event))){
 return async(request:Request)=>{
  const requestId=randomUUID(),start=Date.now();let status=503,code:string|undefined;
  const reply=(body:unknown,next:number,headers?:Record<string,string>)=>{status=next;return authJson(body,next,{'X-Request-ID':requestId,...headers});};
  try{
   if(request.method!=='POST')throw new AuthRequestError(405,'METHOD_NOT_ALLOWED');
   const raw=await readAuthJson(request,config);let input:ReturnType<typeof parsePaymentHistoryRequest>;
   try{input=parsePaymentHistoryRequest(raw);}catch{throw new AuthRequestError(422,'INVALID_INPUT');}
   const ip=getTrustedProxyIp(request.headers);if(!ip)throw new AuthRequestError(403,'UNTRUSTED_INGRESS');
   const token=readAccountSessionToken(request);if(!token)throw new AuthRequestError(401,'UNAUTHENTICATED');
   const {store,limiter}=await runtime();if(!await limiter.allowProduction('session',ip))throw new AuthRequestError(429,'RATE_LIMITED');
   const result='paymentId' in input?await store.readSpecialistOrder(token,input.expectedOwnerId,input.paymentId):await store.list(token,input.expectedOwnerId,'receipt' in input?input.receipt:input.cursor);
   if(result&&'canResumeSpecialist' in result&&result.canResumeSpecialist){
    const {order,fulfillment,testOnly,testPublication}=result;
    return reply({order,fulfillment,testOnly,testPublication},200,{'X-Blizhniy-Specialist-Resume':'1'});
   }
   return reply(result,200);
  }catch(error){
   if(error instanceof AppSessionAccessError)error=new AuthRequestError(401,'UNAUTHENTICATED');
   code=error instanceof AuthRequestError?error.code:'PAYMENT_HISTORY_UNAVAILABLE';const next=error instanceof AuthRequestError?error.status:503;
   return reply({error:{code}},next,next===429?{'Retry-After':'900'}:next===405?{Allow:'POST'}:undefined);
  }finally{audit({event:'payment_history',requestId,status,durationMs:Date.now()-start,code});}
 };
}
