import {handleProductionPublicListingPhoto} from '@/lib/production-public-listing-runtime';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request,context:{params:Promise<{listingId:string;fileId:string}>}){
 const {listingId,fileId}=await context.params;return handleProductionPublicListingPhoto(request,listingId,fileId);
}
