import type {accountTestPayment} from './client-account-test-payment';
import type {ListingCheckoutInput} from './listing-checkout-contract';
export type ListingCheckoutAttempt={input:ListingCheckoutInput|null;uncertain:boolean;completedId?:string};
type Transport=Pick<typeof accountTestPayment,'preview'|'prepare'>;
/** Called only by an explicit payment click. A lost reply requires readback, not a second order. */
export async function startListingPayment(transport:Transport,owner:string,id:string,revision:string,attempt:ListingCheckoutAttempt,options:{signal?:AbortSignal}){
 options.signal?.throwIfAborted();
 if(attempt.completedId)return attempt.completedId;
 if(attempt.uncertain)throw Error('Сначала проверьте сохранённый заказ.');
 const quote=await transport.preview(owner,id,revision,options);
 options.signal?.throwIfAborted();
 if(quote.activePayment){attempt.completedId=quote.activePayment.id;return quote.activePayment.id;}
 if(attempt.input&&(attempt.input.listingId!==id||attempt.input.expectedRevision!==revision))throw Error('Объявление изменилось. Проверьте сохранённую версию.');
 // Reached only after a fresh explicit click (and, after an unknown outcome,
 // explicit readback). Keep the original key even when the offer has changed.
 attempt.input={listingId:id,expectedRevision:revision,creationKey:attempt.input?.creationKey??crypto.randomUUID(),expectedTariffId:quote.tariff.id,expectedAmount:quote.tariff.amount,expectedDurationDays:quote.tariff.durationDays};
 attempt.uncertain=true;
 const order=await transport.prepare(owner,attempt.input,options);
 attempt.uncertain=false;attempt.completedId=order.id;
 return order.id;
}
