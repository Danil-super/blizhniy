import 'server-only';
import {readProductionAuthConfig} from './production-auth-config';
import {getProductionAccountDatabase} from './production-auth-runtime';
import {PostgresPublicWorkStore} from './postgres-public-work';
import {authJson} from './auth-http';
import {getProductionMediaFileReader} from './production-media-runtime';
import {createProductionPublicWorkPhotoHandler} from './production-public-work-photo-http';
import {readPostmoderationEnabled} from './listing-workflow-config';
import {hasPublicationRestrictionSchema} from './publication-restriction-eligibility';
import {hasLocationWithdrawalSchema} from './publication-location-withdrawal';

/** The same verified limited pool; no owner credentials or old service fallback. */
export async function getProductionPublicWorkStore(){
 const config=readProductionAuthConfig();if(!config)throw Error('Public work unavailable');
 const {db}=await getProductionAccountDatabase(config);return new PostgresPublicWorkStore(db,{vacancyPostmoderation:readPostmoderationEnabled(),
  enforcePublicationRestrictions:await hasPublicationRestrictionSchema(db),enforceLocationWithdrawals:await hasLocationWithdrawalSchema(db)});
}
export async function handleProductionPublicWorkPhoto(request:Request,publicationId:unknown,fileId:unknown){
 try{
  const config=readProductionAuthConfig();if(!config)return authJson({error:{code:'NOT_FOUND'}},404);
  return await createProductionPublicWorkPhotoHandler(config,async()=>{
   const {db}=await getProductionAccountDatabase(config);
   return{store:new PostgresPublicWorkStore(db,{vacancyPostmoderation:readPostmoderationEnabled(),enforcePublicationRestrictions:await hasPublicationRestrictionSchema(db)}),files:{read:async record=>(await getProductionMediaFileReader(config)).read(record)}};
  })(request,publicationId,fileId);
 }catch{return authJson({error:{code:'MEDIA_UNAVAILABLE'}},503);}
}
