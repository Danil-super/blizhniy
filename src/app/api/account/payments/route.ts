import {handlePaymentHistoryRequest} from '@/lib/payment-history-runtime';
export const runtime='nodejs';export const dynamic='force-dynamic';
export const POST=handlePaymentHistoryRequest;
export const GET=handlePaymentHistoryRequest;
export const PUT=handlePaymentHistoryRequest;
export const PATCH=handlePaymentHistoryRequest;
export const DELETE=handlePaymentHistoryRequest;
