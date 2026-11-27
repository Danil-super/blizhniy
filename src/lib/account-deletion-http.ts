import {randomUUID} from 'node:crypto';
import {AuthRequestError,authJson,readAuthJson} from './auth-http';
import type {AuthRateLimiter} from './auth-http';
import {readAccountSessionToken} from './account-cookie';
import {createDataSubjectCookie,readDataSubjectToken} from './data-subject-cookie';
import {readBrowserProof,issueBrowserProof,clearBrowserProofCookie} from './account-browser-proof';
import {getTrustedProxyIp} from './trusted-proxy-ip';
import {normalizeMailAddress} from './timeweb-mail';
import {AppSessionAccessError} from './app-session-transaction';
import {DeletionInputError,DeletionAccessError,DeletionConflictError,deletionAccess,deletionObject,deletionId,deletionRevision,deletionDecision} from './account-deletion-contract';
import type {ProductionAuthConfig} from './production-auth-config';
import type {IdentityStore} from './identity';
import type {PostgresAccountDeletionStore} from './postgres-account-deletion';

type Runtime={store:Pick<PostgresAccountDeletionStore,'session'|'read'|'request'|'list'|'begin'|'resolve'>;
 identity:Pick<IdentityStore,'loginForDataSubject'|'revokeSession'>;
 limiter:Pick<AuthRateLimiter,'allowProduction'|'allowProductionAttempt'|'allowProductionCaptchaCheck'|'allowProductionVerifiedCredential'>;
 verifyCaptcha:(token:unknown,ip:string)=>Promise<boolean>};
type Event={event:'deletion_request';requestId:string;operation:string;status:number;code?:string};
const ownerKeys={login:['email','password','captchaToken'],logout:[],session:['access'],read:['access','expectedOwnerId'],request:['access','expectedOwnerId']};
const adminKeys={list:['expectedAdminId','page'],begin:['expectedAdminId','id','revision'],resolve:['expectedAdminId','id','revision','decision']};

export function createAccountDeletionHandler(config:ProductionAuthConfig,getRuntime:()=>Runtime|Promise<Runtime>,
 audit:(event:Event)=>void=event=>console.info(JSON.stringify(event))){
 if(typeof window!=='undefined')throw new Error('Deletion boundary is server-only');
 return async(request:Request,operation:string,admin=false):Promise<Response>=>{
  const requestId=randomUUID();let status=503,code:string|undefined;
  let proofCookie:string|undefined,proofExpiry:number|undefined;
  const respond=(data:unknown,nextStatus:number,headers?:Record<string,string>)=>{
   status=nextStatus;const response=authJson(data,status,{'X-Request-ID':requestId,...headers});
   if(operation==='login'&&config.rememberedCaptcha&&(status===429||code==='CAPTCHA_REQUIRED')){
    proofCookie=clearBrowserProofCookie();proofExpiry=0;
   }
   if(proofCookie)response.headers.append('Set-Cookie',proofCookie);
   if(proofExpiry!==undefined)response.headers.set('X-Blizhniy-Human-Proof',String(proofExpiry));
   return response;
  };
  const keys:Record<string,string[]>=admin?adminKeys:ownerKeys;
  try{
   if(!Object.hasOwn(keys,operation))throw new AuthRequestError(404,'NOT_FOUND');
   const body=deletionObject(await readAuthJson(request,config),keys[operation]);
   let email:string|null=null;
   if(operation==='login'){
    email=typeof body.email==='string'&&body.email.length<=254&&body.email.isWellFormed()?normalizeMailAddress(body.email.trim().toLowerCase()):null;
    if(!email||typeof body.password!=='string'||body.password.length>256||typeof body.captchaToken!=='string'||body.captchaToken.length>2048||
     (!config.rememberedCaptcha&&!body.captchaToken.trim()))throw new DeletionInputError();
   }
   if(admin){
    deletionId(body.expectedAdminId);
    if(operation==='list'){if(!Number.isInteger(body.page)||Number(body.page)<0||Number(body.page)>1000)throw new DeletionInputError();}
    else{deletionId(body.id);deletionRevision(body.revision);if(operation==='resolve')deletionDecision(body.decision);}
   }else if(operation!=='login'&&operation!=='logout'){
    deletionAccess(body.access);if(operation!=='session')deletionId(body.expectedOwnerId);
   }
   const ip=getTrustedProxyIp(request.headers);if(!ip)throw new AuthRequestError(403,'UNTRUSTED_INGRESS');
   const token=admin||body.access==='account'?readAccountSessionToken(request):readDataSubjectToken(request);
   if(operation!=='login'&&!token){
    if(operation==='logout')return respond({status:'logged_out'},200,{'Set-Cookie':createDataSubjectCookie('',0)});
    throw new AuthRequestError(401,'UNAUTHENTICATED');
   }
   const state=await getRuntime();
   if(operation==='login'){
    // Share normal login budgets. The alternate rights route is not a password-throttle bypass.
    const allowed=config.rememberedCaptcha?await state.limiter.allowProductionAttempt('login',ip):
     await state.limiter.allowProduction('credential',ip,email!);
    if(!allowed)throw new AuthRequestError(429,'RATE_LIMITED');
    proofExpiry=config.rememberedCaptcha?readBrowserProof(request.headers,config.rateSecret,ip)||undefined:undefined;
    if(!proofExpiry){
     if(!body.captchaToken)throw new AuthRequestError(403,'CAPTCHA_REQUIRED');
     if(config.rememberedCaptcha&&!await state.limiter.allowProductionCaptchaCheck())throw new AuthRequestError(429,'RATE_LIMITED');
     if(await state.verifyCaptcha(body.captchaToken,ip)!==true)throw new AuthRequestError(403,'CAPTCHA_REQUIRED');
     if(config.rememberedCaptcha){const issued=issueBrowserProof(config.rateSecret,ip,request.headers.get('user-agent')??'');proofCookie=issued.cookie;proofExpiry=issued.expiresAt;}
    }
    if(config.rememberedCaptcha&&!await state.limiter.allowProductionVerifiedCredential('login',email!))throw new AuthRequestError(429,'RATE_LIMITED');
    const issued=await state.identity.loginForDataSubject(email!,body.password as string);
    if(!issued)throw new AuthRequestError(401,'INVALID_CREDENTIALS');
    const maxAge=Math.min(3600,Math.floor((issued.expiresAt.getTime()-Date.now())/1000));
    if(issued.scope!=='data-subject'||maxAge<=0)throw new Error('Invalid restricted session');
    return respond({user:{id:issued.user.id,email:issued.user.email,isBlocked:issued.user.isBlocked}},200,
     {'Set-Cookie':createDataSubjectCookie(issued.token,maxAge)});
   }
   if(!await state.limiter.allowProduction('session',ip))throw new AuthRequestError(429,'RATE_LIMITED');
   if(operation==='logout'){
    await state.identity.revokeSession(token!);return respond({status:'logged_out'},200,{'Set-Cookie':createDataSubjectCookie('',0)});
   }
   if(!admin){
    if(operation==='session')return respond({user:await state.store.session(token!)},200);
    const result=operation==='request'?await state.store.request(token!,body.expectedOwnerId as string):await state.store.read(token!,body.expectedOwnerId as string);
    return respond(result,200);
   }
   const owner=body.expectedAdminId as string,id=body.id as string,revision=body.revision as string;
   const result=operation==='list'?await state.store.list(token!,owner,body.page as number):operation==='begin'?
    await state.store.begin(token!,owner,id,revision):await state.store.resolve(token!,owner,id,revision,body.decision);
   return respond(result,200);
  }catch(error){
   if(error instanceof DeletionInputError)error=new AuthRequestError(422,'INVALID_INPUT');
   if(error instanceof DeletionAccessError||error instanceof AppSessionAccessError)error=new AuthRequestError(401,'UNAUTHENTICATED');
   if(error instanceof DeletionConflictError)error=new AuthRequestError(409,'REQUEST_CHANGED');
   if(error instanceof AuthRequestError){code=error.code;return respond({error:{code}},error.status,error.status===429?{'Retry-After':'900'}:undefined);}
   code='DELETION_UNAVAILABLE';return respond({error:{code}},503);
  }finally{audit({event:'deletion_request',requestId,operation:Object.hasOwn(keys,operation)?operation:'unknown',status,code});}
 };
}
