import {handleProductionDeletion} from '@/lib/production-deletion-runtime';
import {authJson} from '@/lib/auth-http';
export const runtime='nodejs';
export async function POST(request:Request,context:{params:Promise<{action:string}>}){
 return handleProductionDeletion(request,(await context.params).action,true);
}
export function GET(){return authJson({error:{code:'METHOD_NOT_ALLOWED'}},405);}
