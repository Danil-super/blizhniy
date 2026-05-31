const russianMonths = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

const russianMonthIndexes = new Map(russianMonths.map((month, index) => [month, index]));

function padTimePart(value: number) {
  return value.toString().padStart(2, "0");
}

function formatRussianDate(day: number, month: number, year: number, hour: number, minute: number) {
  return `${day} ${russianMonths[month]} ${year}, ${padTimePart(hour)}:${padTimePart(minute)}`;
}

function parseFallbackTime(fallbackTime: string) {
  const match = fallbackTime.match(/^(\d{1,2}):(\d{2})$/);

  if (!match) {
    return { hour: 12, minute: 0 };
  }

  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
  };
}

export function formatPublicationDateTime(value?: string, fallbackTime = "12:00") {
  const normalized = value?.trim();

  if (!normalized) {
    return "";
  }

  const fallback = parseFallbackTime(fallbackTime);
  const isoDateOnly = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (isoDateOnly) {
    return formatRussianDate(Number(isoDateOnly[3]), Number(isoDateOnly[2]) - 1, Number(isoDateOnly[1]), fallback.hour, fallback.minute);
  }

  const russianDate = normalized.match(/^(\d{1,2})\s+([а-яё]+)\s+(\d{4})(?:\s*(?:,|в)?\s*(\d{1,2}):(\d{2}))?$/i);

  if (russianDate) {
    const monthIndex = russianMonthIndexes.get(russianDate[2].toLowerCase());

    if (monthIndex !== undefined) {
      return formatRussianDate(
        Number(russianDate[1]),
        monthIndex,
        Number(russianDate[3]),
        russianDate[4] ? Number(russianDate[4]) : fallback.hour,
        russianDate[5] ? Number(russianDate[5]) : fallback.minute,
      );
    }
  }

  const parsed = new Date(normalized);

  if (!Number.isNaN(parsed.getTime())) {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      month: "long",
      timeZone: "Europe/Moscow",
      year: "numeric",
    }).format(parsed);
  }

  return normalized;
}

export function publicationTimestamp(value?: string) {
  const normalized = value?.trim();

  if (!normalized) {
    return 0;
  }

  const isoDateOnly = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (isoDateOnly) {
    return Date.UTC(Number(isoDateOnly[1]), Number(isoDateOnly[2]) - 1, Number(isoDateOnly[3]), 9);
  }

  const russianDate = normalized.match(/^(\d{1,2})\s+([а-яё]+)\s+(\d{4})(?:\s*(?:,|в)?\s*(\d{1,2}):(\d{2}))?$/i);

  if (russianDate) {
    const monthIndex = russianMonthIndexes.get(russianDate[2].toLowerCase());

    if (monthIndex !== undefined) {
      return Date.UTC(
        Number(russianDate[3]),
        monthIndex,
        Number(russianDate[1]),
        russianDate[4] ? Number(russianDate[4]) - 3 : 9,
        russianDate[5] ? Number(russianDate[5]) : 0,
      );
    }
  }

  const parsed = new Date(normalized).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}
