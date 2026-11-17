import {randomUUID} from 'node:crypto';
import {authJson,readAuthJson,AuthRequestError,type AuthRateLimiter} from './auth-http';
import {readAccountSessionToken} from './account-cookie';
import {getTrustedProxyIp} from './trusted-proxy-ip';
import {AdminAccessError} from './admin-authorization';
import {ListingDraftInputError} from './listing-draft-contract.ts';
import {parseAdminUserQuery} from './admin-user-directory-contract.ts';
import type {PostgresAdminUserDirectory} from './postgres-admin-user-directory';

type Runtime={store:Pick<PostgresAdminUserDirectory,'list'>;limiter:Pick<AuthRateLimiter,'allowProduction'>};
type Event={event:'admin_user_directory';requestId:string;status:number;durationMs:number;code?:string};
export function createAdminUserDirectoryHandler(config:{origin:string},runtime:()=>Promise<Runtime>|Runtime,
  audit:(event:Event)=>void=event=>console.info(JSON.stringify(event))) {
  return async(request:Request)=>{
    const requestId=randomUUID(),started=Date.now();let status=503,code:string|undefined;
    const reply=(body:unknown,next:number,headers?:Record<string,string>)=>{status=next;return authJson(body,next,{'X-Request-ID':requestId,...headers});};
    try {
      const input=parseAdminUserQuery(await readAuthJson(request,config,2000,'POST',2048));
      const ip=getTrustedProxyIp(request.headers);if(!ip)throw new AuthRequestError(403,'UNTRUSTED_INGRESS');
      const token=readAccountSessionToken(request);if(!token)throw new AuthRequestError(401,'UNAUTHENTICATED');
      const state=await runtime();if(!await state.limiter.allowProduction('session',ip))throw new AuthRequestError(429,'RATE_LIMITED');
      return reply(await state.store.list(token,input),200);
    } catch(error) {
      if(error instanceof ListingDraftInputError)error=new AuthRequestError(422,'INVALID_INPUT');
      if(error instanceof AdminAccessError)error=new AuthRequestError(403,'ADMIN_REQUIRED');
      code=error instanceof AuthRequestError?error.code:'DIRECTORY_UNAVAILABLE';
      const next=error instanceof AuthRequestError?error.status:503;
      return reply({error:{code}},next,next===429?{'Retry-After':'900'}:next===405?{Allow:'POST'}:undefined);
    } finally {audit({event:'admin_user_directory',requestId,status,durationMs:Date.now()-started,code});}
  };
}
