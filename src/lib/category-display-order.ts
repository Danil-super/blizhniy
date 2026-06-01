export type CategoryDisplayItem = {
  id: string;
  label: string;
  href: string;
};

export const categoryDisplayOrderStorageKey = "blizhniy-category-display-order";
export const categoryDisplayOrderEventName = "blizhniy-category-display-order-updated";

export const categoryDisplayItems: CategoryDisplayItem[] = [
  { id: "zhivotnye", label: "Животные", href: "/blizhniy/zhivotnye" },
  { id: "sad-i-ogorod", label: "Сад и огород", href: "/blizhniy/sad-i-rasteniya" },
  { id: "tovary-dlya-detey", label: "Товары для детей", href: "/blizhniy/tovary-i-veshchi" },
  { id: "ritualnye-uslugi", label: "Ритуальные услуги", href: "/blizhniy/ritualnye-uslugi" },
  { id: "nedvizhimost", label: "Недвижимость", href: "/blizhniy/nedvizhimost" },
  { id: "rabota", label: "Работа", href: "/blizhniy/rabota" },
  { id: "odezhda-obuv-aksessuary", label: "Одежда, обувь, аксессуары", href: "/blizhniy/tovary-i-veshchi" },
  { id: "hobbi-i-otdyh", label: "Хобби и отдых", href: "/blizhniy/otdyh" },
  { id: "transport", label: "Авто", href: "/blizhniy/transport" },
  { id: "biznes", label: "Готовый бизнес и оборудование", href: "/blizhniy/biznes" },
  { id: "uslugi", label: "Услуги", href: "/blizhniy/uslugi-dlya-doma" },
  { id: "elektronika", label: "Электроника", href: "/blizhniy/elektronika" },
  { id: "dlya-doma-i-dachi", label: "Для дома и дачи", href: "/blizhniy/mebel-i-interer" },
  { id: "zapchasti", label: "Запчасти", href: "/blizhniy/transport/zapchasti" },
  { id: "zhile-dlya-puteshestviya", label: "Жилье для путешествия", href: "/blizhniy/nedvizhimost/arenda" },
  { id: "krasota-i-zdorove", label: "Красота и здоровье", href: "/blizhniy/krasota-i-uhod" },
  { id: "obmen-i-darom", label: "Меняю и отдам даром", href: "/blizhniy/obmen-i-darom" },
  { id: "raznoe", label: "Разное", href: "/blizhniy/raznoe" },
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
