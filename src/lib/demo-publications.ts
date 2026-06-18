import type { BookingDetails, ListingKind } from "@/lib/types";

export type DemoPublicationType = "listing" | "vacancy" | "workRequest" | "specialist" | "fairApplication";

export type DemoPublicationHistoryType = "created" | "updated" | "status_changed" | "sold" | "unpublished" | "restored";

export type DemoPublicationHistoryEvent = {
  id: string;
  type: DemoPublicationHistoryType;
  title: string;
  description?: string;
  status?: string;
  at: string;
};

export type DemoPublication = {
  id: string;
  type: DemoPublicationType;
  ownerKey?: string;
  ownerName?: string;
  title: string;
  subtitle: string;
  city: string;
  price?: string;
  description?: string;
  images?: string[];
  videos?: string[];
  lat?: number;
  lng?: number;
  address?: string;
  hasMapPoint?: boolean;
  showExactAddress?: boolean;
  phone?: string;
  messengerUrl?: string;
  email?: string;
  profession?: string;
  employerType?: string;
  inn?: string;
  ogrn?: string;
  ogrnip?: string;
  contactPerson?: string;
  website?: string;
  workFormat?: string;
  schedule?: string;
  requirements?: string;
  responsibilities?: string;
  conditions?: string;
  placementRightConfirmed?: boolean;
  listingKind?: ListingKind;
  categorySlug?: string;
  subcategorySlug?: string;
  booking?: BookingDetails;
  status: string;
  soldReason?: "platform" | "elsewhere" | "not_actual";
  soldAt?: string;
  expiresAt?: string;
  createdAt: string;
  history?: DemoPublicationHistoryEvent[];
};

export const demoPublicationsStorageKey = "blizhniy-demo-publications";
export const demoPublicationsUpdatedEvent = "blizhniy-demo-publications-updated";
export const soldPublicationStatus = "Продано";
export const unpublishedVacancyStatus = "Снята с публикации";

export const demoPublicationLabels: Record<DemoPublicationType, string> = {
  fairApplication: "Заявка на ярмарку",
  listing: "Объявление",
  specialist: "Анкета специалиста",
  vacancy: "Вакансия",
  workRequest: "Заказ",
};

const historyTypeTitles: Record<DemoPublicationHistoryType, string> = {
  created: "Создано",
  restored: "Возвращено в публикацию",
  sold: "Продано / снято",
  status_changed: "Статус изменен",
  unpublished: "Снято с публикации",
  updated: "Изменено",
};

function toSafeIsoDate(value?: string) {
  if (!value) {
    return new Date().toISOString();
  }

  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : new Date().toISOString();
}

function createHistoryEventId(type: DemoPublicationHistoryType, at: string) {
  return `${type}-${new Date(at).getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeStatus(status?: string) {
  return status?.trim().toLowerCase() ?? "";
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export function addPublicationDaysIsoDate(days: number) {
  const date = new Date();

  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function isDemoPublicationExpired(item: Pick<DemoPublication, "expiresAt" | "type">) {
  return item.type === "listing" && Boolean(item.expiresAt && item.expiresAt < todayIsoDate());
}

function isUnpublishedStatus(status: string) {
  return normalizeStatus(status) === normalizeStatus(unpublishedVacancyStatus) || normalizeStatus(status) === "archived";
}

function isValidHistoryEvent(value: unknown): value is DemoPublicationHistoryEvent {
  return Boolean(value && typeof value === "object" && "id" in value && "type" in value && "title" in value && "at" in value);
}

export function createPublicationHistoryEvent(
  type: DemoPublicationHistoryType,
  input: {
    at?: string;
    description?: string;
    status?: string;
    title?: string;
  } = {},
): DemoPublicationHistoryEvent {
  const at = toSafeIsoDate(input.at);

  return {
    id: createHistoryEventId(type, at),
    type,
    title: input.title ?? historyTypeTitles[type],
    description: input.description,
    status: input.status,
    at,
  };
}

function initialPublicationHistoryEvent(item: DemoPublication) {
  return createPublicationHistoryEvent("created", {
    at: item.createdAt,
    status: item.status,
    description: `${demoPublicationLabels[item.type]} создано со статусом «${item.status}».`,
  });
}

function rawHistory(item: DemoPublication) {
  return Array.isArray(item.history) ? item.history.filter(isValidHistoryEvent) : [];
}

function ensureCreatedHistory(item: DemoPublication) {
  const history = rawHistory(item);
  const hasCreated = history.some((event) => event.type === "created");

  return hasCreated ? history : [initialPublicationHistoryEvent(item), ...history];
}

export function withPublicationHistory(item: DemoPublication) {
  return {
    ...item,
    history: ensureCreatedHistory(item),
  };
}

export function getPublicationHistory(item: DemoPublication) {
  const history = ensureCreatedHistory(item);
  const hasSoldEvent = history.some((event) => event.type === "sold");
  const hasUnpublishedEvent = history.some((event) => event.type === "unpublished");
  const fallbackEvents: DemoPublicationHistoryEvent[] = [];

  if (item.soldAt && isDemoPublicationSold(item) && !hasSoldEvent) {
    fallbackEvents.push(
      createPublicationHistoryEvent("sold", {
        at: item.soldAt,
        status: item.status,
        description: "Объявление отмечено как проданное.",
      }),
    );
  }

  if (isUnpublishedStatus(item.status) && !hasUnpublishedEvent) {
    fallbackEvents.push(
      createPublicationHistoryEvent("unpublished", {
        at: item.soldAt ?? item.createdAt,
        status: item.status,
        description: `${demoPublicationLabels[item.type]} снято с публикации.`,
      }),
    );
  }

  return [...history, ...fallbackEvents].sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime());
}

export function appendPublicationHistory(
  item: DemoPublication,
  type: DemoPublicationHistoryType,
  input: {
    at?: string;
    description?: string;
    status?: string;
    title?: string;
  } = {},
) {
  const event = createPublicationHistoryEvent(type, input);
  const history = [...ensureCreatedHistory(item), event].slice(-40);

  return {
    ...item,
    history,
  };
}

export function withPublicationStatusHistory(
  item: DemoPublication,
  nextStatus: string,
  input: {
    at?: string;
    description?: string;
    type?: DemoPublicationHistoryType;
  } = {},
) {
  const updatedItem = { ...item, status: nextStatus };

  if (normalizeStatus(item.status) === normalizeStatus(nextStatus)) {
    return updatedItem;
  }

  return appendPublicationHistory(updatedItem, input.type ?? "status_changed", {
    at: input.at,
    status: nextStatus,
    description: input.description ?? `Статус изменен: «${item.status}» → «${nextStatus}».`,
  });
}

export function isDemoPublicationSold(item: Pick<DemoPublication, "status">) {
  return item.status.trim().toLowerCase() === soldPublicationStatus.toLowerCase() || item.status.trim().toLowerCase() === "sold";
}

export function isDemoPublicationPubliclyVisible(item: DemoPublication) {
  const status = item.status.trim().toLowerCase();

  return !isDemoPublicationSold(item) && !isDemoPublicationExpired(item) && (status === "опубликовано" || status === "published");
}
