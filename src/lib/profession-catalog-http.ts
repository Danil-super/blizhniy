import {randomUUID} from 'node:crypto';
import {authJson} from './auth-http';
import {parseProfessionCatalog} from './profession-catalog-contract.ts';
import type {PostgresProfessionRepository} from './postgres-professions';
export function createProfessionCatalogHandler(config:{origin:string},getRepository:()=>Pick<PostgresProfessionRepository,'listActive'>|Promise<Pick<PostgresProfessionRepository,'listActive'>>){
 return async(request:Request):Promise<Response>=>{
  if(request.method!=='GET')return authJson({error:{code:'METHOD_NOT_ALLOWED'}},405,{Allow:'GET'});
  if(request.headers.get('host')!==new URL(config.origin).host)return authJson({error:{code:'FORBIDDEN_TARGET'}},403);
  if(new URL(request.url).search||request.body||request.headers.has('transfer-encoding')||
   request.headers.has('content-length')&&!/^0$/.test(request.headers.get('content-length')!))return authJson({error:{code:'INVALID_REQUEST'}},400);
  try{return authJson({items:parseProfessionCatalog(await(await getRepository()).listActive())},200);}
  catch{return authJson({error:{code:'CATALOG_UNAVAILABLE'}},503,{'X-Request-ID':randomUUID()});}
 };
}
