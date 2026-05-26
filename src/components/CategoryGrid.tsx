import Link from "next/link";

const categoryTiles = [
  {
    label: "Авто",
    href: "/blizhniy/transport",
    quickLinks: [
      { label: "Продам", href: "/blizhniy/transport/prodam-avto" },
      { label: "Куплю", href: "/blizhniy/transport/kuplyu-avto" },
    ],
  },
  {
    label: "Недвижимость",
    href: "/blizhniy/nedvizhimost",
    quickLinks: [
      { label: "Продам", href: "/blizhniy/nedvizhimost/prodam-nedvizhimost" },
      { label: "Куплю", href: "/blizhniy/nedvizhimost/kuplyu-nedvizhimost" },
    ],
  },
  { label: "Работа", href: "/blizhniy/rabota" },
  { label: "Одежда, обувь, аксессуары", href: "/blizhniy/tovary-i-veshchi" },
  { label: "Хобби и отдых", href: "/blizhniy/otdyh" },
  { label: "Животные", href: "/blizhniy/zhivotnye" },
  {
    label: "Готовый бизнес и оборудование",
    href: "/blizhniy/biznes",
    quickLinks: [
      { label: "Продам", href: "/blizhniy/biznes/prodam-biznes" },
      { label: "Куплю", href: "/blizhniy/biznes/kuplyu-biznes" },
    ],
  },
  { label: "Услуги", href: "/blizhniy/uslugi-dlya-doma" },
  { label: "Электроника", href: "/blizhniy/kategorii" },
  { label: "Для дома и дачи", href: "/blizhniy/mebel-i-interer" },
  { label: "Запчасти", href: "/blizhniy/transport/zapchasti" },
  { label: "Товары для детей", href: "/blizhniy/tovary-i-veshchi" },
  { label: "Жилье для путешествия", href: "/blizhniy/nedvizhimost/arenda" },
  { label: "Красота и здоровье", href: "/blizhniy/krasota-i-uhod" },
  { label: "Ритуальные услуги", href: "/blizhniy/ritualnye-uslugi" },
  { label: "Меняю и отдам даром", href: "/blizhniy/obmen-i-darom" },
];

export function CategoryGrid({ variant = "scroll" }: { variant?: "scroll" | "grid" }) {
  const outerClassName = variant === "scroll" ? "overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" : "";
  const gridClassName =
    variant === "scroll"
      ? "grid grid-flow-col grid-rows-2 auto-cols-[160px] gap-2 sm:grid-flow-row sm:grid-rows-none sm:grid-cols-3 sm:auto-cols-auto md:grid-cols-4 lg:grid-cols-7"
      : "grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7";

  return (
    <section className="page-container pb-6 pt-3 sm:pb-8">
      <div className={outerClassName}>
        <div className={gridClassName}>
          {categoryTiles.map((category) => (
            <div key={`${category.label}-${category.href}`} className="flex min-h-24 flex-col justify-between overflow-hidden rounded-xl bg-[#f0eeee] p-3 transition hover:bg-slate-200 sm:min-h-24">
              <Link href={category.href} className="line-clamp-2 block text-sm font-bold leading-5 text-slate-950 [overflow-wrap:anywhere]">
                {category.label}
              </Link>
              {category.quickLinks ? (
                <div className="mt-3 flex min-w-0 gap-1.5">
                  {category.quickLinks.map((link) => (
                    <Link key={link.href} href={link.href} className="min-w-0 rounded-md bg-white/75 px-2 py-1 text-[11px] font-bold text-slate-700 transition hover:text-[#0875d1]">
                      {link.label}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
