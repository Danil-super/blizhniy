"use client";
import {createAccountTestPaymentClient} from './client-account-test-payment';
import {createListingPaymentClient} from './client-listing-payment';
const transport:typeof fetch=(_input,init)=>fetch('/api/account/specialist-checkout',init);
export const specialistPayment=createAccountTestPaymentClient(transport);
export const specialistPaymentStatus=createListingPaymentClient((_url,init)=>fetch('/api/account/payments',init),'specialistOrder');
