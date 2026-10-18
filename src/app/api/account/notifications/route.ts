import {handleProductionNotificationInboxRequest} from '@/lib/production-notification-inbox-runtime';
export const runtime='nodejs';export const dynamic='force-dynamic';
export const POST=handleProductionNotificationInboxRequest;
export const PUT=handleProductionNotificationInboxRequest;
