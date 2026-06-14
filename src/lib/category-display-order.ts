export type CategoryDisplayItem = {
  id: string;
  label: string;
  href: string;
};

export const categoryDisplayOrderStorageKey = "blizhniy-category-display-order";
export const categoryDisplayOrderEventName = "blizhniy-category-display-order-updated";

export const categoryDisplayItems: CategoryDisplayItem[] = [
  { id: "zhivotnye", label: "Животные", href: "/katalog/zhivotnye" },
  { id: "sad-i-ogorod", label: "Сад и огород", href: "/katalog/sad-i-rasteniya" },
  { id: "tovary-dlya-detey", label: "Товары для детей", href: "/katalog/tovary-dlya-detey" },
  { id: "ritualnye-uslugi", label: "Ритуальные услуги", href: "/katalog/ritualnye-uslugi" },
  { id: "nedvizhimost", label: "Недвижимость", href: "/katalog/nedvizhimost" },
  { id: "rabota", label: "Работа", href: "/rabota" },
  { id: "odezhda-obuv-aksessuary", label: "Одежда, обувь, аксессуары", href: "/katalog/odezhda-obuv-aksessuary" },
  { id: "hobbi-i-otdyh", label: "Хобби и отдых", href: "/katalog/otdyh" },
  { id: "transport", label: "Авто", href: "/katalog/transport" },
  { id: "biznes", label: "Готовый бизнес и оборудование", href: "/katalog/biznes" },
  { id: "uslugi", label: "Услуги", href: "/katalog/uslugi-dlya-doma" },
  { id: "elektronika", label: "Электроника", href: "/katalog/elektronika" },
  { id: "dlya-doma-i-dachi", label: "Для дома и дачи", href: "/katalog/dlya-doma-i-dachi" },
  { id: "instrumenty", label: "Инструменты", href: "/katalog/instrumenty" },
  { id: "zhile-dlya-puteshestviya", label: "Жилье для путешествия", href: "/katalog/nedvizhimost/zhile-dlya-puteshestviya" },
  { id: "krasota-i-zdorove", label: "Красота и здоровье", href: "/katalog/krasota-i-uhod" },
  { id: "obmen-i-darom", label: "Меняю и отдам даром", href: "/obyavleniya/obmen-i-darom" },
  { id: "raznoe", label: "Разное", href: "/katalog/raznoe" },
];

export const defaultCategoryDisplayOrder = categoryDisplayItems.map((item) => item.id);

export function normalizeCategoryDisplayOrder(order: string[] | null | undefined) {
  const knownIds = new Set(defaultCategoryDisplayOrder);
  const nextOrder = (order ?? []).filter((id, index, items) => knownIds.has(id) && items.indexOf(id) === index);
  const usedIds = new Set(nextOrder);
  const missingIds = defaultCategoryDisplayOrder.filter((id) => !usedIds.has(id));

  return [...nextOrder, ...missingIds];
}

export function orderCategoryDisplayItems<T extends { id: string }>(items: T[], order: string[] | null | undefined) {
  const normalizedOrder = normalizeCategoryDisplayOrder(order);
  const orderMap = new Map(normalizedOrder.map((id, index) => [id, index]));

  return [...items].sort((left, right) => {
    const leftIndex = orderMap.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = orderMap.get(right.id) ?? Number.MAX_SAFE_INTEGER;

    return leftIndex - rightIndex;
  });
}

export function readCategoryDisplayOrder() {
  if (typeof window === "undefined") {
    return defaultCategoryDisplayOrder;
  }

  try {
    const stored = window.localStorage.getItem(categoryDisplayOrderStorageKey);
    const parsed = stored ? (JSON.parse(stored) as unknown) : null;
    return normalizeCategoryDisplayOrder(Array.isArray(parsed) ? parsed.map(String) : null);
  } catch {
    return defaultCategoryDisplayOrder;
  }
}

export function writeCategoryDisplayOrder(order: string[]) {
  const normalizedOrder = normalizeCategoryDisplayOrder(order);

  window.localStorage.setItem(categoryDisplayOrderStorageKey, JSON.stringify(normalizedOrder));
  window.dispatchEvent(new CustomEvent(categoryDisplayOrderEventName, { detail: normalizedOrder }));

  return normalizedOrder;
}
