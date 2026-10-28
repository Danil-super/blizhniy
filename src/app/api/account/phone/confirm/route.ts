import {handleTelegramPhoneRequest} from '@/lib/telegram-phone-runtime';
export const runtime='nodejs';
export const POST=(request:Request)=>handleTelegramPhoneRequest(request,'confirm');
