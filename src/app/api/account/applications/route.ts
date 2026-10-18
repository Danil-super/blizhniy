import {handleProductionApplicationRequest} from '@/lib/production-application-runtime';
export const runtime='nodejs';export const dynamic='force-dynamic';
export const POST=handleProductionApplicationRequest;
export const PUT=handleProductionApplicationRequest;
