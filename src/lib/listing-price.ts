const currencyFormatter = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
  useGrouping: true,
});

export const maxListingPriceDigits = 9;

export function extractListingPriceDigits(value?: string) {
  return (value?.replace(/\D/g, "") ?? "").slice(0, maxListingPriceDigits);
}

export function formatListingPrice(value: number | string) {
  const digits = typeof value === "number" ? String(Math.trunc(value)) : extractListingPriceDigits(value);
  const amount = Number(digits);

  if (!digits || !Number.isFinite(amount)) {
    return "";
  }

  return `${currencyFormatter.format(amount)} ₽`;
}

export function normalizeListingPrice(value?: string, fallback = "по договоренности") {
  const formattedPrice = formatListingPrice(value ?? "");

  return formattedPrice || fallback;
}
