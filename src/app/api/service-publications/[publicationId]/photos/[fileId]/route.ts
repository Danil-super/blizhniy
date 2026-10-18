import {handleProductionPublicServicePhoto} from '@/lib/production-public-service-runtime';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request,context:{params:Promise<{publicationId:string;fileId:string}>}){
 const {publicationId,fileId}=await context.params;return handleProductionPublicServicePhoto(request,publicationId,fileId);
}
