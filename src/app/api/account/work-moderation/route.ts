import {authJson} from '@/lib/auth-http';
import {handleProductionWorkModerationRequest} from '@/lib/production-work-moderation-runtime';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const POST=(request:Request)=>process.env.BLIZHNIY_AUTH_MODE==='postgres'?handleProductionWorkModerationRequest(request,'owner'):Promise.resolve(authJson({error:{code:'NOT_FOUND'}},404));
export const PUT=POST;
export const GET=()=>authJson({error:{code:'METHOD_NOT_ALLOWED'}},405,{Allow:'POST, PUT'});
