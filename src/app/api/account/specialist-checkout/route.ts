import {handleSpecialistCheckoutRequest} from '@/lib/listing-checkout-runtime';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const POST=handleSpecialistCheckoutRequest;
export const PUT=POST;
export const GET=POST;
export const PATCH=POST;
export const DELETE=POST;
