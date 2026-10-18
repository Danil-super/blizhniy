import {handleProductionServiceModerationRequest} from '@/lib/production-service-moderation-runtime';
export const runtime='nodejs';export const dynamic='force-dynamic';
export const POST=(request:Request)=>handleProductionServiceModerationRequest(request,'owner');
export const PUT=POST;
