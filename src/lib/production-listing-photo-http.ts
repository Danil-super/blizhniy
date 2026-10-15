import {randomUUID} from "node:crypto";
import {AuthRequestError,authJson,readAuthJson,type AuthRateLimiter} from "./auth-http";
import {readAccountSessionToken} from "./account-cookie";
import {getTrustedProxyIp} from "./trusted-proxy-ip";
import {AppSessionAccessError} from "./app-session-transaction";
import {ListingDraftInputError,parseListingDraftId,parseListingDraftRevision} from "./listing-draft-contract";
import {parseListingPhotoIds} from "./listing-photo-contract";
import {ListingDraftAccessError,ListingDraftConflictError} from "./postgres-listing-drafts";
import type {PostgresListingPhotoStore} from "./postgres-listing-photos";
type Runtime={store:Pick<PostgresListingPhotoStore,"read"|"replace">;limiter:Pick<AuthRateLimiter,"allowProduction">};
type Audit={event:"listing_photo_request";requestId:string;operation:"read"|"replace"|"unknown";status:number;durationMs:number;code?:string};

/** Private associations only. No uploaded bytes, caller metadata, paths, serving or file deletion. */
export function createProductionListingPhotoHandler(config:{origin:string},getRuntime:()=>Runtime|Promise<Runtime>,
  audit:(event:Audit)=>void=event=>console.info(JSON.stringify(event))){
  if(typeof window!=="undefined")throw new Error("Listing photo authorization is server-only");
  return async(request:Request):Promise<Response>=>{
    const requestId=randomUUID(),start=Date.now();let status=503,code:string|undefined;
    const respond=(body:unknown,nextStatus:number,headers?:Record<string,string>)=>{status=nextStatus;return authJson(body,status,{"X-Request-ID":requestId,...headers});};
    try{
      if(!["POST","PUT"].includes(request.method)){code="METHOD_NOT_ALLOWED";return respond({error:{code}},405,{Allow:"POST, PUT"});}
      const writing=request.method==="PUT",raw=await readAuthJson(request,config,2000,writing?"PUT":"POST",writing?65536:4096);
      if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new AuthRequestError(422,"INVALID_INPUT");
      const body=raw as Record<string,unknown>,keys=writing?["expectedOwnerId","listingId","expectedRevision","photoIds"]:["expectedOwnerId","listingId"];
      if(Object.keys(body).length!==keys.length||keys.some(key=>!Object.hasOwn(body,key)))throw new AuthRequestError(422,"INVALID_INPUT");
      const owner=parseListingDraftId(body.expectedOwnerId),id=parseListingDraftId(body.listingId);
      const revision=writing?parseListingDraftRevision(body.expectedRevision):null,photoIds=writing?parseListingPhotoIds(body.photoIds):null;
      const ip=getTrustedProxyIp(request.headers);if(!ip)throw new AuthRequestError(403,"UNTRUSTED_INGRESS");
      const token=readAccountSessionToken(request);if(!token)throw new AuthRequestError(401,"UNAUTHENTICATED");
      const runtime=await getRuntime();
      if(!await runtime.limiter.allowProduction("session",ip)){code="RATE_LIMITED";return respond({error:{code}},429,{"Retry-After":"900"});}
      return respond(writing?await runtime.store.replace(token,owner,id,revision,photoIds):await runtime.store.read(token,owner,id),200);
    }catch(error){
      if(error instanceof AppSessionAccessError)error=new AuthRequestError(401,"UNAUTHENTICATED");
      if(error instanceof ListingDraftAccessError)error=new AuthRequestError(404,"DRAFT_NOT_FOUND");
      if(error instanceof ListingDraftConflictError)error=new AuthRequestError(409,"DRAFT_CHANGED");
      if(error instanceof ListingDraftInputError)error=new AuthRequestError(422,"INVALID_INPUT");
      code=error instanceof AuthRequestError?error.code:"PHOTOS_UNAVAILABLE";
      return respond({error:{code}},error instanceof AuthRequestError?error.status:503);
    }finally{
      audit({event:"listing_photo_request",requestId,operation:request.method==="PUT"?"replace":request.method==="POST"?"read":"unknown",status,durationMs:Date.now()-start,code});
    }
  };
}
