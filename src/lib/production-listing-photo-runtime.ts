import {randomUUID} from "node:crypto";
import {authJson} from "./auth-http";
import {readProductionAuthConfig} from "./production-auth-config";
import {getProductionAccountDatabase} from "./production-auth-runtime";
import {createProductionListingPhotoHandler} from "./production-listing-photo-http";
import {PostgresListingPhotoStore} from "./postgres-listing-photos";

export async function handleProductionListingPhotoRequest(request:Request):Promise<Response>{
  try{
    const config=readProductionAuthConfig();if(!config)return authJson({error:{code:"NOT_FOUND"}},404);
    return await createProductionListingPhotoHandler({origin:config.origin},async()=>{
      const {db,limiter}=await getProductionAccountDatabase(config);
      // Missing schema/permissions fails closed. HTTP never provisions or widens grants.
      await db.query("select id,author_id,revision,status from app.listings limit 0");
      await db.query("select listing_id,media_id,position from app.listing_photos limit 0");
      await db.query("select id,owner_id,state,mime_type,width,height,size from app.media_objects limit 0");
      return{store:new PostgresListingPhotoStore(db),limiter};
    })(request);
  }catch{
    const requestId=randomUUID();console.warn(JSON.stringify({event:"listing_photo_configuration_failed",requestId,code:"PHOTOS_UNAVAILABLE"}));
    return authJson({error:{code:"PHOTOS_UNAVAILABLE"}},503,{"X-Request-ID":requestId});
  }
}
