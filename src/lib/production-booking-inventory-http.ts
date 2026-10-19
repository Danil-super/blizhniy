import {randomUUID} from 'node:crypto';import {authJson,AuthRequestError} from './auth-http';import {getTrustedProxyIp} from './trusted-proxy-ip';
import {parseListingDraftId,ListingDraftInputError} from './listing-draft-contract.ts';import type {PostgresBookingAvailabilityStore} from './postgres-bookings';
type Event={event:'booking_inventory';requestId:string;status:number;durationMs:number;code?:string};
export function createProductionBookingInventoryHandler(config:{origin:string},runtime:()=>Pick<PostgresBookingAvailabilityStore,'read'>|Promise<Pick<PostgresBookingAvailabilityStore,'read'>>,audit:(event:Event)=>void=event=>console.info(JSON.stringify(event))){
 return async(request:Request,value:unknown)=>{
  const requestId=randomUUID(),started=Date.now();let status=503,code:string|undefined;
  try{
   if(request.method!=='GET')throw new AuthRequestError(405,'METHOD_NOT_ALLOWED');
   if(request.headers.get('host')!==new URL(config.origin).host)throw new AuthRequestError(403,'FORBIDDEN_TARGET');
   if(new URL(request.url).search)throw new AuthRequestError(400,'QUERY_NOT_ALLOWED');
   if(!getTrustedProxyIp(request.headers))throw new AuthRequestError(403,'UNTRUSTED_INGRESS');
   const id=parseListingDraftId(value);request.signal.throwIfAborted();const inventory=await(await runtime()).read(id);request.signal.throwIfAborted();
   if(!inventory)throw new AuthRequestError(404,'BOOKING_NOT_FOUND');status=200;return authJson(inventory,200,{'X-Request-ID':requestId});
  }catch(error){
   if(error instanceof ListingDraftInputError)error=new AuthRequestError(404,'BOOKING_NOT_FOUND');
   status=error instanceof AuthRequestError?error.status:503;code=error instanceof AuthRequestError?error.code:'BOOKINGS_UNAVAILABLE';
   return authJson({error:{code}},status,{'X-Request-ID':requestId,...(status===405?{Allow:'GET'}:{})});
  }finally{audit({event:'booking_inventory',requestId,status,durationMs:Date.now()-started,code});}
 };
}
