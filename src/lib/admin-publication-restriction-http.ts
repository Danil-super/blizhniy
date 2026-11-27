import {randomUUID} from 'node:crypto';
import {readAccountSessionToken} from './account-cookie';
import {authJson,AuthRequestError,readAuthJson,type AuthRateLimiter} from './auth-http';
import {getTrustedProxyIp} from './trusted-proxy-ip';
import {withAppSessionTransaction} from './app-session-transaction';
import type {PostgresDatabase} from './postgres';
import {
 PublicationRestrictionError,parsePublicationRestrictionRequest,parsePublicationRestrictionPreview,
 publicationRestrictionErrorStatus,type PublicationRestrictionCommand,type PublicationRestrictionTarget,
 type parsePublicationRestrictionReceipt,
} from './admin-publication-restriction-contract.ts';

type Runtime={
 db:Pick<PostgresDatabase,'transaction'>;
 limiter:Pick<AuthRateLimiter,'allowProduction'>;
 execute:(token:string,command:PublicationRestrictionCommand,signal:AbortSignal)=>Promise<ReturnType<typeof parsePublicationRestrictionReceipt>>;
};
type Event={event:'admin_publication_restriction';requestId:string;status:number;durationMs:number;code?:string};

function inspect(db:Runtime['db'],token:string,target:PublicationRestrictionTarget){
 return withAppSessionTransaction(db,token,async(tx,user)=>{
  if(user.id!==target.expectedAdminId)throw new PublicationRestrictionError('ADMIN_REQUIRED');
  const table=target.kind==='vacancy'||target.kind==='workRequest'?'work_publications':'service_publications';
  const {rows:[row]}=await tx.query<{kind:string;publicationId:string;title:string;revision:string;restricted:boolean;authorId:string}>(`
   select p.kind,p.id as "publicationId",p.title,p.revision::text,p.author_id as "authorId",
    exists(select 1 from app_publication_restriction.restrictions r where r.kind=p.kind and r.publication_id=p.id) as restricted
   from app.${table} p where p.id=$1 and p.kind=$2 and p.deleted_at is null`,[target.publicationId,target.kind]);
  if(!row)throw new PublicationRestrictionError('PUBLICATION_NOT_FOUND');
  const {authorId,...preview}=row;
  if(authorId===user.id)throw new PublicationRestrictionError('ADMIN_REQUIRED');
  return parsePublicationRestrictionPreview(target,preview);
 },{requireAdmin:true,denied:()=>new PublicationRestrictionError('ADMIN_REQUIRED')});
}

export function createAdminPublicationRestrictionHandler(
 config:{origin:string},runtime:()=>Promise<Runtime>|Runtime,
 audit:(event:Event)=>void=event=>console.info(JSON.stringify(event)),
){
 return async(request:Request)=>{
  const requestId=randomUUID(),started=Date.now();
  let status=503,code:string|undefined;
  const reply=(body:unknown,next:number,headers?:Record<string,string>)=>{
   status=next;
   return authJson(body,next,{'X-Request-ID':requestId,...headers});
  };
  try{
   const input=parsePublicationRestrictionRequest(await readAuthJson(request,config));
   const ip=getTrustedProxyIp(request.headers);
   if(!ip)throw new AuthRequestError(403,'UNTRUSTED_INGRESS');
   const token=readAccountSessionToken(request);
   if(!token)throw new AuthRequestError(401,'UNAUTHENTICATED');
   const {db,limiter,execute}=await runtime();
   if(!await limiter.allowProduction('session',ip))throw new AuthRequestError(429,'RATE_LIMITED');
   request.signal.throwIfAborted();
   const result=input.action==='inspect'
    ?await inspect(db,token,input.target)
    :await execute(token,input.command,request.signal);
   return reply(result,200);
  }catch(error){
   if(error instanceof PublicationRestrictionError){
    code=error.code;
    return reply({error:{code}},publicationRestrictionErrorStatus[error.code]);
   }
   code=error instanceof AuthRequestError?error.code:'ACCESS_UNAVAILABLE';
   const next=error instanceof AuthRequestError?error.status:503;
   return reply({error:{code}},next,next===429?{'Retry-After':'900'}:next===405?{Allow:'POST'}:undefined);
  }finally{
   audit({event:'admin_publication_restriction',requestId,status,durationMs:Date.now()-started,code});
  }
 };
}
