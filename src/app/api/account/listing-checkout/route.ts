import {handleListingCheckoutRequest} from '@/lib/listing-checkout-runtime';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const POST=handleListingCheckoutRequest;
export const PUT=handleListingCheckoutRequest;
export const GET=handleListingCheckoutRequest;
export const PATCH=handleListingCheckoutRequest;
export const DELETE=handleListingCheckoutRequest;
