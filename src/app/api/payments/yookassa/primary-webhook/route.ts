import {handlePrimaryPaymentWebhook} from '@/lib/primary-payment-webhook-runtime';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const POST=handlePrimaryPaymentWebhook;
