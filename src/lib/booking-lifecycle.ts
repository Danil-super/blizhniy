import {validPlainText} from './cabinet-field-validation.ts';
export class BookingLifecycleInputError extends Error {
 constructor(){super('Invalid booking cancellation');this.name='BookingLifecycleInputError';}
}
export type BookingLifecycle={startsAt:string;expiresAt:string;canCancel:boolean;cancelledBy:'guest'|'host'|null;cancellationReason:string|null};
export function parseBookingCancellation(value:unknown):string {
 if(typeof value!=='string'||value.length>500||!validPlainText(value))throw new BookingLifecycleInputError();
 const reason=value.trim();if(!reason.length)throw new BookingLifecycleInputError();return reason;
}
/** Activation is deliberately restricted to the explicitly owned local stand. */
export function readBookingLifecycleEnabled(env:NodeJS.ProcessEnv=process.env):boolean {
 if(typeof window!=='undefined')throw Error('Booking configuration is server-only');
 if(env.BLIZHNIY_BOOKING_LIFECYCLE===undefined)return false;
 if(env.BLIZHNIY_BOOKING_LIFECYCLE!=='local-v1'||env.BLIZHNIY_LOCAL_PRIMARY!=='enabled')throw Error('Invalid booking lifecycle activation');
 const origin=env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN;
 if(!origin||!/^https:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}$/.test(origin)||Number(new URL(origin).port)>65535)throw Error('Invalid local booking origin');
 return true;
}
