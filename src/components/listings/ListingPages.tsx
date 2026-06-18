import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import {
  ArrowRight,
  BadgePlus,
  ChevronRight,
  ClipboardList,
  CreditCard,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  PackageCheck,
  ShieldCheck,
  Sparkles,
  Truck,
} from "lucide-react";
import { AdminDemoPublishButton } from "@/components/AdminDemoPublishButton";
import { BackLink } from "@/components/BackLink";
import { CategoryGrid } from "@/components/CategoryGrid";
import { CapitalizedTextarea } from "@/components/CapitalizedTextarea";
import { DropdownOption, DropdownSelect } from "@/components/DropdownSelect";
import { HomeHero } from "@/components/HomeHero";
import { LocationMap } from "@/components/LocationMap";
import { LegalConsentCheckbox, LegalLink } from "@/components/LegalConsentCheckbox";
import { SiteHeader } from "@/components/SiteHeader";
import { ValidatedInput } from "@/components/ValidatedInput";
import { PublicationAuthGate } from "@/components/auth/PublicationAuthGate";
import { categories, cities } from "@/lib/data";
import { hasMapCoordinates } from "@/lib/map-location";
import { createListing, getListingStatusOverride, listListings } from "@/lib/mock-store";
import { extractListingPriceDigits, maxListingPriceDigits, normalizeListingPrice } from "@/lib/listing-price";
import { formatPublicationDateTime } from "@/lib/publication-time";
import { sellerDisplayName, sellerProfileHref, sellerProfileKey } from "@/lib/seller-profile";
import { getTariffs } from "@/lib/tariff-store";
import { TURNSTILE_ERROR_MESSAGE, verifyTurnstileFormData } from "@/lib/turnstile";
import type { BookingDetails, DeliveryOptions, DeliveryServiceId, Listing as StoreListing } from "@/lib/types";
import { BookingCalculator } from "./BookingCalculator";
import { DemoListingEditClient } from "./DemoListingEditClient";
import { DemoListingDetailClient } from "./DemoListingDetailClient";
import { ListingKindAndCategoryFields, ListingLocationFields, ListingPhotoUploader } from "./ListingFormControls";
import { DemoListing, ListingKind, ListingKindBadge, StatusBadge } from "./ListingCard";
import { ListingMediaGallery, type ListingGalleryMedia } from "./ListingMediaGallery";
import { ListingResultsPanel } from "./ListingResultsPanel";
import { ListingSellerCard } from "./ListingSellerCard";
import { ListingShareButton } from "./ListingShareButton";
import { ListingViewTracker } from "./ListingViewTracker";
import { SubcategoryShareButton } from "./SubcategoryShareButton";

const listingKinds: { slug: ListingKind; title: string; description: string }[] = [
  { slug: "prodam", title: "Продам", description: "Вещи, мебель, растения и полезные товары рядом с домом." },
  { slug: "kuplyu", title: "Куплю", description: "Запросы покупателей: что ищут жители Краснодара и края." },
  { slug: "arenda", title: "Аренда", description: "Бронирование турбаз, гостиниц, домов и активного отдыха." },
  { slug: "menyayu", title: "Меняю", description: "Обмен товарами, коллекциями, вещами и материалами." },
  { slug: "otdam-darom", title: "Отдам даром", description: "Публикации без цены: забрать, передать, пристроить." },
];

const deliveryServices: { id: DeliveryServiceId; label: string }[] = [
  { id: "cdek", label: "СДЭК" },
  { id: "boxberry", label: "Boxberry" },
  { id: "russian-post", label: "Почта России" },
  { id: "yandex-delivery", label: "Яндекс Доставка" },
  { id: "other", label: "Другая служба" },
];

const deliveryPayerLabels: Record<DeliveryOptions["payer"], string> = {
  buyer: "Покупатель",
  seller: "Продавец",
  split: "По договоренности",
};

const showDeliveryUi = false;

const baseDemoListings: DemoListing[] = [
  {
    slug: "komod-dub-krasnodar",
    title: "Комод из массива дуба",
    kind: "prodam",
    categorySlug: "dlya-doma-i-dachi",
    categoryName: "Для дома и дачи",
    subcategorySlug: "mebel-dlya-doma-i-dachi",
    subcategoryName: "Мебель для дома и дачи",
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
    slug: "smartfon-samsung-galaxy-krasnodar",
    title: "Смартфон Samsung Galaxy в хорошем состоянии",
    kind: "prodam",
    categorySlug: "elektronika",
    categoryName: "Электроника",
    subcategorySlug: "smartfony",
    subcategoryName: "Смартфоны",
    city: "Краснодар",
    district: "Центр",
    lat: 45.037,
    lng: 38.975,
    showExactAddress: false,
    price: "24 000 ₽",
    description: "Смартфон без сколов, аккумулятор держит день, комплект с зарядкой и чехлом. Проверка при встрече.",
    phone: "+78610002012",
    messengerUrl: "https://t.me/blizhniy_support",
    status: "published",
    paid: true,
    createdAt: "25 мая 2026",
    publishedAt: "25 мая 2026",
    expiresAt: "24 июня 2026",
    imageTone: "blue",
  },
  {
    slug: "turbaza-u-reki-goryachiy-klyuch",
    title: "Турбаза у реки с баней и беседками",
    kind: "arenda",
    categorySlug: "otdyh",
    categoryName: "Отдых",
    subcategorySlug: "turbazy",
    subcategoryName: "Турбазы",
    city: "Горячий Ключ",
    district: "район реки Псекупс",
    lat: 44.628,
    lng: 39.13,
    showExactAddress: false,
    price: "от 6 000 ₽/сутки",
    booking: {
      mode: "stay",
      priceWeekday: 6000,
      priceWeekend: 8500,
      minNights: 1,
      includedGuests: 4,
      maxGuests: 10,
      extraGuestPrice: 900,
      availableFrom: "2026-06-01",
      availableTo: "2026-08-31",
      blockedDates: ["2026-06-08", "2026-06-09", "2026-06-15", "2026-06-16", "2026-06-22"],
      checkInTime: "14:00",
      checkOutTime: "12:00",
      included: "Беседка, мангал, баня 2 часа, парковка, кухня.",
      rules: "Бронь подтверждается после связи с владельцем. С животными по согласованию.",
    },
    description: "Домики у реки для семейного отдыха и небольших компаний. Можно выбрать даты, количество гостей и сразу увидеть предварительную стоимость.",
    phone: "+78610002010",
    messengerUrl: "https://t.me/blizhniy_support",
    status: "published",
    paid: true,
    createdAt: "23 мая 2026",
    publishedAt: "23 мая 2026",
    expiresAt: "22 июня 2026",
    imageTone: "green",
  },
  {
    slug: "kvartira-posutochno-krasnodar-tsentr",
    title: "Квартира посуточно в центре Краснодара",
    kind: "arenda",
    categorySlug: "nedvizhimost",
    categoryName: "Недвижимость",
    subcategorySlug: "kommercheskaya-nedvizhimost",
    subcategoryName: "Коммерческая недвижимость",
    city: "Краснодар",
    district: "Центр",
    lat: 45.036,
    lng: 38.974,
    showExactAddress: false,
    price: "от 3 200 ₽/сутки",
    booking: {
      mode: "stay",
      priceWeekday: 3200,
      priceWeekend: 4200,
      minNights: 1,
      includedGuests: 2,
      maxGuests: 4,
      extraGuestPrice: 700,
      availableFrom: "2026-06-01",
      availableTo: "2026-09-30",
      blockedDates: ["2026-06-12", "2026-06-13", "2026-06-21"],
      checkInTime: "15:00",
      checkOutTime: "12:00",
      included: "Wi-Fi, постельное белье, полотенца, кухня, парковка во дворе.",
      rules: "Без вечеринок. Бронь подтверждается после связи с владельцем.",
    },
    description: "Уютная квартира для поездки в Краснодар: можно выбрать даты, количество гостей и сразу увидеть предварительную стоимость проживания.",
    phone: "+78610002011",
    messengerUrl: "https://t.me/blizhniy_support",
    status: "published",
    paid: true,
    createdAt: "24 мая 2026",
    publishedAt: "24 мая 2026",
    expiresAt: "23 июня 2026",
    imageTone: "blue",
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
    categoryName: "Сад и огород",
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
    slug: "domashnie-pitomtsy-koshka-s-pridanym",
    title: "Кошка с переноской и мисками",
    kind: "prodam",
    categorySlug: "zhivotnye",
    categoryName: "Животные",
    subcategorySlug: "domashnie-pitomtsy",
    subcategoryName: "Домашние питомцы",
    city: "Краснодар",
    district: "Гидрострой",
    lat: 45.0,
    lng: 39.09,
    showExactAddress: false,
    price: "в добрые руки",
    description: "Спокойная домашняя кошка, есть переноска, миски и запас корма. Передача после разговора с будущим владельцем.",
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
    slug: "namogilnye-sooruzheniya-s-ustanovkoy",
    title: "Памятник и ограда с установкой",
    kind: "prodam",
    categorySlug: "ritualnye-uslugi",
    categoryName: "Ритуальные услуги",
    subcategorySlug: "izgotovlenie-ustanovka-demontazh-namogilnyh-sooruzheniy",
    subcategoryName: "Изготовление, установка и демонтаж намогильных сооружений",
    city: "Краснодар",
    district: "Прикубанский",
    lat: 45.08,
    lng: 39.01,
    showExactAddress: false,
    price: "по договоренности",
    description: "Изготовление и установка памятников, оград, надгробий, гравировка и демонтаж старых сооружений.",
    phone: "+78610002009",
    status: "published",
    paid: true,
    createdAt: "22 мая 2026",
    publishedAt: "22 мая 2026",
    expiresAt: "21 июня 2026",
    imageTone: "violet",
  },
];

function inferListingKind(categorySlug: string, subcategorySlug: string): ListingKind {
  if (
    categorySlug === "otdyh" ||
    subcategorySlug === "arenda" ||
    subcategorySlug === "kommercheskaya-nedvizhimost" ||
    subcategorySlug === "zhile-dlya-puteshestviya"
  ) {
    return "arenda";
  }

  if (subcategorySlug.startsWith("kuplyu")) {
    return "kuplyu";
  }

  if (subcategorySlug === "partnerstvo") {
    return "menyayu";
  }

  return "prodam";
}

type ListingFormDefaults = {
  categorySlug?: string;
  kind?: string;
  subcategorySlug?: string;
};

function normalizeListingKind(value?: string): ListingKind | undefined {
  return listingKinds.some((item) => item.slug === value) ? (value as ListingKind) : undefined;
}

function getListingFormDefaults(defaults?: ListingFormDefaults) {
  const category = categories.find((item) => item.slug === defaults?.categorySlug) ?? categories.find((item) => item.slug === "dlya-doma-i-dachi") ?? categories[0];
  const categoryChildren = category ? getCategoryChildren(category.children) : [];
  const fallbackSubcategorySlug = categoryChildren[0] ? slugifySubcategory(categoryChildren[0]) : "";
  const subcategorySlug =
    defaults?.subcategorySlug && categoryChildren.some((child) => slugifySubcategory(child) === defaults.subcategorySlug)
      ? defaults.subcategorySlug
      : fallbackSubcategorySlug;
  const kind = normalizeListingKind(defaults?.kind) ?? inferListingKind(category?.slug ?? "dlya-doma-i-dachi", subcategorySlug);

  return {
    categorySlug: category?.slug ?? "dlya-doma-i-dachi",
    kind,
    subcategorySlug,
  };
}

function getCreateListingHref(categorySlug: string, subcategoryName: string) {
  const subcategorySlug = slugifySubcategory(subcategoryName);
  const params = new URLSearchParams({
    category: categorySlug,
    kind: inferListingKind(categorySlug, subcategorySlug),
    subcategory: subcategorySlug,
  });

  return `/razmestit/obyavlenie?${params.toString()}`;
}

const ritualServiceDescriptions: Record<string, string> = {
  "Организация и проведение обряда прощания":
    "Оформление и предоставление ритуального зала, музыкальное сопровождение, услуги церемониймейстера, прокат принадлежностей и организация поминальной церемонии.",
  "Захоронение и сопутствующие работы": "Копка могилы, погребение, эксгумация и перезахоронение.",
  Кремация: "Сжигание останков в крематории, временное хранение и выдача праха.",
  "Продажа и изготовление похоронных принадлежностей":
    "Гробы, венки, ленты, одежда для умершего и другие ритуальные атрибуты.",
  "Изготовление, установка и демонтаж намогильных сооружений":
    "Надгробия, памятники, ограды, гравировка, барельефы, установка и демонтаж.",
  "Уход за местом захоронения": "Уборка, озеленение, ремонт и покраска надгробий и ограждений.",
  "Транспортирование останков":
    "Перевозка тела от морга до места захоронения или кремации, включая дальние перевозки в цинковом гробу с опайкой.",
  "Предпохоронное содержание останков": "Хранение тела после установления причины смерти в останкохранилище.",
  "Подготовка тела к погребению":
    "Бальзамирование, санитарная и косметическая обработка, включая парикмахерские процедуры для приведения тела в надлежащий вид.",
};

const ritualServiceListingTitles: Record<string, string> = {
  "Организация и проведение обряда прощания": "Организация церемонии прощания под ключ",
  "Захоронение и сопутствующие работы": "Захоронение и сопутствующие работы на кладбище",
  Кремация: "Сопровождение кремации и выдачи праха",
  "Продажа и изготовление похоронных принадлежностей": "Гробы, венки и ритуальные принадлежности",
  "Изготовление, установка и демонтаж намогильных сооружений": "Памятник и ограда с установкой",
  "Уход за местом захоронения": "Уход за местом захоронения по заявке",
  "Транспортирование останков": "Ритуальный транспорт по Краснодарскому краю",
  "Предпохоронное содержание останков": "Предпохоронное содержание в останкохранилище",
  "Подготовка тела к погребению": "Подготовка тела к погребению",
};

const ritualServiceListingPrices: Record<string, string> = {
  "Организация и проведение обряда прощания": "от 18 000 ₽",
  "Захоронение и сопутствующие работы": "от 12 000 ₽",
  Кремация: "от 15 000 ₽",
  "Продажа и изготовление похоронных принадлежностей": "от 3 500 ₽",
  "Изготовление, установка и демонтаж намогильных сооружений": "по договоренности",
  "Уход за местом захоронения": "от 2 000 ₽",
  "Транспортирование останков": "от 4 000 ₽",
  "Предпохоронное содержание останков": "от 1 800 ₽/сутки",
  "Подготовка тела к погребению": "от 7 000 ₽",
};

const animalClassifiers: Record<string, string[]> = {
  "Домашние питомцы": [
    "Собаки и кошки: самые распространенные домашние питомцы.",
    "Грызуны: хомяки, морские свинки, крысы, шиншиллы, дегу, песчанки.",
    "Птицы: попугаи, канарейки, амадины и другие мелкие и крупные виды.",
    "Рептилии: сухопутные и водные черепахи, гекконы, игуаны, питоны и полозы.",
    "Мелкие хищники и необычные питомцы: хорьки, мини-пиги и другие животные для домашнего содержания.",
    "Амфибии и беспозвоночные: лягушки, тритоны, крупные пауки, скорпионы, улитки ахатины.",
    "Рыбы: аквариумные виды для домашнего содержания.",
  ],
  "Сельхоз животные": [
    "Крупный рогатый скот: коровы, быки.",
    "Мелкий рогатый скот: овцы, козы.",
    "Свиньи, лошади, ослы.",
    "Домашняя птица: куры, утки, гуси, индейки.",
    "Кролики и нутрии.",
  ],
  "Экзотические животные": [
    "Обезьяны и другие приматы.",
    "Крупные хищники: львы, тигры, медведи, если содержание разрешено законом и подтверждено документами.",
    "Различные виды копытных: олени, ламы, альпаки.",
    "Экзотические птицы: страусы, павлины.",
    "Дикие животные, которых иногда содержат как питомцев: лисы, волки, рыси и другие виды при наличии разрешающих документов.",
  ],
};

const subcategoryBulletPoints: Record<string, Record<string, string[]>> = {
  "tovary-dlya-detey": {
    Игрушки: [
      "куклы;",
      "фигурки животных и домашних питомцев;",
      "игрушки-предметы быта (мебель, посуда, бытовая техника);",
      "транспортные средства (машинки, самолеты, поезда, кораблики);",
      "театральные куклы и кукольные театры.",
    ],
    "Технические игрушки": [
      "строительные материалы и конструкторы (наборы деталей для сооружений и построек);",
      "игрушки, имитирующие бытовую технику (телефоны, пылесосы, стиральные машины);",
      "различные виды транспорта (легковые и грузовые автомобили, поезда, корабли, самолеты);",
      "игрушки-приборы (бинокли, фотоаппараты, подзорные трубы);",
      "роботы и робототехнические наборы.",
    ],
    "Дидактические игрушки": [
      "наборы для нанизывания (шнуровки, панели с кнопками);",
      "вкладыши и сортеры (комплекты с рамками и фигурами);",
      "головоломки (лабиринты, разрезные картинки, «Куб карбон»);",
      "конструкторы и сборные комплекты (матрешки, пирамидки);",
      "музыкальные игрушки (игровые панели с клавишами, металлофоны, ксилофоны);",
    ],
    "Спортивные (спортивно-моторные) игрушки": [
      "игрушки для развития мышц рук и пальцев (матрешки, пирамиды, чашечки);",
      "игрушки для укрепления мышц предплечья и плеча, развития координации (мячи, обручи, серсо, бильбоке);",
      "игрушки для развития навыков бега, прыжков, укрепления мышц ног и туловища (каталки, велосипеды, самокаты, скакалки, коньки);",
      "игрушки для развития меткости (ружья, пистолеты);",
      "игрушки для коллективных игр (настольный баскетбол, хоккей, пинг-понг).",
    ],
  },
  "odezhda-obuv-aksessuary": {
    Одежда: [
      "Верхняя одежда: куртки, пальто, плащи, ветровки, пуховики.",
      "Повседневная одежда: брюки, джинсы, рубашки, футболки, свитеры, кардиганы, худи, толстовки.",
      "Платья и сарафаны: для разных случаев — от повседневных до вечерних.",
      "Домашняя и спортивная одежда: халаты, пижамы, спортивные костюмы, трикотажные изделия.",
      "Нижнее белье и корсетные изделия: бюстгальтеры, трусы, корректирующее белье, корсеты.",
      "Одежда для детей, беременных, людей с большими размерами.",
    ],
    Обувь: [
      "Повседневная и деловая: туфли, лоферы, оксфорды, мокасины.",
      "Спортивная и активная: кроссовки, кеды, беговые модели, треккинговая обувь.",
      "Сезонная: сапоги, ботинки, дутики, валенки, летняя обувь (сандалии, босоножки, сланцы).",
      "Модная и трендовая: мюли, эспадрильи, казаки, челси, слипоны.",
    ],
    Аксессуары: [
      "Головные уборы: шапки, кепки, панамы, шляпы, береты.",
      "Сумки и рюкзаки: клатчи, шоперы, портфели, спортивные сумки.",
      "Ремни и пояса: классические, повседневные, с регулируемой длиной.",
      "Очки: солнцезащитные, имиджевые, для вождения.",
      "Перчатки и варежки: для разных сезонов.",
      "Шарфы, платки, снуды: для дополнения образа и защиты от холода.",
      "Бижутерия и украшения: браслеты, серьги, кольца, цепочки.",
      "Мелкие аксессуары: брелоки, кошельки, визитницы, ключницы.",
    ],
  },
};

const animalListingTitles: Record<string, string> = {
  "Домашние питомцы": "Домашний питомец с принадлежностями",
  "Сельхоз животные": "Сельхоз животные для хозяйства",
  "Экзотические животные": "Экзотическое животное с документами",
};

const animalListingDescriptions: Record<string, string> = {
  "Домашние питомцы": "Объявление для проверки раздела домашних питомцев: карточка, фильтры, открытие объявления и форма создания.",
  "Сельхоз животные": "Объявление для проверки раздела сельхоз животных: карточка, фильтры, открытие объявления и форма создания.",
  "Экзотические животные": "Объявление для проверки раздела экзотических животных. Для размещения требуются документы и соблюдение правил содержания.",
};

const animalListingPrices: Record<string, string> = {
  "Домашние питомцы": "по договоренности",
  "Сельхоз животные": "от 6 000 ₽",
  "Экзотические животные": "по договоренности",
};

const subcategoryDescriptions: Record<string, Record<string, string>> = {
  nedvizhimost: {
    "Продам недвижимость": "Квартиры, дома, участки и коммерческие объекты для продажи в Краснодаре и крае.",
    "Куплю недвижимость": "Запросы покупателей на жилье, участки и помещения с нужным районом, бюджетом и условиями сделки.",
    Аренда: "Жилье, комнаты, дома и помещения для краткосрочной или длительной аренды.",
    "Коммерческая недвижимость": "Офисы, торговые площади, склады, помещения свободного назначения и объекты для бизнеса.",
    "Жилье для путешествия": "Дома, квартиры, комнаты, гостевые объекты и варианты размещения для поездок и отдыха.",
  },
  elektronika: {
    Смартфоны: "Телефоны, аксессуары, обмен и покупка смартфонов у жителей и организаций рядом.",
    Ноутбуки: "Ноутбуки для работы, учебы, игр, комплектующие и предложения по ремонту или обмену.",
    Компьютеры: "Системные блоки, мониторы, периферия, комплектующие и готовые рабочие места.",
    "Аудио и видео": "Телевизоры, колонки, наушники, камеры, проекторы и домашняя мультимедиа.",
    "Игровые приставки": "Консоли, игры, геймпады, аксессуары и предложения по обмену игровых устройств.",
  },
  "antikvariat-i-kollektsii": {
    "Товары времен СССР": "Предметы быта, техника, значки, книги, посуда и коллекционные вещи советского периода.",
    "Картины и живопись": "Картины, графика, авторские работы, декоративная живопись и предметы для коллекций.",
  },
  transport: {
    "Продам авто": "Легковые автомобили, коммерческий транспорт и предложения от частных продавцов.",
    "Куплю авто": "Заявки на покупку автомобиля с желаемыми параметрами, бюджетом и городом сделки.",
    Мототехника: "Мотоциклы, скутеры, квадроциклы, экипировка и техника для активных поездок.",
  },
  biznes: {
    "Продам бизнес": "Готовые проекты, торговые точки, сервисы и активы для передачи новому владельцу.",
    "Куплю бизнес": "Запросы предпринимателей на покупку работающего дела, оборудования или доли.",
    Оборудование: "Профессиональное, торговое, производственное и офисное оборудование для бизнеса.",
    Партнерство: "Предложения совместных проектов, инвестиций, франшиз и делового сотрудничества.",
  },
  "krasota-i-uhod": {
    Парикмахеры: "Услуги стрижки, окрашивания, укладки, ухода за волосами и выездные мастера.",
    "Маникюр и педикюр": "Мастера ногтевого сервиса, уход, дизайн, коррекция и запись рядом с домом.",
  },
  meditsina: {
    "Медицинский персонал": "Медицинские специалисты, частные услуги, консультации и помощь по уходу.",
    "Уход на дому": "Сиделки, патронаж, помощь пожилым людям, сопровождение и бытовая поддержка.",
  },
  "mebel-i-interer": {
    Мебель: "Мебель для дома, дачи и офиса: продажа, покупка, обмен, изготовление и реставрация.",
  },
  "dlya-doma-i-dachi": {
    "Мебель для дома и дачи":
      "Для интерьера дачного дома подойдут простые, прочные и неприхотливые модели. На даче мебель должна быть модульной и трансформируемой, чтобы экономить место. Для улицы используют садовую мебель: комплекты из стола и стульев, диваны, кресла, шезлонги, качели. Материалы — пластик, металл, дерево, ротанговое волокно.",
    Освещение:
      "Для дома можно использовать люстры, торшеры, настольные и напольные светильники, бра, ночники. Для улицы подойдут прожекторы, гирлянды, фонари на солнечных батареях.",
    Декор:
      "Украсить интерьер и участок помогут вазы, кашпо, зеркала, плетёные корзины, ковры, подушки, покрывала, скатерти. Для сада можно использовать садовые фигуры, фонтаны, арки, ограждения, кормушки для птиц.",
    "Садовый инвентарь":
      "В эту категорию входят лопаты, грабли, секаторы, культиваторы, тачки, наборы инструментов. Для ухода за растениями пригодятся лейки, опрыскиватели, системы полива, шланги.",
    "Товары для бани и сауны": "К этой категории относятся печи, банный текстиль, экстракты и аксессуары для бани.",
    "Биотуалеты и умывальники":
      "Для дачи подойдут портативные биотуалеты с индикатором заполнения, а также дачные умывальники с раковиной и сливом.",
  },
  otdyh: {
    Турбазы: "Турбазы, гостевые дома и места отдыха с возможностью бронирования и связи с владельцем.",
    Гостиницы: "Гостиницы, номера, апартаменты и варианты размещения для поездок по краю.",
    Походы: "Походы, экскурсии, маршруты выходного дня, инструкторы и групповые выезды.",
  },
  rabota: {
    Вакансии: "Предложения работы от организаций и частных работодателей с контактами и условиями.",
    "Анкеты специалистов": "Профили исполнителей и специалистов, которые готовы принять заказ или выйти на работу.",
  },
  "remont-i-stroitelstvo": {
    "Ремонт квартир": "Мастера и бригады для ремонта квартир, домов, офисов и отдельных помещений.",
    Сантехника: "Сантехнические работы, монтаж, ремонт, аварийные вызовы и обслуживание оборудования.",
  },
  "sad-i-rasteniya": {
    "Цветы и саженцы": "Цветы, декоративные растения, плодовые саженцы и предложения для озеленения.",
    Рассада: "Рассада овощей, зелени, цветов и сезонные предложения для дачи и огорода.",
    Овощи: "Помидоры, огурцы, кабачки, морковь, свекла, капуста и другие овощные культуры для огорода.",
    Зелень: "Укроп, петрушка, базилик, шпинат и другая зелень для посадки, выращивания и продажи.",
    Корнеплоды: "Репа, редька, морковь, свекла и другие корнеплоды для посадки и урожая.",
    Бобовые: "Горох, фасоль и другие бобовые культуры для огорода и сезонной посадки.",
    "Садовый инвентарь": "Инструменты, техника, материалы и полезные товары для ухода за участком.",
    "Удобрения и средства защиты растений": "Удобрения, подкормки, средства от вредителей и болезней растений для сада и огорода.",
    "Системы полива": "Капельный, шланговый и другой полив, комплектующие и решения для ухода за растениями.",
    Мульча: "Материалы для мульчирования, сохранения влаги и защиты почвы от сорняков.",
    "Плодовые деревья": "Саженцы яблонь, груш, слив, черешни и других плодовых деревьев для сада.",
    "Ягодные кустарники": "Малина, смородина, крыжовник, жимолость и другие ягодные кустарники для участка.",
    "Декоративные цветы и растения": "Розы, тюльпаны, пионы, хризантемы и другие растения для украшения сада.",
    "Газоны, клумбы, альпийские горки, живые изгороди": "Растения, материалы и услуги для газонов, клумб, альпийских горок и живых изгородей.",
    "Элементы ландшафтного дизайна": "Пруды, каменные дорожки, беседки, перголы и другие элементы благоустройства участка.",
    "Места для отдыха": "Скамейки, шезлонги, мангалы и другие решения для зоны отдыха в саду или на даче.",
  },
  "tovary-dlya-detey": {
    Игрушки:
      "Это модели неодушевленных и одушевленных объектов, которые используются в сюжетных и ролевых играх. Они помогают детям познавать окружающий мир, развивать мышление, память, речь и эмоции. К ним относятся:",
    "Технические игрушки":
      "Знакомят детей с миром техники, внешним видом технических предметов (машины, механизмы, транспортные средства), а также с характерными для них действиями. К этой категории относятся:",
    "Дидактические игрушки":
      "Предназначены для умственного и сенсорного развития, обучения детей. В их конструкции или содержании заложены обучающие задачи. К дидактическим игрушкам относятся:",
    "Спортивные (спортивно-моторные) игрушки":
      "Способствуют физическому развитию детей, укреплению мышц, ловкости, координации движений. Среди них:",
  },
  "odezhda-obuv-aksessuary": {
    Одежда:
      "Раздел «Одежда, обувь и аксессуары» включает широкий ассортимент товаров для создания образа, комфорта и стиля. В него входят предметы гардероба, обувь для разных сезонов и случаев, а также аксессуары, дополняющие образ. К одежде относятся:",
    Обувь: "В этот раздел входит обувь для женщин, мужчин и детей, например:",
    Аксессуары: "К аксессуарам относятся:",
  },
  "tovary-i-veshchi": {
    "Выкройки и рукоделие": "Материалы, выкройки, handmade-изделия, инструменты и товары для творчества.",
  },
  "uslugi-dlya-doma": {
    Клининг: "Уборка квартир, домов, офисов, мойка окон, разовые и регулярные услуги по дому.",
  },
  raznoe: {
    Разное: "Объявления, которые не подошли к другим разделам, но могут быть полезны жителям рядом.",
  },
};

const categoryDescriptions: Record<string, string> = {
  "dlya-doma-i-dachi":
    "Раздел для дома и дачи включает товары для обустройства интерьера, садового участка, а также инструменты и аксессуары для ухода за растениями и территорией.",
};

function subcategoryWordCount(name: string) {
  return name.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
}

function getCategoryChildren(children: string[]) {
  return [...children].sort((left, right) => {
    const wordCountDiff = subcategoryWordCount(left) - subcategoryWordCount(right);

    return wordCountDiff || left.length - right.length || left.localeCompare(right, "ru");
  });
}

function subcategoryDescription(categorySlug: string, subcategory: string) {
  if (categorySlug === "ritualnye-uslugi") {
    return ritualServiceDescriptions[subcategory] ?? `Ритуальные услуги по направлению "${subcategory}" с возможностью связаться с исполнителем и разместить свое объявление.`;
  }

  if (categorySlug === "zhivotnye") {
    return animalListingDescriptions[subcategory] ?? `Объявления, предложения и запросы по разделу "${subcategory}" с контактами владельцев и исполнителей.`;
  }

  return (
    subcategoryDescriptions[categorySlug]?.[subcategory] ??
    `Объявления, предложения и запросы по подкатегории "${subcategory}" в Краснодаре и крае.`
  );
}

function coverageTitle(categorySlug: string, subcategory: string) {
  if (categorySlug === "ritualnye-uslugi") {
    return ritualServiceListingTitles[subcategory] ?? subcategory;
  }

  if (categorySlug === "zhivotnye") {
    return animalListingTitles[subcategory] ?? subcategory;
  }

  return `Контрольное объявление: ${subcategory}`;
}

function coverageDescription(categorySlug: string, subcategory: string) {
  if (categorySlug === "ritualnye-uslugi") {
    return ritualServiceDescriptions[subcategory] ?? `Услуги по направлению "${subcategory}".`;
  }

  if (categorySlug === "zhivotnye") {
    return animalListingDescriptions[subcategory] ?? `Объявление для проверки раздела "${subcategory}".`;
  }

  return `Проверочное объявление для подкатегории "${subcategory}". Нужно для контроля отображения, маршрутов, карточек и формы создания объявлений.`;
}

function coveragePrice(kind: ListingKind, categorySlug: string, index: number, subcategory?: string) {
  if (categorySlug === "ritualnye-uslugi" && subcategory) {
    return ritualServiceListingPrices[subcategory] ?? "по договоренности";
  }

  if (categorySlug === "zhivotnye" && subcategory) {
    return animalListingPrices[subcategory] ?? "по договоренности";
  }

  if (kind === "kuplyu") {
    return `до ${Math.round((12_000 + index * 1_700) / 100) * 100} ₽`;
  }

  if (kind === "arenda") {
    return `от ${Math.round((2_500 + index * 450) / 100) * 100} ₽/сутки`;
  }

  if (kind === "menyayu") {
    return "обмен";
  }

  if (kind === "otdam-darom") {
    return "бесплатно";
  }

  if (categorySlug === "nedvizhimost") {
    return `${Math.round((4_500_000 + index * 220_000) / 10_000) * 10_000} ₽`;
  }

  return `${Math.round((3_500 + index * 850) / 100) * 100} ₽`;
}

function coverageBooking(categorySlug: string, subcategorySlug: string, index: number): BookingDetails | undefined {
  if (categorySlug !== "otdyh" && categorySlug !== "nedvizhimost") {
    return undefined;
  }

  if (subcategorySlug === "pohody") {
    return {
      mode: "tour",
      pricePerPerson: 2800 + index * 150,
      maxGuests: 12,
      tourDate: "2026-07-12",
      tourTime: "09:30",
      tourDuration: "1 день",
      tourDifficulty: "Средняя",
      tourMeetingPoint: "Краснодар, сбор у центрального входа",
      included: "Инструктор, маршрут, перекус и групповая аптечка.",
      rules: "Нужна удобная обувь, вода и подтверждение участия.",
    };
  }

  return {
    mode: "stay",
    priceWeekday: 2500 + index * 300,
    priceWeekend: 3500 + index * 350,
    minNights: 1,
    includedGuests: 2,
    maxGuests: 6,
    extraGuestPrice: 600,
    availableFrom: "2026-06-01",
    availableTo: "2026-09-30",
    blockedDates: ["2026-06-18", "2026-06-19"],
    checkInTime: "14:00",
    checkOutTime: "12:00",
    included: "Базовые удобства, парковка и связь с владельцем.",
    rules: "Бронь подтверждается после согласования с владельцем.",
  };
}

function createCoverageListings(existingListings: DemoListing[]): DemoListing[] {
  const coveredSubcategories = new Set(existingListings.map((listing) => `${listing.categorySlug}/${listing.subcategorySlug}`));
  const tones: DemoListing["imageTone"][] = ["blue", "green", "rose", "amber", "violet"];
  let index = 0;

  return categories.flatMap((category) => {
    if (category.slug === "yarmarka-masterov" || !category.children.length) {
      return [];
    }

    return category.children.flatMap((subcategory) => {
      const subcategorySlug = slugifySubcategory(subcategory);
      const key = `${category.slug}/${subcategorySlug}`;

      if (coveredSubcategories.has(key)) {
        return [];
      }

      index += 1;
      const kind = inferListingKind(category.slug, subcategorySlug);
      const city = index % 4 === 0 ? "Сочи" : index % 3 === 0 ? "Анапа" : "Краснодар";

      return [
        {
          slug: `kontrol-${category.slug}-${subcategorySlug}`,
          title: coverageTitle(category.slug, subcategory),
          kind,
          categorySlug: category.slug,
          categoryName: category.name,
          subcategorySlug,
          subcategoryName: subcategory,
          city,
          district: "Центр",
          lat: 45.037 + index * 0.002,
          lng: 38.975 + index * 0.002,
          showExactAddress: false,
          price: coveragePrice(kind, category.slug, index, subcategory),
          booking: kind === "arenda" ? coverageBooking(category.slug, subcategorySlug, index) : undefined,
          description: coverageDescription(category.slug, subcategory),
          phone: "+78610009999",
          messengerUrl: "https://t.me/blizhniy_support",
          status: "published",
          paid: true,
          createdAt: "29 мая 2026",
          publishedAt: "29 мая 2026",
          expiresAt: "28 июня 2026",
          imageTone: tones[index % tones.length],
        },
      ];
    });
  });
}

export const demoListings: DemoListing[] = [...baseDemoListings, ...createCoverageListings(baseDemoListings)];

export function listDemoListings() {
  return demoListings.map((listing) => ({
    ...listing,
    status: getListingStatusOverride(listing.slug) ?? listing.status,
  }));
}

export function listPublicDemoListings() {
  return [...listDemoListings(), ...listListings().map(toDemoListing)].filter((listing) => listing.status === "published");
}

function parseCoordinate(formData: FormData, name: string) {
  const rawValue = String(formData.get(name) ?? "").trim();

  if (!rawValue) {
    return undefined;
  }

  const value = Number(rawValue.replace(",", "."));
  return Number.isFinite(value) ? value : undefined;
}

function inferCityFromFormData(formData: FormData, fallback = "Краснодар") {
  const location = String(formData.get("location") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();

  return location.split(",")[0]?.trim() || cities.find((city) => address.toLowerCase().includes(city.name.toLowerCase()))?.name || fallback;
}

function hasListingMapPoint(listing: DemoListing) {
  return (listing.hasMapPoint ?? true) && hasMapCoordinates(listing.lat, listing.lng);
}

function listingPlaceLabel(listing: DemoListing) {
  if (hasListingMapPoint(listing)) {
    return listing.address || [listing.city, listing.district].filter(Boolean).join(", ");
  }

  return listing.city;
}

function formatListingDateOnly(value?: string) {
  const normalized = value?.trim();

  if (!normalized) {
    return "";
  }

  const parsed = new Date(normalized);

  if (!Number.isNaN(parsed.getTime())) {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "long",
      timeZone: "Europe/Moscow",
      year: "numeric",
    }).format(parsed);
  }

  return formatPublicationDateTime(normalized).replace(/,\s*\d{2}:\d{2}$/, "").replace(/\s+в\s+\d{2}:\d{2}$/, "");
}

function listingSellerName(listing: DemoListing) {
  return sellerDisplayName(listing);
}

function listingSellerKey(listing: DemoListing) {
  return sellerProfileKey(listing);
}

const russianMonths: Record<string, number> = {
  января: 0,
  февраля: 1,
  марта: 2,
  апреля: 3,
  мая: 4,
  июня: 5,
  июля: 6,
  августа: 7,
  сентября: 8,
  октября: 9,
  ноября: 10,
  декабря: 11,
};

function dateSortValue(value: string) {
  const isoTime = Date.parse(value);

  if (Number.isFinite(isoTime)) {
    return isoTime;
  }

  const match = value.match(/^(\d{1,2})\s+([а-я]+)\s+(\d{4})$/i);

  if (match) {
    const [, day, month, year] = match;
    const monthIndex = russianMonths[month.toLowerCase()];

    if (monthIndex !== undefined) {
      return new Date(Number(year), monthIndex, Number(day)).getTime();
    }
  }

  return Number.POSITIVE_INFINITY;
}

function formatSellerDate(value: string) {
  const isoTime = Date.parse(value);

  if (Number.isFinite(isoTime) && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(new Date(isoTime));
  }

  return value;
}

function listingSellerStats(listing: DemoListing) {
  const sellerKey = listingSellerKey(listing);
  const allListings = [...listDemoListings(), ...listListings().map(toDemoListing)];
  const sellerListings = allListings.filter((item) => listingSellerKey(item) === sellerKey);
  const firstListing = sellerListings
    .filter((item) => Number.isFinite(dateSortValue(item.createdAt)))
    .sort((a, b) => dateSortValue(a.createdAt) - dateSortValue(b.createdAt))[0];

  return {
    listingCount: sellerListings.length || 1,
    soldCount: sellerListings.filter((item) => item.status === "sold").length,
    registeredSince: formatSellerDate(firstListing?.createdAt ?? listing.createdAt),
  };
}

function parseNumber(formData: FormData, name: string) {
  const value = Number(String(formData.get(name) ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function parseDateList(formData: FormData, name: string) {
  return String(formData.get(name) ?? "")
    .split(/[\n,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function todayInputValue() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function normalizeFutureDate(value: string) {
  const date = value.trim();

  if (!date) {
    return "";
  }

  return date < todayInputValue() ? todayInputValue() : date;
}

function normalizeEndDate(value: string, startDate: string) {
  const date = value.trim();

  if (!date) {
    return "";
  }

  const minDate = startDate || todayInputValue();
  return date < minDate ? minDate : date;
}

function parseFutureDateList(formData: FormData, name: string) {
  const today = todayInputValue();

  return parseDateList(formData, name).filter((date) => date >= today);
}

function isBookingCategory(categorySlug: string) {
  return categorySlug === "otdyh" || categorySlug === "nedvizhimost";
}

function parseBookingDetails(formData: FormData, categorySlug: string): BookingDetails | undefined {
  if (!isBookingCategory(categorySlug)) {
    return undefined;
  }

  const mode: BookingDetails["mode"] = String(formData.get("bookingMode") ?? "stay") === "tour" ? "tour" : "stay";

  if (mode === "tour") {
    return {
      mode,
      pricePerPerson: parseNumber(formData, "bookingPricePerPerson"),
      maxGuests: parseNumber(formData, "bookingMaxGuests"),
      tourDate: normalizeFutureDate(String(formData.get("tourDate") ?? "")),
      tourTime: String(formData.get("tourTime") ?? "").trim(),
      tourDuration: String(formData.get("tourDuration") ?? "").trim(),
      tourDifficulty: String(formData.get("tourDifficulty") ?? "").trim(),
      tourMeetingPoint: String(formData.get("tourMeetingPoint") ?? "").trim(),
      included: String(formData.get("bookingIncluded") ?? "").trim(),
      rules: String(formData.get("bookingRules") ?? "").trim(),
    };
  }

  const availableFrom = normalizeFutureDate(String(formData.get("bookingAvailableFrom") ?? ""));

  return {
    mode,
    priceWeekday: parseNumber(formData, "bookingPriceWeekday"),
    priceWeekend: parseNumber(formData, "bookingPriceWeekend"),
    minNights: parseNumber(formData, "bookingMinNights"),
    includedGuests: parseNumber(formData, "bookingIncludedGuests"),
    maxGuests: parseNumber(formData, "bookingMaxGuests"),
    extraGuestPrice: parseNumber(formData, "bookingExtraGuestPrice"),
    availableFrom,
    availableTo: normalizeEndDate(String(formData.get("bookingAvailableTo") ?? ""), availableFrom),
    blockedDates: parseFutureDateList(formData, "bookingBlockedDates"),
    checkInTime: String(formData.get("bookingCheckIn") ?? "").trim(),
    checkOutTime: String(formData.get("bookingCheckOut") ?? "").trim(),
    included: String(formData.get("bookingIncluded") ?? "").trim(),
    rules: String(formData.get("bookingRules") ?? "").trim(),
  };
}

function parseDeliveryOptions(formData: FormData, fallbackCity: string): DeliveryOptions | undefined {
  if (String(formData.get("deliveryEnabled") ?? "") !== "1") {
    return undefined;
  }

  const selectedServices = formData
    .getAll("deliveryServices")
    .map((item) => String(item))
    .filter((item): item is DeliveryServiceId => deliveryServices.some((service) => service.id === item));
  const payer = String(formData.get("deliveryPayer") ?? "buyer");

  return {
    enabled: true,
    services: selectedServices.length ? selectedServices : ["other"],
    payer: payer === "seller" || payer === "split" ? payer : "buyer",
    originCity: String(formData.get("deliveryOriginCity") ?? "").trim() || fallbackCity,
    packageWeightGram: parseNumber(formData, "deliveryWeightGram"),
    packageLengthCm: parseNumber(formData, "deliveryLengthCm"),
    packageWidthCm: parseNumber(formData, "deliveryWidthCm"),
    packageHeightCm: parseNumber(formData, "deliveryHeightCm"),
    handlingDays: parseNumber(formData, "deliveryHandlingDays"),
    comment: String(formData.get("deliveryComment") ?? "").trim() || undefined,
  };
}

function listingImageTone(tone: StoreListing["imageTone"]): DemoListing["imageTone"] {
  if (tone === "emerald") {
    return "green";
  }

  if (tone === "slate") {
    return "blue";
  }

  return tone;
}

function listingCategoryName(listing: StoreListing) {
  return categories.find((category) => category.slug === listing.categorySlug)?.name ?? listing.subcategory;
}

export function toDemoListing(listing: StoreListing): DemoListing {
  return {
    viewId: listing.id,
    slug: listing.slug,
    author: listing.author,
    title: listing.title,
    kind: listing.kind,
    categorySlug: listing.categorySlug,
    categoryName: listingCategoryName(listing),
    subcategorySlug: slugifySubcategory(listing.subcategory),
    subcategoryName: listing.subcategory,
    city: listing.city,
    district: listing.district ?? listing.address ?? "",
    address: listing.address,
    lat: listing.lat,
    lng: listing.lng,
    hasMapPoint: Boolean(listing.hasMapPoint),
    showExactAddress: Boolean(listing.hasMapPoint && listing.address) || listing.showExactAddress,
    price: listing.price ?? "по договоренности",
    images: listing.images,
    booking: listing.booking,
    delivery: listing.delivery,
    description: listing.description,
    phone: listing.phone,
    email: listing.email,
    messengerUrl: listing.messengerUrl,
    status: listing.status,
    paid: listing.paid,
    createdAt: listing.publishedAt,
    publishedAt: listing.publishedAt,
    expiresAt: listing.expiresAt,
    imageTone: listingImageTone(listing.imageTone),
  };
}

export function findListingBySlug(slug?: string) {
  if (!slug) {
    return undefined;
  }

  const localListing = listDemoListings().find((item) => item.slug === slug);

  if (localListing) {
    return localListing;
  }

  const storeListing = listListings().find((item) => item.slug === slug || item.id === slug);
  return storeListing ? toDemoListing(storeListing) : undefined;
}

export function slugifySubcategory(name: string) {
  const map: Record<string, string> = {
    "Товары времен СССР": "tovary-vremen-sssr",
    "Картины и живопись": "kartiny-i-zhivopis",
    "Продам недвижимость": "prodam-nedvizhimost",
    "Куплю недвижимость": "kuplyu-nedvizhimost",
    Аренда: "arenda",
    "Коммерческая недвижимость": "kommercheskaya-nedvizhimost",
    "Жилье для путешествия": "zhile-dlya-puteshestviya",
    Смартфоны: "smartfony",
    Ноутбуки: "noutbuki",
    Компьютеры: "kompyutery",
    "Аудио и видео": "audio-i-video",
    "Игровые приставки": "igrovye-pristavki",
    "Продам авто": "prodam-avto",
    "Куплю авто": "kuplyu-avto",
    Мототехника: "mototehnika",
    "Продам бизнес": "prodam-biznes",
    "Куплю бизнес": "kuplyu-biznes",
    Оборудование: "oborudovanie",
    Партнерство: "partnerstvo",
    "Организация и проведение обряда прощания": "organizatsiya-i-provedenie-obryada-proshchaniya",
    "Захоронение и сопутствующие работы": "zahoronenie-i-soputstvuyushchie-raboty",
    Кремация: "krematsiya",
    "Продажа и изготовление похоронных принадлежностей": "prodazha-i-izgotovlenie-pohoronnyh-prinadlezhnostey",
    Игрушки: "igrushki",
    "Технические игрушки": "tehnicheskie-igrushki",
    "Дидактические игрушки": "didakticheskie-igrushki",
    "Спортивные (спортивно-моторные) игрушки": "sportivnye-sportivno-motornye-igrushki",
    Одежда: "odezhda",
    Обувь: "obuv",
    Аксессуары: "aksessuary",
    "Изготовление, установка и демонтаж намогильных сооружений":
      "izgotovlenie-ustanovka-demontazh-namogilnyh-sooruzheniy",
    "Уход за местом захоронения": "uhod-za-mestom-zahoroneniya",
    "Транспортирование останков": "transportirovanie-ostankov",
    "Предпохоронное содержание останков": "predpohoronnoe-soderzhanie-ostankov",
    "Подготовка тела к погребению": "podgotovka-tela-k-pogrebeniyu",
    "Домашние питомцы": "domashnie-pitomtsy",
    "Сельхоз животные": "selhoz-zhivotnye",
    "Экзотические животные": "ekzoticheskie-zhivotnye",
    Парикмахеры: "parikmahery",
    "Маникюр и педикюр": "manikyur-i-pedikyur",
    "Медицинский персонал": "meditsinskiy-personal",
    "Уход на дому": "uhod-na-domu",
    Мебель: "mebel",
    "Мебель для дома и дачи": "mebel-dlya-doma-i-dachi",
    Освещение: "osveshchenie",
    Декор: "dekor",
    "Товары для бани и сауны": "tovary-dlya-bani-i-sauny",
    "Биотуалеты и умывальники": "biotualety-i-umyvalniki",
    Турбазы: "turbazy",
    Гостиницы: "gostinitsy",
    Походы: "pohody",
    Вакансии: "vakansii",
    "Анкеты специалистов": "ankety-spetsialistov",
    "Ремонт квартир": "remont-kvartir",
    Сантехника: "santehnika",
    "Цветы и саженцы": "tsvety-i-sazhentsy",
    "Выкройки и рукоделие": "vykroyki-i-rukodelie",
    Клининг: "klining",
    Рассада: "rassada",
    Овощи: "ovoshchi",
    Зелень: "zelen",
    Корнеплоды: "korneplody",
    Бобовые: "bobovye",
    "Садовый инвентарь": "sadovyy-inventar",
    "Удобрения и средства защиты растений": "udobreniya-i-sredstva-zashchity-rasteniy",
    "Системы полива": "sistemy-poliva",
    Мульча: "mulcha",
    "Плодовые деревья": "plodovye-derevya",
    "Ягодные кустарники": "yagodnye-kustarniki",
    "Декоративные цветы и растения": "dekorativnye-tsvety-i-rasteniya",
    "Газоны, клумбы, альпийские горки, живые изгороди": "gazony-klumby-alpiyskie-gorki-zhivye-izgorodi",
    "Элементы ландшафтного дизайна": "elementy-landshaftnogo-dizayna",
    "Места для отдыха": "mesta-dlya-otdyha",
    Разное: "raznoe",
  };

  return map[name] ?? name.toLowerCase().replaceAll(" ", "-");
}

function Breadcrumbs({ items, compact = false }: { items: { label: string; href?: string }[]; compact?: boolean }) {
  return (
    <nav className={`${compact ? "mb-2" : "mb-4"} flex flex-wrap items-center gap-2 text-xs text-slate-500 sm:text-sm`} aria-label="Хлебные крошки">
      <Link href="/obyavleniya/prodam" className="hover:text-[#0875d1]">
        Краснодар
      </Link>
      {items.map((item, index) => (
        <span key={`${item.href ?? item.label}-${index}`} className="flex items-center gap-2">
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

export function CategoriesPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <HomeHero />
        <section className="page-container py-2 sm:py-3 lg:py-4">
          <Breadcrumbs items={[{ label: "Категории" }]} />
          <BackLink fallbackHref="/" className="mt-1 inline-flex items-center gap-2 text-sm font-bold text-[#0875d1]">
            Назад
          </BackLink>
          <h1 className="mt-3 text-2xl font-black leading-tight text-[#060b27] sm:text-3xl lg:text-4xl">Категории объявлений</h1>
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
  const listings = listPublicDemoListings().filter((listing) => listing.kind === kind);
  const primaryKinds = listingKinds.filter((item) => item.slug === "prodam" || item.slug === "kuplyu");
  const exchangeKinds = listingKinds.filter((item) => item.slug === "menyayu" || item.slug === "otdam-darom");
  const visibleKinds = kind === "prodam" || kind === "kuplyu" ? primaryKinds : exchangeKinds;

  return (
    <>
      <SiteHeader />
      <main className="page-container py-6 sm:py-8 lg:py-10">
        <Breadcrumbs items={[{ label: current.title }]} />
        <BackLink fallbackHref="/" className="mt-1 inline-flex items-center gap-2 text-sm font-bold text-[#0875d1]">
          Назад
        </BackLink>
        <div className="grid gap-7">
          <section>
            <div className="flex flex-wrap items-end justify-between gap-3 sm:gap-4">
              <div>
                <ListingKindBadge kind={kind} />
                <h1 className="mt-3 text-2xl font-black leading-tight text-[#060b27] sm:text-3xl lg:mt-4 lg:text-4xl">{current.title} в Краснодаре</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 sm:mt-3 sm:text-base sm:leading-7 lg:mt-4 lg:text-lg lg:leading-8">{current.description}</p>
              </div>
              <Link
                href={`/razmestit/obyavlenie?kind=${kind}`}
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
                  href={`/katalog/${item.slug}`}
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
                  href="/obyavleniya/obmen-i-darom"
                  className="inline-flex h-8 items-center rounded-full border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition hover:border-blue-200 hover:text-[#0875d1] sm:h-9 sm:text-sm lg:h-10 lg:px-4"
                >
                  Меняю и отдам даром
                </Link>
              ) : null}
            </div>
            <ListingResultsPanel kind={kind} listings={listings} />
          </section>
        </div>
      </main>
    </>
  );
}

export function ExchangeAndFreePage() {
  const listings = listPublicDemoListings().filter((listing) => listing.kind === "menyayu" || listing.kind === "otdam-darom");

  return (
    <>
      <SiteHeader />
      <HomeHero />
      <main className="page-container py-2 sm:py-3 lg:py-4">
        <Breadcrumbs items={[{ label: "Меняю и отдам даром" }]} />
        <BackLink fallbackHref="/" className="mt-1 inline-flex items-center gap-2 text-sm font-bold text-[#0875d1]">
          Назад
        </BackLink>
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
                href="/razmestit/obyavlenie?kind=menyayu"
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
                    href={`/katalog/${item.slug}`}
                    className="inline-flex h-8 items-center rounded-full border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition hover:border-blue-200 hover:text-[#0875d1] sm:h-9 sm:text-sm lg:h-10 lg:px-4"
                  >
                    {item.title}
                  </Link>
                ))}
            </div>
            <ListingResultsPanel kind={["menyayu", "otdam-darom"]} listings={listings} />
          </section>
        </div>
      </main>
    </>
  );
}

export function CategoryListingsPage({ categorySlug, subcategorySlug }: { categorySlug: string; subcategorySlug?: string }) {
  const category = categories.find((item) => item.slug === categorySlug);
  const categoryChildren = category ? getCategoryChildren(category.children) : [];
  const subcategory = category?.children.find((item) => slugifySubcategory(item) === subcategorySlug);
  const listings = listPublicDemoListings().filter(
    (listing) => listing.categorySlug === categorySlug && (!subcategorySlug || listing.subcategorySlug === subcategorySlug),
  );
  const isKidsGoodsCategory = category?.slug === "tovary-dlya-detey";
  const categoryDescription = category ? categoryDescriptions[category.slug] : undefined;
  const backFallbackHref = subcategory && category ? `/katalog/${category.slug}` : "/katalog";

  return (
    <>
      <SiteHeader />
      <HomeHero />
      <main className="page-container py-2 sm:py-3 lg:py-4">
        <Breadcrumbs
          compact
          items={[
            { label: "Категории", href: "/katalog" },
            { label: category?.name ?? "Категория", href: category ? `/katalog/${category.slug}` : undefined },
            ...(subcategory ? [{ label: subcategory }] : []),
          ]}
        />
        <BackLink fallbackHref={backFallbackHref} className="mt-1 inline-flex items-center gap-2 text-sm font-bold text-[#0875d1]">
          Назад
        </BackLink>
        <div className="grid gap-3">
          <section>
            <h1 className="[overflow-wrap:anywhere] text-2xl font-black leading-tight text-[#060b27] sm:text-3xl lg:text-4xl">
              {subcategory ?? category?.name ?? "Категория"}
            </h1>
            {categoryDescription && !subcategory ? (
              <p className="mt-2 max-w-4xl text-sm font-medium leading-6 text-slate-600 sm:mt-3 sm:text-base sm:leading-7">
                {categoryDescription}
              </p>
            ) : null}
            {category ? (
              <div
                className={
                  isKidsGoodsCategory
                    ? "mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2 sm:gap-2 lg:grid-cols-4"
                    : "mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5"
                }
              >
                {categoryChildren.map((child, index) => {
                  const href = `/katalog/${category.slug}/${slugifySubcategory(child)}`;
                  const description = subcategoryDescription(category.slug, child);
                  const animalClassifier = category.slug === "zhivotnye" ? animalClassifiers[child] : undefined;
                  const bulletPoints = subcategoryBulletPoints[category.slug]?.[child];
                  const shouldSpanTwoColumns =
                    category.slug === "ritualnye-uslugi" && categoryChildren.length % 2 === 1 && index === categoryChildren.length - 1;
                  const shouldSpanKidsColumns = category.slug === "tovary-dlya-detey" && child === "Спортивные (спортивно-моторные) игрушки";
                  const spanClassName = [
                    shouldSpanTwoColumns ? "sm:col-span-2 md:col-span-1" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");

                  return (
                    <details
                      key={child}
                      className={`group min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition open:border-blue-200 ${isKidsGoodsCategory ? "p-2 sm:p-2.5 lg:p-3" : "p-2.5 sm:p-3"} ${spanClassName}`}
                    >
                      <summary className={`flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden ${isKidsGoodsCategory ? "min-h-9" : ""}`}>
                        <span
                          className={`block break-words font-bold text-slate-800 [overflow-wrap:anywhere] ${
                            isKidsGoodsCategory ? "text-[13px] leading-4 sm:text-sm sm:leading-5 lg:text-[15px] lg:leading-5" : "text-sm leading-5 sm:text-[15px]"
                          } ${shouldSpanKidsColumns ? "lg:text-[12.5px] lg:leading-4 xl:text-[13.5px] xl:leading-5 2xl:text-sm 2xl:leading-5 2xl:whitespace-nowrap" : ""}`}
                        >
                          {child}
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-90 group-open:text-[#0875d1]" />
                      </summary>
                      <p className="mt-2 break-words text-xs font-medium leading-5 text-slate-600 [overflow-wrap:anywhere] sm:text-sm">{description}</p>
                      {bulletPoints ? (
                        <ul className="mt-2 grid gap-1.5 text-xs font-medium leading-5 text-slate-600 sm:text-sm">
                          {bulletPoints.map((item) => (
                            <li key={item} className="flex gap-2">
                              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#0875d1]" />
                              <span className="break-words [overflow-wrap:anywhere]">{item}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {animalClassifier ? (
                        <ul className="mt-2 grid gap-1.5 text-xs font-medium leading-5 text-slate-600 sm:text-sm">
                          {animalClassifier.map((item) => (
                            <li key={item} className="flex gap-2">
                              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#0875d1]" />
                              <span className="break-words [overflow-wrap:anywhere]">{item}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        <Link
                          href={href}
                          className="inline-flex h-9 min-w-0 items-center justify-center rounded-lg border border-blue-100 text-[#0875d1] transition hover:border-blue-200 hover:bg-blue-50 hover:text-[#0664b3]"
                          aria-label={`Открыть объявления: ${child}`}
                          title="Объявления"
                        >
                          <ClipboardList className="h-5 w-5 shrink-0" />
                        </Link>
                        <Link
                          href={getCreateListingHref(category.slug, child)}
                          className="inline-flex h-9 min-w-0 items-center justify-center rounded-lg bg-[#0aa337] text-white transition hover:bg-[#078a2e]"
                          aria-label={`Разместить объявление: ${child}`}
                          title="Разместить"
                        >
                          <BadgePlus className="h-5 w-5 shrink-0" />
                        </Link>
                        <SubcategoryShareButton href={href} title={child} />
                      </div>
                    </details>
                  );
                })}
              </div>
            ) : null}
            <ListingResultsPanel categorySlug={categorySlug} listings={listings} subcategorySlug={subcategorySlug} />
          </section>
        </div>
      </main>
    </>
  );
}

function DeliveryInfoCard({ delivery }: { delivery?: DeliveryOptions }) {
  if (!delivery?.enabled) {
    return null;
  }

  const serviceNames = delivery.services.map((serviceId) => deliveryServices.find((service) => service.id === serviceId)?.label ?? serviceId);
  const packageSize =
    delivery.packageLengthCm || delivery.packageWidthCm || delivery.packageHeightCm
      ? [delivery.packageLengthCm, delivery.packageWidthCm, delivery.packageHeightCm].map((value) => value ?? "-").join(" x ")
      : undefined;

  return (
    <div className="min-w-0 rounded-xl border border-blue-100 bg-blue-50/60 p-4 shadow-sm sm:p-5">
      <div className="flex items-start gap-3">
        <PackageCheck className="mt-1 h-5 w-5 shrink-0 text-[#0875d1]" />
        <div className="min-w-0">
          <p className="font-black text-[#060b27]">Доставка</p>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            Возможна отправка через: <span className="font-bold">{serviceNames.join(", ")}</span>.
          </p>
          <dl className="mt-3 grid gap-2 text-sm text-slate-700">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Оплата</dt>
              <dd className="text-right font-bold">{deliveryPayerLabels[delivery.payer]}</dd>
            </div>
            {delivery.originCity ? (
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Отправка из</dt>
                <dd className="text-right font-bold">{delivery.originCity}</dd>
              </div>
            ) : null}
            {delivery.packageWeightGram ? (
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Вес</dt>
                <dd className="text-right font-bold">{delivery.packageWeightGram} г</dd>
              </div>
            ) : null}
            {packageSize ? (
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Габариты</dt>
                <dd className="text-right font-bold">{packageSize} см</dd>
              </div>
            ) : null}
            {delivery.handlingDays ? (
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Подготовка</dt>
                <dd className="text-right font-bold">{delivery.handlingDays} дн.</dd>
              </div>
            ) : null}
          </dl>
          {delivery.comment ? <p className="mt-3 text-sm leading-6 text-slate-600">{delivery.comment}</p> : null}
        </div>
      </div>
    </div>
  );
}

export function ListingDetailPage({ slug, listingOverride }: { slug: string; listingOverride?: DemoListing }) {
  const listing = listingOverride ?? findListingBySlug(slug);
  const listingHref = `/obyavlenie/${listing?.slug ?? slug}`;

  if (!listing) {
    return (
      <>
        <SiteHeader />
        <DemoListingDetailClient slug={slug} />
      </>
    );
  }

  if (listing.status !== "published") {
    notFound();
  }

  const hasMapPoint = hasListingMapPoint(listing);
  const viewId = listing.viewId ?? listing.slug;
  const sellerStats = listingSellerStats(listing);
  const contactCount = [listing.phone, listing.email, listing.messengerUrl].filter(Boolean).length;
  const actionCount = contactCount + 1;
  const actionGridClass = actionCount >= 4 ? "grid-cols-[repeat(4,minmax(104px,1fr))]" : actionCount === 3 ? "grid-cols-3" : actionCount === 2 ? "grid-cols-2" : "grid-cols-1";
  const galleryMedia: ListingGalleryMedia[] = (listing.images ?? []).map((src) => ({ kind: "image", src }));

  return (
    <>
      <SiteHeader />
      <ListingViewTracker listingId={viewId} />
      <main className="page-container py-10">
        <Breadcrumbs
          items={[
            { label: listing.categoryName, href: `/katalog/${listing.categorySlug}` },
            { label: listing.subcategoryName, href: `/katalog/${listing.categorySlug}/${listing.subcategorySlug}` },
            { label: listing.title },
          ]}
        />
        <div className="mx-auto grid max-w-[1180px] min-w-0 gap-5 sm:gap-7 lg:grid-cols-[minmax(0,768px)_minmax(320px,380px)] lg:items-start lg:justify-center">
          <section className="min-w-0 lg:max-w-3xl">
            <BackLink fallbackHref={`/katalog/${listing.kind}`} className="inline-flex items-center gap-2 text-sm font-bold text-[#0875d1]">
              Назад к разделу
            </BackLink>
            <h1 className="[overflow-wrap:anywhere] mt-3 text-xl font-black leading-tight text-[#060b27] sm:mt-4 sm:text-3xl lg:text-4xl">{listing.title}</h1>
            <div className="mt-3 flex flex-wrap gap-2">
              <ListingKindBadge kind={listing.kind} />
              <StatusBadge status={listing.status} />
            </div>
            <ListingMediaGallery media={galleryMedia} title={listing.title} />
            <div className="mt-5 min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:mt-7 sm:p-6">
              <h2 className="text-lg font-black text-[#060b27] sm:text-xl">Описание</h2>
              <p className="mt-2 [overflow-wrap:anywhere] text-sm leading-6 text-slate-700 sm:mt-3 sm:text-base sm:leading-7">{listing.description}</p>
              <dl className="mt-5 grid min-w-0 gap-3 sm:mt-6 sm:grid-cols-2 sm:gap-4">
                <div className="min-w-0 rounded-lg bg-slate-50 p-3 sm:p-4">
                  <dt className="text-sm font-bold text-slate-500">Категория</dt>
                  <dd className="mt-1 [overflow-wrap:anywhere] font-semibold text-slate-900">{listing.categoryName}</dd>
                </div>
                <div className="min-w-0 rounded-lg bg-slate-50 p-3 sm:p-4">
                  <dt className="text-sm font-bold text-slate-500">Подкатегория</dt>
                  <dd className="mt-1 [overflow-wrap:anywhere] font-semibold text-slate-900">{listing.subcategoryName}</dd>
                </div>
                <div className="min-w-0 rounded-lg bg-slate-50 p-3 sm:p-4">
                  <dt className="text-sm font-bold text-slate-500">Размещено</dt>
                  <dd className="mt-1 [overflow-wrap:anywhere] font-semibold text-slate-900">{formatPublicationDateTime(listing.publishedAt)}</dd>
                </div>
                <div className="min-w-0 rounded-lg bg-slate-50 p-3 sm:p-4">
                  <dt className="text-sm font-bold text-slate-500">Активно до</dt>
                  <dd className="mt-1 [overflow-wrap:anywhere] font-semibold text-slate-900">{formatListingDateOnly(listing.expiresAt)}</dd>
                </div>
              </dl>
            </div>
          </section>

          <aside className="min-w-0 space-y-4">
            <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3 shadow-card sm:p-4">
              <p className="[overflow-wrap:anywhere] text-xl font-black text-[#060b27] sm:text-2xl">{listing.price}</p>
              {!hasMapPoint ? (
                <p className="mt-3 flex min-w-0 items-start gap-2 text-slate-600">
                  <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-[#0875d1]" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{listingPlaceLabel(listing)}</span>
                </p>
              ) : null}
              <div className="mt-4 grid gap-2">
                <div className={`grid min-w-0 gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${actionGridClass}`}>
                  {listing.phone ? (
                    <a href={`tel:${listing.phone}`} className="inline-flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-lg bg-[#0aa337] px-2 text-xs font-bold text-white shadow-sm shadow-emerald-100 transition hover:bg-[#078a2e] sm:text-sm">
                      <Phone className="h-4 w-4 shrink-0" />
                      <span className="truncate">Позвонить</span>
                    </a>
                  ) : null}
                  {listing.email ? (
                    <a href={`mailto:${listing.email}`} className="inline-flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-[#0875d1] bg-white px-2 text-xs font-bold text-[#0875d1] shadow-sm shadow-blue-50 transition hover:bg-blue-50 sm:text-sm">
                      <Mail className="h-4 w-4 shrink-0" />
                      <span className="truncate">Email</span>
                    </a>
                  ) : null}
                  {listing.messengerUrl ? (
                    <a
                      href={listing.messengerUrl}
                      className="inline-flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-[#0875d1] bg-white px-2 text-xs font-bold text-[#0875d1] shadow-sm shadow-blue-50 transition hover:bg-blue-50 sm:text-sm"
                    >
                      <MessageCircle className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 truncate">Сообщение</span>
                    </a>
                  ) : null}
                  <ListingShareButton
                    href={listingHref}
                    title={listing.title}
                    textBreakpoint="always"
                    className="inline-flex h-10 min-w-0 items-center justify-center gap-1.5 overflow-hidden rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold text-slate-800 transition hover:border-blue-200 hover:bg-blue-50 hover:text-[#0875d1] sm:text-sm"
                    iconClassName="h-4 w-4 shrink-0"
                  />
                </div>
              </div>
            </div>
            <ListingSellerCard
              sellerName={listingSellerName(listing)}
              registeredSince={sellerStats.registeredSince}
              listingCount={sellerStats.listingCount}
              soldCount={sellerStats.soldCount}
              hasContacts={Boolean(listing.phone || listing.email || listing.messengerUrl)}
              listingTitle={listing.title}
              profileHref={sellerProfileHref(listing)}
            />
            {hasMapPoint ? <LocationMap location={listing} exactLabel="Точный адрес частного лица по умолчанию не показывается" /> : null}
            {listing.booking ? <BookingCalculator booking={listing.booking} listingId={listing.slug} listingTitle={listing.title} /> : null}
            {showDeliveryUi ? <DeliveryInfoCard delivery={listing.delivery} /> : null}
          </aside>
        </div>
      </main>
    </>
  );
}

function Field({ children, className = "", compact = false, label, size = "md" }: { label: string; children: ReactNode; className?: string; compact?: boolean; size?: "xs" | "sm" | "md" | "lg" | "full" }) {
  return (
    <label className={`form-field block ${className}`} data-field-size={size}>
      <span className={`${compact ? "text-xs sm:text-sm" : "text-sm"} font-bold text-slate-700`}>{label}</span>
      <span className={`${compact ? "mt-1 sm:mt-2" : "mt-2"} block`}>{children}</span>
    </label>
  );
}

function TextInput({
  compact = false,
  ...props
}: {
  name?: string;
  placeholder?: string;
  defaultValue?: string;
  type?: string;
  validation?: "phone" | "email" | "messenger";
  compact?: boolean;
}) {
  return (
    <ValidatedInput
      {...props}
      capitalizeFirstLetter={!props.validation && (!props.type || props.type === "text")}
      className={`${compact ? "h-10 px-3 text-sm sm:h-12 sm:px-4 sm:text-base" : "h-12 px-4"} w-full rounded-lg border border-slate-300 outline-none focus:border-[#0875d1]`}
    />
  );
}

function PriceInput({ compact = false, defaultValue }: { compact?: boolean; defaultValue?: string }) {
  return (
    <input
      name="price"
      defaultValue={extractListingPriceDigits(defaultValue)}
      inputMode="numeric"
      maxLength={maxListingPriceDigits}
      pattern="[0-9]*"
      placeholder="12000"
      className={`${compact ? "h-10 px-3 text-sm sm:h-12 sm:px-4 sm:text-base" : "h-12 px-4"} w-full rounded-lg border border-slate-300 outline-none focus:border-[#0875d1]`}
    />
  );
}

function SelectInput({ compact = false, name, options, defaultValue }: { name?: string; options: DropdownOption[]; defaultValue?: string; compact?: boolean }) {
  return <DropdownSelect name={name} defaultValue={defaultValue} options={options} buttonClassName={compact ? "h-10 gap-1 px-2 text-xs sm:h-12 sm:gap-3 sm:px-4 sm:text-sm" : ""} />;
}

function NumberInput({ defaultValue, name, placeholder }: { defaultValue?: number; name: string; placeholder: string }) {
  return (
    <input
      name={name}
      defaultValue={defaultValue}
      inputMode="numeric"
      min={0}
      placeholder={placeholder}
      type="number"
      className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-[#0875d1] sm:h-12 sm:px-4 sm:text-base"
    />
  );
}

function ListingDeliveryFields({ defaultCity, delivery }: { defaultCity?: string; delivery?: DeliveryOptions }) {
  const enabled = Boolean(delivery?.enabled);

  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-lg font-black text-[#060b27]">
            <Truck className="h-5 w-5 text-[#0875d1]" />
            Доставка
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Основа для будущей отправки через службы доставки: способ, город отправления, габариты и условия.
          </p>
        </div>
        <label className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800">
          <input type="checkbox" name="deliveryEnabled" value="1" defaultChecked={enabled} className="h-4 w-4 accent-[#0875d1]" />
          Доставка возможна
        </label>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-sm font-black text-[#060b27]">Службы доставки</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {deliveryServices.map((service) => (
              <label key={service.id} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-slate-50 px-3 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  name="deliveryServices"
                  value={service.id}
                  defaultChecked={delivery?.services.includes(service.id) ?? service.id === "cdek"}
                  className="h-4 w-4 accent-[#0875d1]"
                />
                {service.label}
              </label>
            ))}
          </div>
        </div>

        <div className="adaptive-field-grid">
          <Field label="Кто оплачивает" compact size="md">
            <SelectInput
              name="deliveryPayer"
              defaultValue={delivery?.payer ?? "buyer"}
              compact
              options={[
                { value: "buyer", label: deliveryPayerLabels.buyer },
                { value: "seller", label: deliveryPayerLabels.seller },
                { value: "split", label: deliveryPayerLabels.split },
              ]}
            />
          </Field>
          <Field label="Город отправления" compact size="md">
            <TextInput name="deliveryOriginCity" defaultValue={delivery?.originCity ?? defaultCity} placeholder="Краснодар" compact />
          </Field>
          <Field label="Вес, г" compact size="sm">
            <NumberInput name="deliveryWeightGram" defaultValue={delivery?.packageWeightGram} placeholder="1200" />
          </Field>
          <Field label="Подготовка, дней" compact size="sm">
            <NumberInput name="deliveryHandlingDays" defaultValue={delivery?.handlingDays} placeholder="1" />
          </Field>
        </div>
      </div>

      <div className="adaptive-field-grid mt-4">
        <Field label="Длина, см" compact size="sm">
          <NumberInput name="deliveryLengthCm" defaultValue={delivery?.packageLengthCm} placeholder="30" />
        </Field>
        <Field label="Ширина, см" compact size="sm">
          <NumberInput name="deliveryWidthCm" defaultValue={delivery?.packageWidthCm} placeholder="20" />
        </Field>
        <Field label="Высота, см" compact size="sm">
          <NumberInput name="deliveryHeightCm" defaultValue={delivery?.packageHeightCm} placeholder="15" />
        </Field>
      </div>

      <label className="form-field mt-4 block" data-field-size="full">
        <span className="text-sm font-bold text-slate-700">Комментарий по доставке</span>
        <CapitalizedTextarea
          name="deliveryComment"
          defaultValue={delivery?.comment}
          className="mt-2 min-h-20 w-full rounded-lg border border-slate-300 px-4 py-3 text-sm outline-none focus:border-[#0875d1]"
          placeholder="Например: отправлю после оплаты, нужна обрешетка, доступен самовывоз..."
        />
      </label>
    </section>
  );
}

export function ListingFormPage({ slug, adminMode = false, defaults, error }: { slug?: string; adminMode?: boolean; defaults?: ListingFormDefaults; error?: string }) {
  async function publishWithoutPaymentAction(formData: FormData) {
    "use server";

    const captchaVerified = await verifyTurnstileFormData(formData);

    if (!captchaVerified) {
      redirect(`/razmestit/obyavlenie?admin=1&error=${encodeURIComponent(TURNSTILE_ERROR_MESSAGE)}`);
    }

    const title = String(formData.get("title") ?? "").trim() || "Новое объявление";
    const kindValue = String(formData.get("kind") ?? "prodam");
    const categorySlug = String(formData.get("category") ?? "").trim() || "dlya-doma-i-dachi";
    const kind = categorySlug === "otdyh" || (categorySlug === "nedvizhimost" && kindValue === "arenda") ? "arenda" : listingKinds.some((item) => item.slug === kindValue) ? (kindValue as ListingKind) : "prodam";
    const subcategorySlug = String(formData.get("subcategory") ?? "").trim();
    const category = categories.find((item) => item.slug === categorySlug);
    const subcategory =
      category?.children.find((child) => slugifySubcategory(child) === subcategorySlug) ??
      category?.children[0] ??
      "Без подкатегории";
    const hasMapPoint = String(formData.get("locationMode") ?? "") === "exact" && String(formData.get("mapPointSelected") ?? "") === "1";
    const city = inferCityFromFormData(formData);
    const phone = String(formData.get("phone") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim();
    const messengerUrl = String(formData.get("messengerUrl") ?? "").trim();

    if (!phone && !email && !messengerUrl) {
      redirect(`/razmestit/obyavlenie?admin=1&error=${encodeURIComponent("Укажите хотя бы один контакт объявления: телефон, email или Telegram/WhatsApp.")}`);
    }

    createListing({
      title,
      kind,
      categorySlug,
      subcategory,
      city,
      address: hasMapPoint ? String(formData.get("address") ?? "").trim() || undefined : undefined,
      price: normalizeListingPrice(String(formData.get("price") ?? ""), kind === "arenda" && isBookingCategory(categorySlug) ? "расчет по датам" : "по договоренности"),
      booking: kind === "arenda" ? parseBookingDetails(formData, categorySlug) : undefined,
      delivery: parseDeliveryOptions(formData, city),
      description: String(formData.get("description") ?? "").trim() || undefined,
      phone: phone || undefined,
      email: email || undefined,
      messengerUrl: messengerUrl || undefined,
      lat: hasMapPoint ? parseCoordinate(formData, "lat") : undefined,
      lng: hasMapPoint ? parseCoordinate(formData, "lng") : undefined,
      hasMapPoint,
    });

    redirect("/cabinet/obyavleniya");
  }

  const editing = Boolean(slug);
  const listing = findListingBySlug(slug);
  const tariff = getTariffs().find((item) => item.id === "listing-publication");
  const formDefaults = getListingFormDefaults(defaults);

  if (slug && !listing) {
    return (
      <>
        <SiteHeader />
        <PublicationAuthGate title="Войдите, чтобы редактировать объявление">
          <DemoListingEditClient slug={slug} />
        </PublicationAuthGate>
      </>
    );
  }

  return (
    <>
      <SiteHeader />
      <PublicationAuthGate title={editing ? "Войдите, чтобы редактировать объявление" : "Войдите, чтобы создать объявление"}>
        <main className="page-container py-10">
          <Breadcrumbs items={[{ label: editing ? "Редактирование объявления" : "Создание объявления" }]} />
          <BackLink fallbackHref="/cabinet/obyavleniya" className="mt-1 inline-flex items-center gap-2 text-sm font-bold text-[#0875d1]">
            Назад
          </BackLink>
          <section>
          <h1 className="mt-3 text-3xl font-black text-[#060b27] sm:text-5xl">{editing ? "Редактировать объявление" : "Создать объявление"}</h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600 sm:text-lg sm:leading-8">
            Заполните объявление, добавьте фото и выберите удобный способ связи.
          </p>
          {error ? <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</p> : null}

          <form action={adminMode ? publishWithoutPaymentAction : undefined} className="listing-create-form mt-6 grid min-w-0 max-w-full gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="listing-create-primary-grid adaptive-field-grid">
              <ListingKindAndCategoryFields
                booking={listing?.booking}
                defaultCategorySlug={listing?.categorySlug ?? formDefaults.categorySlug}
                defaultKind={listing?.kind ?? formDefaults.kind}
                defaultSubcategorySlug={listing?.subcategorySlug ?? formDefaults.subcategorySlug}
              />
              <Field className="listing-title-field" label="Название" compact size="lg">
                <TextInput name="title" defaultValue={listing?.title} placeholder="Например, Комод из массива дуба" compact />
              </Field>
              <Field className="listing-price-field" label="Цена" compact size="sm">
                <PriceInput defaultValue={listing?.price} compact />
              </Field>
            </div>

            <label className="form-field block" data-field-size="full">
              <span className="text-sm font-bold text-slate-700">Описание</span>
              <CapitalizedTextarea
                name="description"
                defaultValue={listing?.description}
                className="mt-2 min-h-28 w-full rounded-lg border border-slate-300 px-4 py-3 outline-none focus:border-[#0875d1]"
                placeholder="Состояние, детали, условия передачи"
              />
            </label>

            <ListingLocationFields className="listing-create-location-fields" defaultAddress={listing?.address} defaultCity={listing?.city} defaultLat={listing?.lat} defaultLng={listing?.lng} inlineControls />

            {showDeliveryUi ? <ListingDeliveryFields delivery={listing?.delivery} defaultCity={listing?.city ?? "Краснодар"} /> : null}

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-lg font-black text-[#060b27]">
                <Phone className="h-5 w-5 text-[#0aa337]" />
                Контакты
              </div>
              <div className="adaptive-field-grid mt-4 gap-2 sm:gap-4">
                <Field label="Телефон" compact size="sm">
                  <TextInput name="phone" defaultValue={listing?.phone} placeholder="+7..." validation="phone" compact />
                </Field>
                <Field label="Основной способ связи" compact size="md">
                  <SelectInput
                    name="contactMethod"
                    defaultValue="phone"
                    compact
                    options={[
                      { value: "phone", label: "Телефон" },
                      { value: "messenger", label: "Мессенджер" },
                      { value: "email", label: "Email" },
                    ]}
                  />
                </Field>
                <Field label="Email для уведомлений" compact size="lg">
                  <TextInput name="email" placeholder="mail@example.ru" validation="email" compact />
                </Field>
                <Field label="Telegram или WhatsApp" compact size="lg">
                  <TextInput name="messengerUrl" defaultValue={listing?.messengerUrl} placeholder="@username или ссылка" validation="messenger" compact />
                </Field>
              </div>
            </div>

            <ListingPhotoUploader />

            <div className="grid gap-3">
              <LegalConsentCheckbox name="placementRightsAccepted" errorMessage="Примите условия документов, чтобы продолжить">
                Я подтверждаю, что имею право размещать объявление, фотографии и контактные данные, и соглашаюсь с их публикацией на сайте БЛИЖНИЙ.{" "}
                <LegalLink href="/legal/agreement">Пользовательское соглашение</LegalLink> и{" "}
                <LegalLink href="/legal/privacy">Политика обработки персональных данных</LegalLink>.
              </LegalConsentCheckbox>
              {!adminMode ? (
                <LegalConsentCheckbox
                  name="publicOfferAccepted"
                  requiredConsent={false}
                  paymentConsent
                  errorMessage="Примите условия публичной оферты, чтобы перейти к оплате"
                >
                  Я принимаю условия <LegalLink href="/legal/offer">Публичной оферты</LegalLink> и понимаю, что оплачиваю услугу размещения объявления на сайте БЛИЖНИЙ.
                </LegalConsentCheckbox>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-3">
              <AdminDemoPublishButton
                publicationType="listing"
                returnHref="/cabinet/obyavleniya"
                label="Сохранить черновик"
                status="Черновик"
                requireCaptcha={false}
                validateForm={false}
                buttonClassName="inline-flex h-12 w-fit items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-6 font-bold text-slate-800 transition hover:border-blue-200 hover:bg-blue-50 disabled:cursor-wait disabled:bg-slate-100"
              />
              {adminMode ? (
                <AdminDemoPublishButton publicationType="listing" returnHref="/cabinet/obyavleniya" label="Опубликовать без оплаты" />
              ) : (
                <AdminDemoPublishButton
                  publicationType="listing"
                  returnHref="/cabinet/obyavleniya"
                  label="Создать и оплатить"
                  paymentTariffId="listing-publication"
                  buttonClassName="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#0aa337] px-6 font-bold text-white transition hover:bg-[#078a2e] disabled:cursor-wait disabled:bg-slate-300"
                />
              )}
            </div>
          </form>

          <div className="mb-16 mt-6 grid gap-3 sm:mb-20 md:grid-cols-3">
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
      </PublicationAuthGate>
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
      <Link href="/katalog" className="mt-5 inline-flex items-center gap-2 font-bold text-[#0875d1]">
        Все категории
        <ChevronRight className="h-5 w-5" />
      </Link>
    </div>
  );
}
