import {handleWorkCheckoutRequest} from '@/lib/listing-checkout-runtime';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const POST=(request:Request)=>handleWorkCheckoutRequest(request,'workRequest');
export const PUT=POST;
export const GET=POST;
export const PATCH=POST;
export const DELETE=POST;
