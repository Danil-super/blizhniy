"use client";
import {createAccountTestPaymentClient} from './client-account-test-payment';
import {createListingPaymentClient} from './client-listing-payment';
/** Served only by the isolated local proxy; no production route or provider credentials. */
const transport:typeof fetch=(_input,init)=>fetch('/api/account/vacancy-checkout',init);
export const vacancyPayment=createAccountTestPaymentClient(transport);
export const vacancyPaymentStatus=createListingPaymentClient(transport);
const workRequestTransport:typeof fetch=(_input,init)=>fetch('/api/account/work-request-checkout',init);
export const workRequestPayment=createAccountTestPaymentClient(workRequestTransport);
export const workRequestPaymentStatus=createListingPaymentClient(workRequestTransport);
