import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  ChevronRight,
  CreditCard,
  FilePenLine,
  Filter,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { CategoryGrid } from "@/components/CategoryGrid";
import { DropdownOption, DropdownSelect } from "@/components/DropdownSelect";
import { LocationMap } from "@/components/LocationMap";
import { SiteHeader } from "@/components/SiteHeader";
import { ValidatedInput } from "@/components/ValidatedInput";
import { categories } from "@/lib/data";
import { getTariffs } from "@/lib/tariff-store";
import { ListingCategoryFields, ListingLocationFields, ListingPhotoUploader } from "./ListingFormControls";
import { DemoListing, ListingCard, ListingKind, ListingKindBadge, StatusBadge } from "./ListingCard";

const listingKinds: { slug: ListingKind; title: string; description: string }[] = [
  { slug: "prodam", title: "Продам", description: "Вещи, мебель, растения и полезные товары рядом с домом." },
  { slug: "kuplyu", title: "Куплю", description: "Запросы покупателей: что ищут жители Краснодара и края." },
  { slug: "menyayu", title: "Меняю", description: "Обмен товарами, коллекциями, вещами и материалами." },
  { slug: "otdam-darom", title: "Отдам даром", description: "Публикации без цены: забрать, передать, пристроить." },
];

export const demoListings: DemoListing[] = [
  {
    slug: "komod-dub-krasnodar",
    title: "Комод из массива дуба",
    kind: "prodam",
    categorySlug: "mebel-i-interer",
    categoryName: "Мебель и интерьер",
    subcategorySlug: "mebel",
    subcategoryName: "Мебель",
    city: "Краснодар",
    district: "Фестивальный",
    lat: 45.056,
    lng: 38.958,
    showExactAddress: false,
    price: "18 500 ₽",
    description: "Аккуратный комод в хорошем состоянии, четыре вместительных ящика, самовывоз или доставка по договоренности.",
    phone: "+78610002001",
    messengerUrl: "https://wa.me/78610002001",
    status: "published",
    paid: true,
    createdAt: "12 мая 2026",
    publishedAt: "13 мая 2026",
    expiresAt: "12 июня 2026",
    imageTone: "amber",
  },
  {
    slug: "kuplyu-vykroyki-sssr",
    title: "Куплю выкройки и журналы по рукоделию",
    kind: "kuplyu",
    categorySlug: "tovary-i-veshchi",
    categoryName: "Товары и вещи",
    subcategorySlug: "vykroyki-i-rukodelie",
    subcategoryName: "Выкройки и рукоделие",
    city: "Краснодар",
    district: "Центр",
    lat: 45.037,
    lng: 38.975,
    showExactAddress: false,
    price: "до 3 000 ₽",
    description: "Интересуют старые журналы, лекала, наборы для вышивки и шитья. Рассмотрю подборки и отдельные экземпляры.",
    phone: "+78610002002",
    status: "published",
    paid: true,
    createdAt: "14 мая 2026",
    publishedAt: "14 мая 2026",
    expiresAt: "13 июня 2026",
    imageTone: "violet",
  },
  {
    slug: "menyayu-sazhentsy-lavandy",
    title: "Меняю саженцы лаванды на комнатные растения",
    kind: "menyayu",
    categorySlug: "sad-i-rasteniya",
    categoryName: "Сад и растения",
    subcategorySlug: "tsvety-i-sazhentsy",
    subcategoryName: "Цветы и саженцы",
    city: "Краснодар",
    district: "Юбилейный",
    lat: 45.02,
    lng: 38.93,
    showExactAddress: false,
    price: "Обмен",
    description: "Есть крепкие саженцы лаванды в контейнерах. Интересны фикусы, монстеры, сансевиерии или кашпо.",
    phone: "+78610002003",
    messengerUrl: "https://t.me/blizhniy_support",
    status: "published",
    paid: true,
    createdAt: "15 мая 2026",
    publishedAt: "15 мая 2026",
    expiresAt: "14 июня 2026",
    imageTone: "green",
  },
  {
    slug: "otdam-korm-dlya-koshek",
    title: "Отдам корм и миски для кошки",
    kind: "otdam-darom",
    categorySlug: "zhivotnye",
    categoryName: "Животные",
    subcategorySlug: "tovary-dlya-zhivotnyh",
    subcategoryName: "Товары для животных",
    city: "Краснодар",
    district: "Гидрострой",
    lat: 45.0,
    lng: 39.09,
    showExactAddress: false,
    price: "Бесплатно",
    description: "Остался сухой корм, две миски и переноска. Забрать можно вечером, бронь по телефону.",
    phone: "+78610002004",
    status: "published",
    paid: true,
    createdAt: "16 мая 2026",
    publishedAt: "16 мая 2026",
    expiresAt: "15 июня 2026",
    imageTone: "rose",
  },
  {
    slug: "kartina-more-akril",
    title: "Картина акрилом Черное море",
    kind: "prodam",
    categorySlug: "antikvariat-i-kollektsii",
    categoryName: "Антиквариат и коллекции",
    subcategorySlug: "kartiny-i-zhivopis",
    subcategoryName: "Картины и живопись",
    city: "Краснодар",
    district: "Черемушки",
    lat: 45.017,
    lng: 39.02,
    showExactAddress: false,
    price: "7 900 ₽",
    description: "Авторская работа на холсте 50 на 70 см. Подойдет для гостиной, кабинета или небольшого офиса.",
    phone: "+78610002005",
    messengerUrl: "https://wa.me/78610002005",
    status: "pending_payment",
    paid: false,
    createdAt: "18 мая 2026",
    publishedAt: "После оплаты",
    expiresAt: "Через 30 дней после публикации",
    imageTone: "blue",
  },
  {
    slug: "prodam-kvartiru-festivalnyy",
    title: "2-комнатная квартира в Фестивальном",
    kind: "prodam",
    categorySlug: "nedvizhimost",
    categoryName: "Недвижимость",
    subcategorySlug: "prodam-nedvizhimost",
    subcategoryName: "Продам недвижимость",
    city: "Краснодар",
    district: "Фестивальный",
    lat: 45.058,
    lng: 38.957,
    showExactAddress: false,
    price: "8 900 000 ₽",
    description: "Светлая квартира рядом с парком, две изолированные комнаты, документы готовы к сделке.",
    phone: "+78610002006",
    messengerUrl: "https://wa.me/78610002006",
    status: "published",
    paid: true,
    createdAt: "19 мая 2026",
    publishedAt: "19 мая 2026",
    expiresAt: "18 июня 2026",
    imageTone: "green",
  },
  {
    slug: "kuplyu-avto-krossover",
    title: "Куплю кроссовер до 1,8 млн ₽",
    kind: "kuplyu",
    categorySlug: "transport",
    categoryName: "Авто",
    subcategorySlug: "kuplyu-avto",
    subcategoryName: "Куплю авто",
    city: "Краснодар",
    district: "Центр",
    lat: 45.037,
    lng: 38.975,
    showExactAddress: false,
    price: "до 1 800 000 ₽",
    description: "Ищу живой автомобиль без серьезных ДТП, рассмотрю Краснодар и ближайшие города.",
    phone: "+78610002007",
    status: "published",
    paid: true,
    createdAt: "20 мая 2026",
    publishedAt: "20 мая 2026",
    expiresAt: "19 июня 2026",
    imageTone: "blue",
  },
  {
    slug: "prodam-kofeynyy-ostrovok",
    title: "Кофейный островок в торговом центре",
    kind: "prodam",
    categorySlug: "biznes",
    categoryName: "Бизнес",
    subcategorySlug: "prodam-biznes",
    subcategoryName: "Продам бизнес",
    city: "Сочи",
    district: "Адлер",
    lat: 43.43,
    lng: 39.92,
    showExactAddress: false,
    price: "1 250 000 ₽",
    description: "Готовая точка с оборудованием, поставщиками и обученным персоналом.",
    phone: "+78610002008",
    messengerUrl: "https://wa.me/78610002008",
    status: "published",
    paid: true,
    createdAt: "21 мая 2026",
    publishedAt: "21 мая 2026",
    expiresAt: "20 июня 2026",
    imageTone: "amber",
  },
  {
    slug: "ritualnye-uslugi-pamyatniki",
    title: "Памятники и уход за местом",
    kind: "prodam",
    categorySlug: "ritualnye-uslugi",
    categoryName: "Ритуальные услуги",
    subcategorySlug: "pamyatniki",
    subcategoryName: "Памятники",
    city: "Краснодар",
    district: "Прикубанский",
    lat: 45.08,
    lng: 39.01,
    showExactAddress: false,
    price: "по договоренности",
    description: "Изготовление памятников, благоустройство и регулярный уход за местом.",
    phone: "+78610002009",
    status: "published",
    paid: true,
    createdAt: "22 мая 2026",
    publishedAt: "22 мая 2026",
    expiresAt: "21 июня 2026",
    imageTone: "violet",
  },
];

export function slugifySubcategory(name: string) {
  const map: Record<string, string> = {
    "Товары времен СССР": "tovary-vremen-sssr",
    "Картины и живопись": "kartiny-i-zhivopis",
    "Продам недвижимость": "prodam-nedvizhimost",
    "Куплю недвижимость": "kuplyu-nedvizhimost",
    Аренда: "arenda",
    "Коммерческая недвижимость": "kommercheskaya-nedvizhimost",
    "Продам авто": "prodam-avto",
    "Куплю авто": "kuplyu-avto",
    Мототехника: "mototehnika",
    Запчасти: "zapchasti",
    "Продам бизнес": "prodam-biznes",
    "Куплю бизнес": "kuplyu-biznes",
    Оборудование: "oborudovanie",
    Партнерство: "partnerstvo",
    "Организация похорон": "organizatsiya-pohoron",
    Памятники: "pamyatniki",
    "Уход за местом": "uhod-za-mestom",
    Животные: "zhivotnye",
    "Товары для животных": "tovary-dlya-zhivotnyh",
    Парикмахеры: "parikmahery",
    "Маникюр и педикюр": "manikyur-i-pedikyur",
    "Медицинский персонал": "meditsinskiy-personal",
    "Уход на дому": "uhod-na-domu",
    Мебель: "mebel",
    Вакансии: "vakansii",
    "Анкеты специалистов": "ankety-spetsialistov",
    "Ремонт квартир": "remont-kvartir",
    Сантехника: "santehnika",
    "Цветы и саженцы": "tsvety-i-sazhentsy",
    "Выкройки и рукоделие": "vykroyki-i-rukodelie",
    Клининг: "klining",
  };

  return map[name] ?? name.toLowerCase().replaceAll(" ", "-");
}

function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav className="mb-4 flex flex-wrap items-center gap-2 text-xs text-slate-500 sm:text-sm" aria-label="Хлебные крошки">
      <Link href="/blizhniy/prodam" className="hover:text-[#0875d1]">
        Краснодар
      </Link>
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-2">
          <span>/</span>
          {item.href ? (
            <Link href={item.href} className="hover:text-[#0875d1]">
              {item.label}
            </Link>
          ) : (
            <span>{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

function ListingFiltersFields() {
  return (
    <div className="mt-3 space-y-3 sm:mt-4 lg:mt-5 lg:space-y-4">
      <label className="block">
        <span className="text-xs font-bold text-slate-700 sm:text-sm">Поиск</span>
        <span className="mt-1.5 flex h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm text-slate-500 sm:h-11">
          <Search className="h-4 w-4" />
          <input className="min-w-0 w-full bg-transparent outline-none" placeholder="Название или описание" />
        </span>
      </label>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-1 lg:gap-3">
        <label className="block">
          <span className="text-xs font-bold text-slate-700 sm:text-sm">Цена от</span>
          <input className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-[#0875d1] sm:h-11" placeholder="0 ₽" />
        </label>
        <label className="block">
          <span className="text-xs font-bold text-slate-700 sm:text-sm">Цена до</span>
          <input className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-[#0875d1] sm:h-11" placeholder="50 000 ₽" />
        </label>
      </div>
      <label className="flex items-center gap-2 rounded-lg bg-slate-50 p-2.5 text-xs font-semibold text-slate-700 sm:gap-3 sm:p-3 sm:text-sm">
        <input type="checkbox" className="h-4 w-4 accent-[#0875d1]" />
        Только с сообщениями
      </label>
    </div>
  );
}

function ListingFilters() {
  return (
    <details className="group mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm sm:mt-5 lg:mt-6">
      <summary className="flex h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 text-sm font-black text-[#060b27] marker:hidden [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-[#0875d1]">
            <Filter className="h-4 w-4" />
          </span>
          Фильтры
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-500 transition group-open:rotate-90" />
      </summary>
      <div className="border-t border-slate-100 px-3 pb-3">
        <ListingFiltersFields />
      </div>
    </details>
  );
}

function ListingList({ listings }: { listings: DemoListing[] }) {
  return (
    <div className="space-y-3 sm:space-y-4">
      {listings.length ? (
        listings.map((listing) => <ListingCard key={listing.slug} listing={listing} />)
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-600">
          В этой подборке пока нет объявлений. Попробуйте другой раздел или создайте новую публикацию.
        </div>
      )}
    </div>
  );
}

export function CategoriesPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="page-container py-5 sm:py-7 lg:py-10">
          <Breadcrumbs items={[{ label: "Категории" }]} />
          <h1 className="text-2xl font-black text-[#060b27] sm:text-3xl lg:text-5xl">Категории объявлений</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 sm:mt-3 sm:text-base sm:leading-7 lg:mt-4 lg:text-lg lg:leading-8">
            Первый уровень каталога и подкатегории отображаются плитками. Структура готова для расширения по городам и регионам.
          </p>
        </section>
        <CategoryGrid variant="grid" />
      </main>
    </>
  );
}

export function ListingKindPage({ kind }: { kind: ListingKind }) {
  const current = listingKinds.find((item) => item.slug === kind) ?? listingKinds[0];
  const listings = demoListings.filter((listing) => listing.kind === kind);
  const primaryKinds = listingKinds.filter((item) => item.slug === "prodam" || item.slug === "kuplyu");
  const exchangeKinds = listingKinds.filter((item) => item.slug === "menyayu" || item.slug === "otdam-darom");
  const visibleKinds = kind === "prodam" || kind === "kuplyu" ? primaryKinds : exchangeKinds;

  return (
    <>
      <SiteHeader />
      <main className="page-container py-6 sm:py-8 lg:py-10">
        <Breadcrumbs items={[{ label: current.title }]} />
        <div className="grid gap-7">
          <section>
            <div className="flex flex-wrap items-end justify-between gap-3 sm:gap-4">
              <div>
                <ListingKindBadge kind={kind} />
                <h1 className="mt-3 text-2xl font-black leading-tight text-[#060b27] sm:text-3xl lg:mt-4 lg:text-4xl">{current.title} в Краснодаре</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 sm:mt-3 sm:text-base sm:leading-7 lg:mt-4 lg:text-lg lg:leading-8">{current.description}</p>
              </div>
              <Link
                href="/blizhniy/sozdat/obyavlenie"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#0aa337] px-4 text-sm font-bold text-white shadow-lg shadow-emerald-100 transition hover:bg-[#078a2e] sm:h-11 sm:px-5 lg:h-12 lg:px-6 lg:text-base"
              >
                Разместить
                <ArrowRight className="h-4 w-4 sm:h-5 sm:w-5" />
              </Link>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 sm:mt-5 lg:mt-6">
              {visibleKinds.map((item) => (
                <Link
                  key={item.slug}
                  href={`/blizhniy/${item.slug}`}
                  className={`inline-flex h-8 items-center rounded-full border px-3 text-xs font-bold transition sm:h-9 sm:text-sm lg:h-10 lg:px-4 ${
                    item.slug === kind
                      ? "border-[#0875d1] bg-[#0875d1] text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:text-[#0875d1]"
                  }`}
                >
                  {item.title}
                </Link>
              ))}
              {kind === "prodam" || kind === "kuplyu" ? (
                <Link
                  href="/blizhniy/obmen-i-darom"
                  className="inline-flex h-8 items-center rounded-full border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition hover:border-blue-200 hover:text-[#0875d1] sm:h-9 sm:text-sm lg:h-10 lg:px-4"
                >
                  Меняю и отдам даром
                </Link>
              ) : null}
            </div>
            <ListingFilters />
            <div className="mt-5 sm:mt-6 lg:mt-7">
              <ListingList listings={listings} />
            </div>
          </section>
        </div>
      </main>
    </>
  );
}

export function ExchangeAndFreePage() {
  const listings = demoListings.filter((listing) => listing.kind === "menyayu" || listing.kind === "otdam-darom");

  return (
    <>
      <SiteHeader />
      <main className="page-container py-6 sm:py-8 lg:py-10">
        <Breadcrumbs items={[{ label: "Меняю и отдам даром" }]} />
        <div className="grid gap-7">
          <section>
            <div className="flex flex-wrap items-end justify-between gap-3 sm:gap-4">
              <div>
                <h1 className="text-2xl font-black leading-tight text-[#060b27] sm:text-3xl lg:text-4xl">Меняю и отдам даром</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 sm:mt-3 sm:text-base sm:leading-7 lg:mt-4 lg:text-lg lg:leading-8">
                  Отдельный раздел для обмена и бесплатных объявлений рядом с домом.
                </p>
              </div>
              <Link
                href="/blizhniy/sozdat/obyavlenie"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#0aa337] px-4 text-sm font-bold text-white shadow-lg shadow-emerald-100 transition hover:bg-[#078a2e] sm:h-11 sm:px-5 lg:h-12 lg:px-6 lg:text-base"
              >
                Разместить
                <ArrowRight className="h-4 w-4 sm:h-5 sm:w-5" />
              </Link>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 sm:mt-5 lg:mt-6">
              {listingKinds
                .filter((item) => item.slug === "menyayu" || item.slug === "otdam-darom")
                .map((item) => (
                  <Link
                    key={item.slug}
                    href={`/blizhniy/${item.slug}`}
                    className="inline-flex h-8 items-center rounded-full border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition hover:border-blue-200 hover:text-[#0875d1] sm:h-9 sm:text-sm lg:h-10 lg:px-4"
                  >
                    {item.title}
                  </Link>
                ))}
            </div>
            <ListingFilters />
            <div className="mt-5 sm:mt-6 lg:mt-7">
              <ListingList listings={listings} />
            </div>
          </section>
        </div>
      </main>
    </>
  );
}

export function CategoryListingsPage({ categorySlug, subcategorySlug }: { categorySlug: string; subcategorySlug?: string }) {
  const category = categories.find((item) => item.slug === categorySlug);
  const subcategory = category?.children.find((item) => slugifySubcategory(item) === subcategorySlug);
  const listings = demoListings.filter(
    (listing) => listing.categorySlug === categorySlug && (!subcategorySlug || listing.subcategorySlug === subcategorySlug),
  );

  return (
    <>
      <SiteHeader />
      <main className="page-container py-10">
        <Breadcrumbs
          items={[
            { label: "Категории", href: "/blizhniy/kategorii" },
            { label: category?.name ?? "Категория", href: category ? `/blizhniy/${category.slug}` : undefined },
            ...(subcategory ? [{ label: subcategory }] : []),
          ]}
        />
        <div className="grid gap-7">
          <section>
            <h1 className="[overflow-wrap:anywhere] text-3xl font-black text-[#060b27] sm:text-5xl">{subcategory ?? category?.name ?? "Категория"}</h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600 sm:text-lg sm:leading-8">
              Объявления Краснодара с ЧПУ-страницей категории, хлебными крошками, фильтрами и карточками.
            </p>
            {category ? (
              <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
                {category.children.map((child) => (
                  <Link
                    key={child}
                    href={`/blizhniy/${category.slug}/${slugifySubcategory(child)}`}
                    className="[overflow-wrap:anywhere] rounded-xl border border-slate-200 bg-white p-3 font-bold text-slate-700 shadow-sm transition hover:border-blue-200 hover:text-[#0875d1] sm:p-4"
                  >
                    {child}
                  </Link>
                ))}
              </div>
            ) : null}
            <ListingFilters />
            <div className="mt-7">
              <ListingList listings={listings} />
            </div>
          </section>
        </div>
      </main>
    </>
  );
}

export function ListingDetailPage({ slug }: { slug: string }) {
  const listing = demoListings.find((item) => item.slug === slug) ?? demoListings[0];
  const tariff = getTariffs().find((item) => item.id === "listing-publication");

  return (
    <>
      <SiteHeader />
      <main className="page-container py-10">
        <Breadcrumbs
          items={[
            { label: listing.categoryName, href: `/blizhniy/${listing.categorySlug}` },
            { label: listing.subcategoryName, href: `/blizhniy/${listing.categorySlug}/${listing.subcategorySlug}` },
            { label: listing.title },
          ]}
        />
        <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
          <section>
            <Link href={`/blizhniy/${listing.kind}`} className="inline-flex items-center gap-2 text-sm font-bold text-[#0875d1]">
              <ArrowLeft className="h-4 w-4" />
              Назад к разделу
            </Link>
            <h1 className="[overflow-wrap:anywhere] mt-4 text-3xl font-black text-[#060b27] sm:text-5xl">{listing.title}</h1>
            <div className="mt-4 flex flex-wrap gap-2">
              <ListingKindBadge kind={listing.kind} />
              <StatusBadge status={listing.status} />
            </div>
            <div className="mt-6 flex min-h-56 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-slate-400 sm:min-h-80">
              <Camera className="h-12 w-12 sm:h-16 sm:w-16" />
            </div>
            <div className="mt-7 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-2xl font-black text-[#060b27]">Описание</h2>
              <p className="mt-4 text-lg leading-8 text-slate-700">{listing.description}</p>
              <dl className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="rounded-lg bg-slate-50 p-4">
                  <dt className="text-sm font-bold text-slate-500">Категория</dt>
                  <dd className="mt-1 font-semibold text-slate-900">{listing.categoryName}</dd>
                </div>
                <div className="rounded-lg bg-slate-50 p-4">
                  <dt className="text-sm font-bold text-slate-500">Подкатегория</dt>
                  <dd className="mt-1 font-semibold text-slate-900">{listing.subcategoryName}</dd>
                </div>
                <div className="rounded-lg bg-slate-50 p-4">
                  <dt className="text-sm font-bold text-slate-500">Размещено</dt>
                  <dd className="mt-1 font-semibold text-slate-900">{listing.publishedAt}</dd>
                </div>
                <div className="rounded-lg bg-slate-50 p-4">
                  <dt className="text-sm font-bold text-slate-500">Активно до</dt>
                  <dd className="mt-1 font-semibold text-slate-900">{listing.expiresAt}</dd>
                </div>
              </dl>
            </div>
            <div className="mt-7">
              <LocationMap location={listing} exactLabel="Точный адрес частного лица по умолчанию не показывается" />
            </div>
          </section>

          <aside className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
              <p className="[overflow-wrap:anywhere] text-2xl font-black text-[#060b27] sm:text-3xl">{listing.price}</p>
              <p className="mt-3 flex items-center gap-2 text-slate-600">
                <MapPin className="h-5 w-5 text-[#0875d1]" />
                {listing.city}, {listing.district}
              </p>
              <div className="mt-5 grid gap-3">
                <a href={`tel:${listing.phone}`} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#0aa337] font-bold text-white">
                  <Phone className="h-5 w-5" />
                  Позвонить
                </a>
                {listing.messengerUrl ? (
                  <a
                    href={listing.messengerUrl}
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-[#0875d1] font-bold text-[#0875d1]"
                  >
                    <MessageCircle className="h-5 w-5" />
                    Написать сообщение
                  </a>
                ) : null}
              </div>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
              <div className="flex items-start gap-3">
                <CreditCard className="mt-1 h-5 w-5 text-amber-700" />
                <div>
                  <p className="font-black text-amber-900">Оплата</p>
                  <p className="mt-2 text-sm leading-6 text-amber-800">
                    Тариф: {tariff?.name ?? "Размещение объявления"} за {tariff?.price ?? 199} ₽. После успешной оплаты объявление будет опубликовано.
                  </p>
                </div>
              </div>
            </div>
            <Link
              href={`/blizhniy/obyavlenie/${listing.slug}/redaktirovat`}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-800 transition hover:border-blue-200 hover:text-[#0875d1]"
            >
              <FilePenLine className="h-5 w-5" />
              Редактировать
            </Link>
          </aside>
        </div>
      </main>
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-bold text-slate-700">{label}</span>
      <span className="mt-2 block">{children}</span>
    </label>
  );
}

function TextInput(props: { placeholder?: string; defaultValue?: string; type?: string; validation?: "phone" | "email" | "messenger" }) {
  return <ValidatedInput {...props} className="h-12 w-full rounded-lg border border-slate-300 px-4 outline-none focus:border-[#0875d1]" />;
}

function SelectInput({ name, options, defaultValue }: { name?: string; options: DropdownOption[]; defaultValue?: string }) {
  return <DropdownSelect name={name} defaultValue={defaultValue} options={options} />;
}

export function ListingFormPage({ slug, adminMode = false }: { slug?: string; adminMode?: boolean }) {
  const editing = Boolean(slug);
  const listing = slug ? demoListings.find((item) => item.slug === slug) ?? demoListings[0] : undefined;
  const tariff = getTariffs().find((item) => item.id === "listing-publication");

  return (
    <>
      <SiteHeader />
      <main className="page-container py-10">
        <Breadcrumbs items={[{ label: editing ? "Редактирование объявления" : "Создание объявления" }]} />
        <section>
          <h1 className="text-3xl font-black text-[#060b27] sm:text-5xl">{editing ? "Редактировать объявление" : "Создать объявление"}</h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600 sm:text-lg sm:leading-8">
            Заполните объявление, добавьте фото и выберите удобный способ связи.
          </p>

          <form className="mt-6 grid gap-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_minmax(0,1fr)]">
              <Field label="Тип объявления">
                <SelectInput name="kind" defaultValue={listing?.kind ?? "prodam"} options={listingKinds.map((kind) => ({ value: kind.slug, label: kind.title }))} />
              </Field>
              <ListingCategoryFields defaultCategorySlug={listing?.categorySlug ?? "mebel-i-interer"} defaultSubcategorySlug={listing?.subcategorySlug ?? "mebel"} />
            </div>

            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
              <Field label="Название">
                <TextInput defaultValue={listing?.title} placeholder="Например, Комод из массива дуба" />
              </Field>
              <Field label="Цена">
                <TextInput defaultValue={listing?.price} placeholder="Например, 12 000 ₽" />
              </Field>
            </div>

            <label className="block">
              <span className="text-sm font-bold text-slate-700">Описание</span>
              <textarea
                defaultValue={listing?.description}
                className="mt-2 min-h-28 w-full rounded-lg border border-slate-300 px-4 py-3 outline-none focus:border-[#0875d1]"
                placeholder="Состояние, детали, условия передачи"
              />
            </label>

            <ListingLocationFields defaultCity={listing?.city} />

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-lg font-black text-[#060b27]">
                <Phone className="h-5 w-5 text-[#0aa337]" />
                Контакты
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <Field label="Телефон">
                  <TextInput defaultValue={listing?.phone} placeholder="+7..." validation="phone" />
                </Field>
                <Field label="Telegram или WhatsApp">
                  <TextInput defaultValue={listing?.messengerUrl} placeholder="@username или ссылка" validation="messenger" />
                </Field>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-[1fr_220px]">
                <Field label="Email для уведомлений">
                  <TextInput placeholder="mail@example.ru" validation="email" />
                </Field>
                <Field label="Основной способ связи">
                  <SelectInput
                    name="contactMethod"
                    defaultValue="phone"
                    options={[
                      { value: "phone", label: "Телефон" },
                      { value: "messenger", label: "Мессенджер" },
                      { value: "email", label: "Email" },
                    ]}
                  />
                </Field>
              </div>
            </div>

            <ListingPhotoUploader />

            <div className="flex flex-wrap gap-3">
              <Link href="/cabinet/obyavleniya" className="inline-flex h-12 items-center justify-center rounded-xl border border-slate-300 px-6 font-bold text-slate-800">
                Сохранить черновик
              </Link>
              {adminMode ? (
                <Link href="/cabinet/obyavleniya" className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#0aa337] px-6 font-bold text-white">
                  Опубликовать без оплаты
                  <ArrowRight className="h-5 w-5" />
                </Link>
              ) : (
                <Link href="/blizhniy/oplata/listing-publication" className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#0aa337] px-6 font-bold text-white">
                  Перейти к оплате
                  <ArrowRight className="h-5 w-5" />
                </Link>
              )}
            </div>
          </form>

          <div className="mt-6 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 font-black text-[#060b27]">
                <ShieldCheck className="h-5 w-5 text-[#0aa337]" />
                Публикация
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {adminMode ? "В админ-режиме публикация доступна без оплаты для тестирования сценария." : `После оплаты объявление будет опубликовано на ${tariff?.durationDays ?? 30} дней.`}
              </p>
            </div>
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
              <div className="flex items-center gap-2 font-black text-[#060b27]">
                <CreditCard className="h-5 w-5 text-[#0875d1]" />
                Оплата
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-700">{tariff?.name ?? "Размещение объявления"}: {tariff?.price ?? 199} ₽.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 font-black text-[#060b27]">
                <Mail className="h-5 w-5 text-[#0875d1]" />
                Уведомления
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600">Статус оплаты и публикации придет на указанный email.</p>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}

export function CategoryNotFoundHint() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-3 text-xl font-black text-[#060b27]">
        <Sparkles className="h-6 w-6 text-[#0875d1]" />
        Категория готова к наполнению
      </div>
      <p className="mt-3 text-slate-600">Для неизвестного slug можно подключить CMS или админ-панель категорий без изменения URL-архитектуры.</p>
      <Link href="/blizhniy/kategorii" className="mt-5 inline-flex items-center gap-2 font-bold text-[#0875d1]">
        Все категории
        <ChevronRight className="h-5 w-5" />
      </Link>
    </div>
  );
}
