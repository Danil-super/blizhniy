export class PaymentPublicationError extends Error{
 constructor(){super('Paid publication requires reconciliation');this.name='PaymentPublicationError';}
}
export type PaymentPublicationPeriod={publishedAt:string;expiresAt:string};
/** Fixed elapsed days from the original UTC capture; never from a worker's arrival time.
 * PostgreSQL has microseconds, so round the start UP and the end DOWN, never extending service.
 */
export function paymentPublicationPeriod(capturedAt:unknown,durationDays:unknown):PaymentPublicationPeriod{
 const fail=():never=>{throw new PaymentPublicationError();};
 if(typeof capturedAt!=='string'||typeof durationDays!=='number'||!Number.isInteger(durationDays)||durationDays<1||durationDays>3650)return fail();
 const parts=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(capturedAt);
 if(!parts)return fail();
 const seconds=Date.parse(`${parts[1]}Z`);
 if(!Number.isFinite(seconds)||new Date(seconds).toISOString()!==`${parts[1]}.000Z`)return fail();
 const nanos=Number((parts[2]??'').padEnd(9,'0'));
 const format=(base:number,micros:number)=>{
  const date=new Date(base+Math.floor(micros/1000000)*1000).toISOString();
  if(date.length!==24)return fail();
  return `${date.slice(0,19)}.${String(micros%1000000).padStart(6,'0')}Z`;
 };
 return {publishedAt:format(seconds,Math.ceil(nanos/1000)),expiresAt:format(seconds+durationDays*86400000,Math.floor(nanos/1000))};
}
