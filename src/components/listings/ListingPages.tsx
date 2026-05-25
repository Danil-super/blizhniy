import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CheckCircle2,
  ChevronRight,
  Clock3,
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
import { LocationMap } from "@/components/LocationMap";
import { SiteHeader } from "@/components/SiteHeader";
import { categories, tariffs } from "@/lib/data";
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
    messengerUrl: "https://t.me/blizhniy_demo",
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
];

export function slugifySubcategory(name: string) {
  const map: Record<string, string> = {
    "Товары времен СССР": "tovary-vremen-sssr",
    "Картины и живопись": "kartiny-i-zhivopis",
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
    <nav className="mb-5 flex flex-wrap items-center gap-2 text-sm text-slate-500" aria-label="Хлебные крошки">
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

function ListingFilters() {
  return (
    <aside className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 text-lg font-black text-[#060b27]">
        <Filter className="h-5 w-5 text-[#0875d1]" />
        Фильтры
      </div>
      <div className="mt-5 space-y-4">
        <label className="block">
          <span className="text-sm font-bold text-slate-700">Поиск</span>
          <span className="mt-2 flex h-11 items-center gap-2 rounded-lg border border-slate-300 px-3 text-slate-500">
            <Search className="h-4 w-4" />
            <input className="w-full bg-transparent outline-none" placeholder="Название или описание" />
          </span>
        </label>
        <label className="block">
          <span className="text-sm font-bold text-slate-700">Цена от</span>
          <input className="mt-2 h-11 w-full rounded-lg border border-slate-300 px-3 outline-none focus:border-[#0875d1]" placeholder="0 ₽" />
        </label>
        <label className="block">
          <span className="text-sm font-bold text-slate-700">Цена до</span>
          <input className="mt-2 h-11 w-full rounded-lg border border-slate-300 px-3 outline-none focus:border-[#0875d1]" placeholder="50 000 ₽" />
        </label>
        <label className="flex items-center gap-3 rounded-lg bg-slate-50 p-3 text-sm font-semibold text-slate-700">
          <input type="checkbox" className="h-4 w-4 accent-[#0875d1]" />
          Только с сообщениями
        </label>
      </div>
    </aside>
  );
}

function ListingList({ listings }: { listings: DemoListing[] }) {
  return (
    <div className="space-y-4">
      {listings.length ? (
        listings.map((listing) => <ListingCard key={listing.slug} listing={listing} />)
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-600">
          В этой подборке пока нет демо-объявлений. Каркас фильтров и маршрута уже готов.
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
        <section className="page-container py-10">
          <Breadcrumbs items={[{ label: "Категории" }]} />
          <h1 className="text-5xl font-black text-[#060b27]">Категории объявлений</h1>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-600">
            Первый уровень каталога и подкатегории отображаются плитками. Структура готова для расширения по городам и регионам.
          </p>
        </section>
        <CategoryGrid />
        <section className="page-container pb-12">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {categories.map((category) => (
              <div key={category.slug} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <Link href={`/blizhniy/${category.slug}`} className="text-xl font-black text-[#060b27] hover:text-[#0875d1]">
                  {category.name}
                </Link>
                <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {category.children.map((child) => (
                    <Link
                      key={child}
                      href={`/blizhniy/${category.slug}/${slugifySubcategory(child)}`}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-[#0875d1]"
                    >
                      {child}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}

export function ListingKindPage({ kind }: { kind: ListingKind }) {
  const current = listingKinds.find((item) => item.slug === kind) ?? listingKinds[0];
  const listings = demoListings.filter((listing) => listing.kind === kind);

  return (
    <>
      <SiteHeader />
      <main className="page-container py-10">
        <Breadcrumbs items={[{ label: current.title }]} />
        <div className="grid gap-7 lg:grid-cols-[1fr_320px]">
          <section>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <ListingKindBadge kind={kind} />
                <h1 className="mt-4 text-5xl font-black text-[#060b27]">{current.title} в Краснодаре</h1>
                <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-600">{current.description}</p>
              </div>
              <Link
                href="/blizhniy/sozdat"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#0aa337] px-6 font-bold text-white shadow-lg shadow-emerald-100 transition hover:bg-[#078a2e]"
              >
                Разместить
                <ArrowRight className="h-5 w-5" />
              </Link>
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              {listingKinds.map((item) => (
                <Link
                  key={item.slug}
                  href={`/blizhniy/${item.slug}`}
                  className={`inline-flex h-10 items-center rounded-full border px-4 text-sm font-bold transition ${
                    item.slug === kind
                      ? "border-[#0875d1] bg-[#0875d1] text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:text-[#0875d1]"
                  }`}
                >
                  {item.title}
                </Link>
              ))}
            </div>
            <div className="mt-7">
              <ListingList listings={listings} />
            </div>
          </section>
          <ListingFilters />
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
        <div className="grid gap-7 lg:grid-cols-[1fr_320px]">
          <section>
            <h1 className="text-5xl font-black text-[#060b27]">{subcategory ?? category?.name ?? "Категория"}</h1>
            <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-600">
              Объявления Краснодара с ЧПУ-страницей категории, хлебными крошками, фильтрами и карточками.
            </p>
            {category ? (
              <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3">
                {category.children.map((child) => (
                  <Link
                    key={child}
                    href={`/blizhniy/${category.slug}/${slugifySubcategory(child)}`}
                    className="rounded-xl border border-slate-200 bg-white p-4 font-bold text-slate-700 shadow-sm transition hover:border-blue-200 hover:text-[#0875d1]"
                  >
                    {child}
                  </Link>
                ))}
              </div>
            ) : null}
            <div className="mt-7">
              <ListingList listings={listings} />
            </div>
          </section>
          <ListingFilters />
        </div>
      </main>
    </>
  );
}

export function ListingDetailPage({ slug }: { slug: string }) {
  const listing = demoListings.find((item) => item.slug === slug) ?? demoListings[0];
  const tariff = tariffs.find((item) => item.id === "listing-publication");

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
            <h1 className="mt-4 text-5xl font-black text-[#060b27]">{listing.title}</h1>
            <div className="mt-4 flex flex-wrap gap-2">
              <ListingKindBadge kind={listing.kind} />
              <StatusBadge status={listing.status} />
            </div>
            <div className="mt-6 flex min-h-80 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-slate-400">
              <Camera className="h-16 w-16" />
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
              <p className="text-3xl font-black text-[#060b27]">{listing.price}</p>
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
                  <p className="font-black text-amber-900">Mock-оплата</p>
                  <p className="mt-2 text-sm leading-6 text-amber-800">
                    Тариф: {tariff?.name ?? "Размещение объявления"} за {tariff?.price ?? 199} ₽. После успешной оплаты статус становится published.
                  </p>
                </div>
              </div>
            </div>
            <Link
              href={`/blizhniy/obyavlenie/${listing.slug}/redaktirovat`}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-800 transition hover:border-blue-200 hover:text-[#0875d1]"
            >
              <FilePenLine className="h-5 w-5" />
              Редактировать демо
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

function TextInput(props: { placeholder?: string; defaultValue?: string; type?: string }) {
  return <input {...props} className="h-12 w-full rounded-lg border border-slate-300 px-4 outline-none focus:border-[#0875d1]" />;
}

function SelectInput({ children, defaultValue }: { children: ReactNode; defaultValue?: string }) {
  return (
    <select defaultValue={defaultValue} className="h-12 w-full rounded-lg border border-slate-300 bg-white px-4 outline-none focus:border-[#0875d1]">
      {children}
    </select>
  );
}

export function ListingFormPage({ slug }: { slug?: string }) {
  const editing = Boolean(slug);
  const listing = slug ? demoListings.find((item) => item.slug === slug) ?? demoListings[0] : undefined;
  const tariff = tariffs.find((item) => item.id === "listing-publication");

  return (
    <>
      <SiteHeader />
      <main className="page-container py-10">
        <Breadcrumbs items={[{ label: editing ? "Редактирование объявления" : "Создание объявления" }]} />
        <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
          <section>
            <h1 className="text-5xl font-black text-[#060b27]">{editing ? "Редактировать объявление" : "Создать объявление"}</h1>
            <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-600">
              Статическая MVP-форма показывает поля объявления, статусы публикации и следующий шаг с mock-оплатой.
            </p>

            <form className="mt-7 grid gap-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Тип объявления">
                  <SelectInput defaultValue={listing?.kind ?? "prodam"}>
                    {listingKinds.map((kind) => (
                      <option key={kind.slug} value={kind.slug}>
                        {kind.title}
                      </option>
                    ))}
                  </SelectInput>
                </Field>
                <Field label="Статус">
                  <SelectInput defaultValue={listing?.status ?? "draft"}>
                    <option value="draft">draft - черновик</option>
                    <option value="pending_payment">pending_payment - ожидает оплату</option>
                    <option value="paid">paid - оплачено</option>
                    <option value="published">published - опубликовано</option>
                    <option value="archived">archived - архив</option>
                    <option value="expired">expired - истек срок</option>
                    <option value="rejected">rejected - отклонено</option>
                  </SelectInput>
                </Field>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Категория">
                  <SelectInput defaultValue={listing?.categorySlug ?? "mebel-i-interer"}>
                    {categories.map((category) => (
                      <option key={category.slug} value={category.slug}>
                        {category.name}
                      </option>
                    ))}
                  </SelectInput>
                </Field>
                <Field label="Подкатегория">
                  <SelectInput defaultValue={listing?.subcategorySlug ?? "mebel"}>
                    {categories.flatMap((category) =>
                      category.children.map((child) => (
                        <option key={`${category.slug}-${child}`} value={slugifySubcategory(child)}>
                          {child}
                        </option>
                      )),
                    )}
                  </SelectInput>
                </Field>
              </div>

              <Field label="Название">
                <TextInput defaultValue={listing?.title} placeholder="Например, Комод из массива дуба" />
              </Field>

              <label className="block">
                <span className="text-sm font-bold text-slate-700">Описание</span>
                <textarea
                  defaultValue={listing?.description}
                  className="mt-2 min-h-36 w-full rounded-lg border border-slate-300 px-4 py-3 outline-none focus:border-[#0875d1]"
                  placeholder="Состояние, детали, условия передачи"
                />
              </label>

              <div className="grid gap-4 md:grid-cols-3">
                <Field label="Регион">
                  <TextInput defaultValue="Краснодарский край" />
                </Field>
                <Field label="Город">
                  <TextInput defaultValue={listing?.city ?? "Краснодар"} />
                </Field>
                <Field label="Район / примерная зона">
                  <TextInput defaultValue={listing?.district ?? "Фестивальный район"} />
                </Field>
              </div>

              <div className="grid gap-4 md:grid-cols-4">
                <Field label="Адрес (скрыт для частных лиц)">
                  <TextInput placeholder="ул. Красная, дом..." />
                </Field>
                <Field label="Широта">
                  <TextInput defaultValue={listing?.lat ? String(listing.lat) : "45.056"} />
                </Field>
                <Field label="Долгота">
                  <TextInput defaultValue={listing?.lng ? String(listing.lng) : "38.958"} />
                </Field>
                <Field label="Цена">
                  <TextInput defaultValue={listing?.price} placeholder="Например, 12 000 ₽" />
                </Field>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <Field label="Телефон">
                  <TextInput defaultValue={listing?.phone} placeholder="+7..." type="tel" />
                </Field>
                <Field label="Telegram/WhatsApp">
                  <TextInput defaultValue={listing?.messengerUrl} placeholder="https://..." />
                </Field>
                <Field label="Email для уведомлений">
                  <TextInput placeholder="mail@example.ru" type="email" />
                </Field>
              </div>

              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5">
                <div className="flex items-center gap-3 font-bold text-slate-700">
                  <Camera className="h-5 w-5 text-[#0875d1]" />
                  Фото объявления
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-500">В MVP это статический блок загрузки. Позже здесь будет Supabase Storage или аналог.</p>
              </div>

              <div className="flex flex-wrap gap-3">
                <button type="button" className="inline-flex h-12 items-center justify-center rounded-xl border border-slate-300 px-6 font-bold text-slate-800">
                  Сохранить черновик
                </button>
                <Link href="/blizhniy/oplata/listing-publication" className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#0aa337] px-6 font-bold text-white">
                  Перейти к mock-оплате
                  <ArrowRight className="h-5 w-5" />
                </Link>
              </div>
            </form>
          </section>

          <aside className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
              <div className="flex items-center gap-2 text-lg font-black text-[#060b27]">
                <ShieldCheck className="h-5 w-5 text-[#0aa337]" />
                Публикация
              </div>
              <div className="mt-4 space-y-3">
                {["draft", "pending_payment", "paid", "published"].map((status, index) => (
                  <div key={status} className="flex items-center gap-3 rounded-lg bg-slate-50 p-3">
                    {index < 2 ? <CheckCircle2 className="h-5 w-5 text-[#0aa337]" /> : <Clock3 className="h-5 w-5 text-slate-400" />}
                    <span className="text-sm font-semibold text-slate-700">{status}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-blue-200 bg-blue-50 p-5">
              <div className="flex items-start gap-3">
                <CreditCard className="mt-1 h-5 w-5 text-[#0875d1]" />
                <div>
                  <p className="font-black text-[#060b27]">Mock-оплата</p>
                  <p className="mt-2 text-sm leading-6 text-slate-700">
                    Заказ сформирован: {tariff?.name ?? "Размещение объявления"} за {tariff?.price ?? 199} ₽ на {tariff?.durationDays ?? 30} дней.
                  </p>
                  <button className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#0875d1] font-bold text-white">
                    <CreditCard className="h-5 w-5" />
                    Тестовая успешная оплата
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 font-black text-[#060b27]">
                <Mail className="h-5 w-5 text-[#0875d1]" />
                Email-уведомления
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600">Заказ сформирован, оплата прошла, объявление опубликовано.</p>
            </div>
          </aside>
        </div>
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
