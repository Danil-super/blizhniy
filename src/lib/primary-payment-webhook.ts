import {randomUUID} from 'node:crypto';import {BlockList,isIP} from 'node:net';
import {authJson,AuthRequestError} from './auth-http.ts';
import {getTrustedProxyIp,normalizeRemoteIp} from './trusted-proxy-ip.ts';
import {parseListingDraftId} from './listing-draft-contract.ts';
import type {PostgresPaymentReconciliationQueue} from './postgres-payment-reconciliation';

// Documented sender ranges, verified 2026-10-19. Defense in depth, not financial proof.
const senders=new BlockList();
for(const [network,prefix] of [['185.71.76.0',27],['185.71.77.0',27],['77.75.153.0',25],['77.75.154.128',25]] as const)senders.addSubnet(network,prefix);
senders.addAddress('77.75.156.11');senders.addAddress('77.75.156.35');senders.addSubnet('2a02:5180::',32,'ipv6');
export function isYooKassaNotificationIp(value:unknown):boolean{
 const ip=normalizeRemoteIp(value);return !!ip&&senders.check(ip,isIP(ip)===6?'ipv6':'ipv4');
}
async function readNotification(request:Request){
 if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')??''))throw new AuthRequestError(415,'JSON_REQUIRED');
 const length=request.headers.get('content-length');if(length&&(!/^\d+$/.test(length)||Number(length)>65536))throw new AuthRequestError(413,'BODY_TOO_LARGE');
 if(!request.body)throw new AuthRequestError(400,'INVALID_NOTIFICATION');
 const reader=request.body.getReader(),deadline=performance.now()+2000;let timer:ReturnType<typeof setTimeout>|undefined,complete=false;
 try{return await Promise.race([
  (async()=>{const decoder=new TextDecoder('utf-8',{fatal:true});let size=0,chunks=0,text='';
   for(;;){if(performance.now()>=deadline)throw new AuthRequestError(408,'BODY_TIMEOUT');const part=await reader.read();
    if(performance.now()>=deadline)throw new AuthRequestError(408,'BODY_TIMEOUT');if(part.done){complete=true;return JSON.parse(text+decoder.decode()) as unknown;}
    size+=part.value.byteLength;if(size>65536||++chunks>1024)throw new AuthRequestError(413,'BODY_TOO_LARGE');text+=decoder.decode(part.value,{stream:true});}
  })(),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new AuthRequestError(408,'BODY_TIMEOUT')),2000);}),
 ]);}catch(error){if(error instanceof AuthRequestError)throw error;throw new AuthRequestError(400,'INVALID_NOTIFICATION');}
 finally{if(timer)clearTimeout(timer);
  // Do not let an uncooperative body cancellation extend the ingress deadline.
  if(!complete)void reader.cancel().catch(()=>undefined);reader.releaseLock();
 }
}
type Event={event:'primary_payment_webhook';entryPoint:'webhook';requestId:string;status:number;durationMs:number;code?:string};
/** Incoming JSON is a hint only. No merchant calls, finance or publication in this handler. */
export function createPrimaryPaymentWebhook(config:{origin:string},runtime:()=>Promise<Pick<PostgresPaymentReconciliationQueue,'enqueue'>>|Pick<PostgresPaymentReconciliationQueue,'enqueue'>,audit:(event:Event)=>void=event=>console.info(JSON.stringify(event))){
 return async(request:Request)=>{
  const requestId=randomUUID(),start=performance.now();let status=503,code:string|undefined;
  const reply=(body:unknown,next:number)=>{status=next;return authJson(body,next,{'X-Request-ID':requestId,...(next===405?{Allow:'POST'}:{})});};
  try{
   if(request.method!=='POST')throw new AuthRequestError(405,'METHOD_NOT_ALLOWED');
   if(request.headers.get('host')!==new URL(config.origin).host||!isYooKassaNotificationIp(getTrustedProxyIp(request.headers)))throw new AuthRequestError(403,'FORBIDDEN_INGRESS');
   if(new URL(request.url).search)throw new AuthRequestError(400,'QUERY_NOT_ALLOWED');
   const raw=await readNotification(request);
   if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new AuthRequestError(400,'INVALID_NOTIFICATION');
   const row=raw as Record<string,unknown>,object=row.object;
   if(row.type!=='notification'||typeof row.event!=='string'||!['payment.succeeded','payment.waiting_for_capture','payment.canceled'].includes(row.event)||!object||typeof object!=='object'||Array.isArray(object))throw new AuthRequestError(400,'INVALID_NOTIFICATION');
   let id:string;try{id=parseListingDraftId((object as Record<string,unknown>).id);}catch{throw new AuthRequestError(400,'INVALID_NOTIFICATION');}
   const queue=await runtime();if(!await queue.enqueue(id))throw new AuthRequestError(503,'WEBHOOK_UNAVAILABLE');
   return reply({ok:true},200);
  }catch(error){status=error instanceof AuthRequestError?error.status:503;code=error instanceof AuthRequestError?error.code:'WEBHOOK_UNAVAILABLE';return reply({error:{code}},status);}
  finally{audit({event:'primary_payment_webhook',entryPoint:'webhook',requestId,status,durationMs:Math.round(performance.now()-start),code});}
 };
}
