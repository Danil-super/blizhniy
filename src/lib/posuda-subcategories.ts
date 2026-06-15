export type PosudaDemoListing = {
  description: string;
  price: string;
  title: string;
};

export type PosudaSubcategory = {
  demoListing: PosudaDemoListing;
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
    demoListing: {
      title: "Набор кухонной посуды для готовки",
      description: "Сковорода, кастрюля, сотейник и ковш в хорошем состоянии. Подойдёт для дома, дачи или временного жилья.",
      price: "3 500 ₽",
    },
  },
  {
    name: "Столовая",
    slug: "stolovaya-posuda",
    description: "Посуда для сервировки и приёма пищи.",
    items: ["Тарелки.", "Блюда.", "Пиалы."],
    demoListing: {
      title: "Комплект столовой посуды на 6 персон",
      description: "Тарелки, блюда и пиалы для повседневной сервировки. Без сколов, можно забрать комплектом.",
      price: "2 800 ₽",
    },
  },
  {
    name: "Для напитков",
    slug: "dlya-napitkov",
    description: "Посуда для подачи напитков.",
    items: ["Бокалы.", "Кружки.", "Чашки."],
    demoListing: {
      title: "Бокалы, кружки и чашки набором",
      description: "Набор посуды для напитков: бокалы, кружки и чашки. Подойдёт для кухни, офиса или дачи.",
      price: "1 600 ₽",
    },
  },
  {
    name: "Для хранения и заготовок",
    slug: "dlya-hraneniya-i-zagotovok",
    description: "Посуда для хранения продуктов и заготовок.",
    items: ["Контейнеры.", "Банки.", "Лотки."],
    demoListing: {
      title: "Контейнеры, банки и лотки для хранения",
      description: "Набор ёмкостей для хранения продуктов и домашних заготовок. Контейнеры, банки и лотки разного размера.",
      price: "1 200 ₽",
    },
  },
  {
    name: "Приборы для подачи",
    slug: "pribory-dlya-podachi",
    description: "Аксессуары для подачи и раскладывания блюд.",
    items: ["Лопатки.", "Щипцы.", "Ложки для раскладывания."],
    demoListing: {
      title: "Приборы для подачи блюд",
      description: "Лопатки, щипцы и ложки для раскладывания. Удобный набор для сервировки стола и домашних праздников.",
      price: "900 ₽",
    },
  },
  {
    name: "Прочая утварь",
    slug: "prochaya-utvar",
    description: "Вспомогательная кухонная утварь.",
    items: ["Мерные стаканы.", "Разделочные доски.", "Воронки.", "Тёрки."],
    demoListing: {
      title: "Кухонная утварь для готовки",
      description: "Мерные стаканы, разделочные доски, воронки и тёрки. Всё в рабочем состоянии, можно забрать одним набором.",
      price: "1 100 ₽",
    },
  },
];
