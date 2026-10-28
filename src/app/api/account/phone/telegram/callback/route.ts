import {handleTelegramPhoneRequest} from '@/lib/telegram-phone-runtime';
export const runtime='nodejs';
export const GET=(request:Request)=>handleTelegramPhoneRequest(request,'callback');
