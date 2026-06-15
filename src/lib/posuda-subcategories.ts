export type PosudaSubcategory = {
  description: string;
  items: string[];
  name: string;
  slug: string;
};

export const posudaSubcategories: PosudaSubcategory[] = [
  {
    name: "Кухонная",
    slug: "kuhonnaya-posuda",
    description: "Посуда для приготовления еды.",
    items: ["Сковороды.", "Кастрюли.", "Сотейники.", "Ковши."],
  },
  {
    name: "Столовая",
    slug: "stolovaya-posuda",
    description: "Посуда для сервировки и приёма пищи.",
    items: ["Тарелки.", "Блюда.", "Пиалы."],
  },
  {
    name: "Для напитков",
    slug: "dlya-napitkov",
    description: "Посуда для подачи напитков.",
    items: ["Бокалы.", "Кружки.", "Чашки."],
  },
  {
    name: "Для хранения и заготовок",
    slug: "dlya-hraneniya-i-zagotovok",
    description: "Посуда для хранения продуктов и заготовок.",
    items: ["Контейнеры.", "Банки.", "Лотки."],
  },
  {
    name: "Приборы для подачи",
    slug: "pribory-dlya-podachi",
    description: "Аксессуары для подачи и раскладывания блюд.",
    items: ["Лопатки.", "Щипцы.", "Ложки для раскладывания."],
  },
  {
    name: "Прочая утварь",
    slug: "prochaya-utvar",
    description: "Вспомогательная кухонная утварь.",
    items: ["Мерные стаканы.", "Разделочные доски.", "Воронки.", "Тёрки."],
  },
];
