import 'server-only';import {readProductionAuthConfig} from './production-auth-config';import {getProductionAccountDatabase} from './production-auth-runtime';
import {PostgresPublicServiceStore} from './postgres-public-service';import {authJson} from './auth-http';import {getProductionMediaFileReader} from './production-media-runtime';
import {createProductionPublicWorkPhotoHandler} from './production-public-work-photo-http';
export async function getProductionPublicServiceStore(){
 const config=readProductionAuthConfig();if(!config)throw Error('Public services unavailable');const {db}=await getProductionAccountDatabase(config);return new PostgresPublicServiceStore(db);
}
export async function handleProductionPublicServicePhoto(request:Request,publicationId:unknown,fileId:unknown){
 try{
  const config=readProductionAuthConfig();if(!config)return authJson({error:{code:'NOT_FOUND'}},404);
  // Reuse the exact public-photo policy: authorize SQL before FS, recheck after FS,
  // shared four-read admission, bounded WebP, no-store and no private metadata.
  return await createProductionPublicWorkPhotoHandler(config,async()=>{
   const {db}=await getProductionAccountDatabase(config);return{store:new PostgresPublicServiceStore(db),files:{read:async record=>(await getProductionMediaFileReader(config)).read(record)}};
  },event=>console.info(JSON.stringify({...event,event:'public_service_photo'})))(request,publicationId,fileId);
 }catch{return authJson({error:{code:'MEDIA_UNAVAILABLE'}},503);}
}
