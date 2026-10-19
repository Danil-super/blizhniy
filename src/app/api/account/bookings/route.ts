import {handleProductionBookingRequest} from '@/lib/production-booking-runtime';
export const runtime='nodejs';export const dynamic='force-dynamic';
export const POST=handleProductionBookingRequest;
export const PUT=handleProductionBookingRequest;
