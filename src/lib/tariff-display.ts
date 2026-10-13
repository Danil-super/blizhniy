import type { Tariff } from "./types";

/** Display only: checkout must still validate the current server-side tariff. */
export function formatTariffPrice(tariff?: Tariff): string {
  return tariff?.active ? `${tariff.price} ₽` : "временно недоступен";
}

export function formatTariffDuration(tariff?: Tariff): string {
  if (!tariff?.active) return "временно недоступен";
  return tariff.durationDays === null ? "не указан" : `${tariff.durationDays} дн.`;
}

export function formatListingPublicationTerm(tariff?: Tariff): string {
  if (!tariff?.active) return "Публикация временно недоступна: тариф не настроен или выключен.";
  return tariff.durationDays === null
    ? "Срок размещения в тарифе не указан. Уточните его до оплаты."
    : `После оплаты объявление будет опубликовано на ${tariff.durationDays} дней.`;
}
