import {listApplications,listMockPayments} from "@/lib/mock-store";
import {shouldShowFallbackContent} from "@/lib/runtime-mode";
import type {CabinetResponseItem} from "./CabinetClient";

export function paymentRows() {
  if (!shouldShowFallbackContent()) {
    return [];
  }

  return listMockPayments().map((payment) => ({
    id: payment.id,
    href: `/oplata/${payment.id}`,
    editHref: "/cabinet/oplata",
    subject: payment.targetTitle,
    amount: `${payment.amount} ₽`,
    method: payment.provider === "mock" ? "Оплата" : payment.provider,
    status: payment.status,
  }));
}

export function responseRows(): CabinetResponseItem[] {
  if (!shouldShowFallbackContent()) {
    return [];
  }

  return listApplications().map((application) => ({
    href: "/rabota/vakansii",
    id: application.id,
    paymentHref: `/oplata/${application.paymentId}`,
    paymentId: application.paymentId,
    specialistName: application.specialistName,
    status: application.status,
    vacancyTitle: application.vacancyTitle,
  }));
}
