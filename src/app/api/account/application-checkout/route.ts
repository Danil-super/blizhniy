import {handleApplicationCheckoutRequest} from '@/lib/application-checkout-runtime';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const POST=handleApplicationCheckoutRequest;
export const PUT=handleApplicationCheckoutRequest;
