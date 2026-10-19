import 'server-only';import {readProductionAuthConfig} from './production-auth-config';import {getProductionAccountDatabase} from './production-auth-runtime';
import {PostgresPublicListingStore} from './postgres-public-listings';import {authJson} from './auth-http';import {getProductionMediaFileReader} from './production-media-runtime';
import {createProductionPublicWorkPhotoHandler} from './production-public-work-photo-http';

/** Same restricted pool and no owner credential, legacy request or successful-empty fallback. */
export async function getProductionPublicListingStore(){
 const config=readProductionAuthConfig();if(!config)throw Error('Public listings unavailable');
 return new PostgresPublicListingStore((await getProductionAccountDatabase(config)).db);
}
export async function handleProductionPublicListingPhoto(request:Request,listingId:unknown,fileId:unknown){
 try{
  const config=readProductionAuthConfig();if(!config)return authJson({error:{code:'NOT_FOUND'}},404);
  // Work, service and ordinary listing photos share the same proven public-file policy.
  return await createProductionPublicWorkPhotoHandler(config,async()=>{
   const {db}=await getProductionAccountDatabase(config);return{store:new PostgresPublicListingStore(db),files:{read:async record=>(await getProductionMediaFileReader(config)).read(record)}};
  },event=>console.info(JSON.stringify({...event,event:'public_listing_photo'})))(request,listingId,fileId);
 }catch{return authJson({error:{code:'MEDIA_UNAVAILABLE'}},503);}
}
