import {handleProductionPublicWorkPhoto} from '@/lib/production-public-work-runtime';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request,context:{params:Promise<{publicationId:string;fileId:string}>}){
 const {publicationId,fileId}=await context.params;return handleProductionPublicWorkPhoto(request,publicationId,fileId);
}
