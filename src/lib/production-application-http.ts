import {randomUUID} from 'node:crypto';
import {authJson,readAuthJson,AuthRequestError,type AuthRateLimiter} from './auth-http';import {readAccountSessionToken} from './account-cookie';import {getTrustedProxyIp} from './trusted-proxy-ip';
import {AppSessionAccessError} from './app-session-transaction';
import {ApplicationAccessError,ApplicationConflictError,ApplicationEligibilityError,ApplicationBusyError,type PostgresApplicationStore} from './postgres-applications';
import {ApplicationInputError,parseApplicationKind,parseApplicationCreate,parseApplicationEdit} from './application-contract.ts';
import {ListingDraftInputError,parseListingDraftId,parseListingDraftRevision,parseListingDraftCursor} from './listing-draft-contract.ts';
type Runtime={store:Pick<PostgresApplicationStore,'preview'|'create'|'update'|'read'|'readIntent'|'list'|'decide'>;limiter:Pick<AuthRateLimiter,'allowProduction'>};
type Event={event:'application_request';requestId:string;operation:string;status:number;durationMs:number;code?:string};
const envelopes={preview:['kind','targetId'],read:['applicationId'],intent:['creationKey'],list:['mode','after'],create:['input'],update:['input'],decide:['applicationId','expectedRevision','state']} as const;
export function createProductionApplicationHandler(config:{origin:string},runtime:()=>Runtime|Promise<Runtime>,audit:(event:Event)=>void=event=>console.info(JSON.stringify(event))){
 return async(request:Request)=>{
  const requestId=randomUUID(),started=Date.now();let operation='invalid',status=503,code:string|undefined;
  const reply=(value:unknown,next:number,headers?:Record<string,string>)=>{status=next;return authJson(value,next,{'X-Request-ID':requestId,...headers});};
  try{
   if(!['POST','PUT'].includes(request.method))throw new AuthRequestError(405,'METHOD_NOT_ALLOWED');const writing=request.method==='PUT';
   const raw=await readAuthJson(request,config,2000,writing?'PUT':'POST',writing?16384:4096);
   if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new AuthRequestError(422,'INVALID_INPUT');const row=raw as Record<string,unknown>,action=row.action;
   if(typeof action!=='string'||!Object.hasOwn(envelopes,action)||writing!==['create','update','decide'].includes(action))throw new AuthRequestError(422,'INVALID_INPUT');
   const chosen=action as keyof typeof envelopes,keys=['action','expectedOwnerId',...envelopes[chosen]];
   if(Object.keys(row).length!==keys.length||keys.some(key=>!Object.hasOwn(row,key)))throw new AuthRequestError(422,'INVALID_INPUT');
   const owner=parseListingDraftId(row.expectedOwnerId),id=chosen==='read'||chosen==='decide'?parseListingDraftId(row.applicationId):null;
   const target=chosen==='preview'?{kind:parseApplicationKind(row.kind),id:parseListingDraftId(row.targetId)}:null,key=chosen==='intent'?parseListingDraftId(row.creationKey):null;
   const create=chosen==='create'?parseApplicationCreate(row.input):null,edit=chosen==='update'?parseApplicationEdit(row.input):null;
   const revision=chosen==='decide'?parseListingDraftRevision(row.expectedRevision):null,cursor=chosen==='list'?parseListingDraftCursor(row.after):null;
   if(chosen==='decide'&&row.state!=='viewed'&&row.state!=='selected'&&row.state!=='rejected'||chosen==='list'&&row.mode!=='applicant'&&row.mode!=='recipient')throw new ApplicationInputError();
   operation=chosen;const ip=getTrustedProxyIp(request.headers);if(!ip)throw new AuthRequestError(403,'UNTRUSTED_INGRESS');
   const token=readAccountSessionToken(request);if(!token)throw new AuthRequestError(401,'UNAUTHENTICATED');
   const {store,limiter}=await runtime();if(!await limiter.allowProduction('session',ip))throw new AuthRequestError(429,'RATE_LIMITED');
   switch(chosen){
    case'preview':return reply(await store.preview(token,owner,target!.kind,target!.id),200);
    case'read':return reply(await store.read(token,owner,id),200);
    case'intent':return reply(await store.readIntent(token,owner,key),200);
    case'list':return reply(await store.list(token,owner,row.mode,cursor),200);
    case'create':return reply(await store.create(token,owner,create),200);
    case'update':return reply(await store.update(token,owner,edit),200);
    case'decide':return reply(await store.decide(token,owner,id,revision,row.state),200);
   }
  }catch(error){
   if(error instanceof AppSessionAccessError)error=new AuthRequestError(401,'UNAUTHENTICATED');
   if(error instanceof ApplicationAccessError)error=new AuthRequestError(404,'APPLICATION_NOT_FOUND');
   if(error instanceof ApplicationConflictError)error=new AuthRequestError(409,'APPLICATION_CHANGED');
   if(error instanceof ApplicationEligibilityError)error=new AuthRequestError(409,'SPECIALIST_REQUIRED');
   if(error instanceof ApplicationBusyError)error=new AuthRequestError(409,'APPLICATION_BUSY');
   if(error instanceof ApplicationInputError||error instanceof ListingDraftInputError)error=new AuthRequestError(422,'INVALID_INPUT');
   code=error instanceof AuthRequestError?error.code:'APPLICATIONS_UNAVAILABLE';const next=error instanceof AuthRequestError?error.status:503;
   return reply({error:{code}},next,next===429?{'Retry-After':'900'}:next===405?{Allow:'POST, PUT'}:undefined);
  }finally{audit({event:'application_request',requestId,operation,status,durationMs:Date.now()-started,code});}
 };
}
