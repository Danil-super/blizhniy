import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  ChevronRight,
  CreditCard,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { AdminDemoPublishButton } from "@/components/AdminDemoPublishButton";
import { CategoryGrid } from "@/components/CategoryGrid";
import { DropdownOption, DropdownSelect } from "@/components/DropdownSelect";
import { LocationMap } from "@/components/LocationMap";
import { SiteHeader } from "@/components/SiteHeader";
import { ValidatedInput } from "@/components/ValidatedInput";
import { categories } from "@/lib/data";
import { createListing, listListings } from "@/lib/mock-store";
import { getTariffs } from "@/lib/tariff-store";
import type { BookingDetails, Listing as StoreListing } from "@/lib/types";
import { BookingCalculator } from "./BookingCalculator";
import { DemoListingEditClient } from "./DemoListingEditClient";
import { DemoListingDetailClient } from "./DemoListingDetailClient";
import { ListingKindAndCategoryFields, ListingLocationFields, ListingPhotoUploader } from "./ListingFormControls";
import { DemoListing, ListingKind, ListingKindBadge, StatusBadge } from "./ListingCard";
import { ListingResultsPanel } from "./ListingResultsPanel";
import { ListingViewTracker } from "./ListingViewTracker";

const listingKinds: { slug: ListingKind; title: string; description: string }[] = [
  { slug: "prodam", title: "Продам", description: "Вещи, мебель, растения и полезные товары рядом с домом." },
  { slug: "kuplyu", title: "Куплю", description: "Запросы покупателей: что ищут жители Краснодара и края." },
  { slug: "arenda", title: "Аренда", description: "Бронирование турбаз, гостиниц, домов и активного отдыха." },
  { slug: "menyayu", title: "Меняю", description: "Обмен товарами, коллекциями, вещами и материалами." },
  { slug: "otdam-darom", title: "Отдам даром", description: "Публикации без цены: забрать, передать, пристроить." },
];

const baseDemoListings: DemoListing[] = [
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

export const demoListings: DemoListing[] = [...baseDemoListings, ...createCoverageListings(baseDemoListings)];

function inferListingKind(categorySlug: string, subcategorySlug: string): ListingKind {
  if (categorySlug === "otdyh" || subcategorySlug === "arenda" || subcategorySlug === "kommercheskaya-nedvizhimost") {
    return "arenda";
  }

  if (subcategorySlug.startsWith("kuplyu")) {
    return "kuplyu";
  }

  if (subcategorySlug === "partnerstvo") {
    return "menyayu";
  }

  if (subcategorySlug === "uhod-za-mestom") {
    return "otdam-darom";
  }

  return "prodam";
}

function coveragePrice(kind: ListingKind, categorySlug: string, index: number) {
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
          title: `Контрольное объявление: ${subcategory}`,
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
          price: coveragePrice(kind, category.slug, index),
          booking: kind === "arenda" ? coverageBooking(category.slug, subcategorySlug, index) : undefined,
          description: `Проверочное объявление для подкатегории "${subcategory}". Нужно для контроля отображения, маршрутов, карточек и формы создания объявлений.`,
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

function parseCoordinate(formData: FormData, name: string) {
  const value = Number(String(formData.get(name) ?? "").replace(",", "."));
  return Number.isFinite(value) ? value : undefined;
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
      tourDate: String(formData.get("tourDate") ?? "").trim(),
      tourTime: String(formData.get("tourTime") ?? "").trim(),
      tourDuration: String(formData.get("tourDuration") ?? "").trim(),
      tourDifficulty: String(formData.get("tourDifficulty") ?? "").trim(),
      tourMeetingPoint: String(formData.get("tourMeetingPoint") ?? "").trim(),
      included: String(formData.get("bookingIncluded") ?? "").trim(),
      rules: String(formData.get("bookingRules") ?? "").trim(),
    };
  }

  return {
    mode,
    priceWeekday: parseNumber(formData, "bookingPriceWeekday"),
    priceWeekend: parseNumber(formData, "bookingPriceWeekend"),
    minNights: parseNumber(formData, "bookingMinNights"),
    includedGuests: parseNumber(formData, "bookingIncludedGuests"),
    maxGuests: parseNumber(formData, "bookingMaxGuests"),
    extraGuestPrice: parseNumber(formData, "bookingExtraGuestPrice"),
    availableFrom: String(formData.get("bookingAvailableFrom") ?? "").trim(),
    availableTo: String(formData.get("bookingAvailableTo") ?? "").trim(),
    blockedDates: parseDateList(formData, "bookingBlockedDates"),
    checkInTime: String(formData.get("bookingCheckIn") ?? "").trim(),
    checkOutTime: String(formData.get("bookingCheckOut") ?? "").trim(),
    included: String(formData.get("bookingIncluded") ?? "").trim(),
    rules: String(formData.get("bookingRules") ?? "").trim(),
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

function toDemoListing(listing: StoreListing): DemoListing {
  return {
    slug: listing.slug,
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
    showExactAddress: listing.showExactAddress,
    price: listing.price ?? "по договоренности",
    booking: listing.booking,
    description: listing.description,
    phone: listing.phone ?? "+78610009999",
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

  const localListing = demoListings.find((item) => item.slug === slug);

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
    Смартфоны: "smartfony",
    Ноутбуки: "noutbuki",
    Компьютеры: "kompyutery",
    "Аудио и видео": "audio-i-video",
    "Игровые приставки": "igrovye-pristavki",
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
  };

  return map[name] ?? name.toLowerCase().replaceAll(" ", "-");
}

function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav className="mb-4 flex flex-wrap items-center gap-2 text-xs text-slate-500 sm:text-sm" aria-label="Хлебные крошки">
      <Link href="/blizhniy/prodam" className="hover:text-[#0875d1]">
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
            <ListingResultsPanel kind={kind} listings={listings} />
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
            <ListingResultsPanel kind={["menyayu", "otdam-darom"]} listings={listings} />
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
      <main className="page-container py-6 sm:py-8 lg:py-10">
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
            <ListingResultsPanel categorySlug={categorySlug} listings={listings} subcategorySlug={subcategorySlug} />
          </section>
        </div>
      </main>
    </>
  );
}

export function ListingDetailPage({ slug }: { slug: string }) {
  const listing = findListingBySlug(slug);
  const tariff = getTariffs().find((item) => item.id === "listing-publication");
  const hasMessenger = Boolean(listing?.messengerUrl);

  if (!listing) {
    return (
      <>
        <SiteHeader />
        <DemoListingDetailClient slug={slug} />
      </>
    );
  }

  return (
    <>
      <SiteHeader />
      <ListingViewTracker listingId={listing.slug} />
      <main className="page-container py-10">
        <Breadcrumbs
          items={[
            { label: listing.categoryName, href: `/blizhniy/${listing.categorySlug}` },
            { label: listing.subcategoryName, href: `/blizhniy/${listing.categorySlug}/${listing.subcategorySlug}` },
            { label: listing.title },
          ]}
        />
        <div className="grid min-w-0 gap-5 sm:gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] lg:items-start">
          <section className="min-w-0">
            <Link href={`/blizhniy/${listing.kind}`} className="inline-flex items-center gap-2 text-sm font-bold text-[#0875d1]">
              <ArrowLeft className="h-4 w-4" />
              Назад к разделу
            </Link>
            <h1 className="[overflow-wrap:anywhere] mt-3 text-2xl font-black leading-tight text-[#060b27] sm:mt-4 sm:text-4xl lg:text-5xl">{listing.title}</h1>
            <div className="mt-4 flex flex-wrap gap-2">
              <ListingKindBadge kind={listing.kind} />
              <StatusBadge status={listing.status} />
            </div>
            <div className="mt-5 flex aspect-[4/3] w-full max-w-3xl items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-slate-400 sm:mt-6">
              <Camera className="h-12 w-12 sm:h-16 sm:w-16" />
            </div>
            <div className="mt-5 min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:mt-7 sm:p-6">
              <h2 className="text-xl font-black text-[#060b27] sm:text-2xl">Описание</h2>
              <p className="mt-3 [overflow-wrap:anywhere] text-base leading-7 text-slate-700 sm:mt-4 sm:text-lg sm:leading-8">{listing.description}</p>
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
                  <dd className="mt-1 [overflow-wrap:anywhere] font-semibold text-slate-900">{listing.publishedAt}</dd>
                </div>
                <div className="min-w-0 rounded-lg bg-slate-50 p-3 sm:p-4">
                  <dt className="text-sm font-bold text-slate-500">Активно до</dt>
                  <dd className="mt-1 [overflow-wrap:anywhere] font-semibold text-slate-900">{listing.expiresAt}</dd>
                </div>
              </dl>
            </div>
            <div className="mt-7">
              <LocationMap location={listing} exactLabel="Точный адрес частного лица по умолчанию не показывается" />
            </div>
          </section>

          <aside className="min-w-0 space-y-4">
            {listing.booking ? <BookingCalculator booking={listing.booking} listingId={listing.slug} listingTitle={listing.title} /> : null}
            <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-5">
              <p className="[overflow-wrap:anywhere] text-2xl font-black text-[#060b27] sm:text-3xl">{listing.price}</p>
              <p className="mt-3 flex min-w-0 items-start gap-2 text-slate-600">
                <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-[#0875d1]" />
                <span className="min-w-0 [overflow-wrap:anywhere]">{listing.city}, {listing.district}</span>
              </p>
              <div className={`mt-5 grid gap-2 sm:gap-3 ${hasMessenger ? "min-[420px]:grid-cols-2" : "grid-cols-1"}`}>
                <a href={`tel:${listing.phone}`} className="inline-flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-xl bg-[#0aa337] px-2 text-sm font-bold text-white sm:h-12 sm:gap-2 sm:text-base">
                  <Phone className="h-5 w-5" />
                  <span className="truncate">Позвонить</span>
                </a>
                {listing.messengerUrl ? (
                  <a
                    href={listing.messengerUrl}
                    className="inline-flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-xl border border-[#0875d1] px-2 text-sm font-bold text-[#0875d1] sm:h-12 sm:gap-2 sm:text-base"
                  >
                    <MessageCircle className="h-5 w-5" />
                    <span className="truncate">Написать сообщение</span>
                  </a>
                ) : null}
              </div>
            </div>
            <div className="min-w-0 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
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
          </aside>
        </div>
      </main>
    </>
  );
}

function Field({ children, compact = false, label }: { label: string; children: ReactNode; compact?: boolean }) {
  return (
    <label className="block">
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
      className={`${compact ? "h-10 px-3 text-sm sm:h-12 sm:px-4 sm:text-base" : "h-12 px-4"} w-full rounded-lg border border-slate-300 outline-none focus:border-[#0875d1]`}
    />
  );
}

function SelectInput({ compact = false, name, options, defaultValue }: { name?: string; options: DropdownOption[]; defaultValue?: string; compact?: boolean }) {
  return <DropdownSelect name={name} defaultValue={defaultValue} options={options} buttonClassName={compact ? "h-10 gap-1 px-2 text-xs sm:h-12 sm:gap-3 sm:px-4 sm:text-sm" : ""} />;
}

export function ListingFormPage({ slug, adminMode = false }: { slug?: string; adminMode?: boolean }) {
  async function publishWithoutPaymentAction(formData: FormData) {
    "use server";

    const title = String(formData.get("title") ?? "").trim() || "Новое объявление";
    const kindValue = String(formData.get("kind") ?? "prodam");
    const categorySlug = String(formData.get("category") ?? "").trim() || "mebel-i-interer";
    const kind = categorySlug === "otdyh" || (categorySlug === "nedvizhimost" && kindValue === "arenda") ? "arenda" : listingKinds.some((item) => item.slug === kindValue) ? (kindValue as ListingKind) : "prodam";
    const subcategorySlug = String(formData.get("subcategory") ?? "").trim();
    const category = categories.find((item) => item.slug === categorySlug);
    const subcategory =
      category?.children.find((child) => slugifySubcategory(child) === subcategorySlug) ??
      category?.children[0] ??
      "Без подкатегории";
    const location = String(formData.get("location") ?? "").trim();
    const city = location.split(",")[0]?.trim() || "Краснодар";

    createListing({
      title,
      kind,
      categorySlug,
      subcategory,
      city,
      address: String(formData.get("address") ?? "").trim() || undefined,
      price: String(formData.get("price") ?? "").trim() || (kind === "arenda" && isBookingCategory(categorySlug) ? "расчет по датам" : undefined),
      booking: kind === "arenda" ? parseBookingDetails(formData, categorySlug) : undefined,
      description: String(formData.get("description") ?? "").trim() || undefined,
      phone: String(formData.get("phone") ?? "").trim() || undefined,
      messengerUrl: String(formData.get("messengerUrl") ?? "").trim() || undefined,
      lat: parseCoordinate(formData, "lat"),
      lng: parseCoordinate(formData, "lng"),
    });

    redirect("/cabinet/obyavleniya");
  }

  const editing = Boolean(slug);
  const listing = findListingBySlug(slug);
  const tariff = getTariffs().find((item) => item.id === "listing-publication");

  if (slug && !listing) {
    return (
      <>
        <SiteHeader />
        <DemoListingEditClient slug={slug} />
      </>
    );
  }

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

          <form action={adminMode ? publishWithoutPaymentAction : undefined} className="mt-6 grid gap-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="grid grid-cols-3 gap-2 sm:gap-4 lg:grid-cols-[220px_minmax(0,1fr)_minmax(0,1fr)]">
              <ListingKindAndCategoryFields
                booking={listing?.booking}
                defaultCategorySlug={listing?.categorySlug ?? "mebel-i-interer"}
                defaultKind={listing?.kind ?? "prodam"}
                defaultSubcategorySlug={listing?.subcategorySlug ?? "mebel"}
              />
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)_minmax(96px,0.45fr)] gap-2 sm:gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
              <Field label="Название" compact>
                <TextInput name="title" defaultValue={listing?.title} placeholder="Например, Комод из массива дуба" compact />
              </Field>
              <Field label="Цена" compact>
                <TextInput name="price" defaultValue={listing?.price} placeholder="Например, 12 000 ₽" compact />
              </Field>
            </div>

            <label className="block">
              <span className="text-sm font-bold text-slate-700">Описание</span>
              <textarea
                name="description"
                defaultValue={listing?.description}
                className="mt-2 min-h-28 w-full rounded-lg border border-slate-300 px-4 py-3 outline-none focus:border-[#0875d1]"
                placeholder="Состояние, детали, условия передачи"
              />
            </label>

            <ListingLocationFields defaultCity={listing?.city} defaultLat={listing?.lat} defaultLng={listing?.lng} />

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-lg font-black text-[#060b27]">
                <Phone className="h-5 w-5 text-[#0aa337]" />
                Контакты
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:gap-4">
                <Field label="Телефон" compact>
                  <TextInput name="phone" defaultValue={listing?.phone} placeholder="+7..." validation="phone" compact />
                </Field>
                <Field label="Основной способ связи" compact>
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
                <Field label="Email для уведомлений" compact>
                  <TextInput placeholder="mail@example.ru" validation="email" compact />
                </Field>
                <Field label="Telegram или WhatsApp" compact>
                  <TextInput name="messengerUrl" defaultValue={listing?.messengerUrl} placeholder="@username или ссылка" validation="messenger" compact />
                </Field>
              </div>
            </div>

            <ListingPhotoUploader />

            <div className="flex flex-wrap gap-3">
              <Link href="/cabinet/obyavleniya" className="inline-flex h-12 items-center justify-center rounded-xl border border-slate-300 px-6 font-bold text-slate-800">
                Сохранить черновик
              </Link>
              {adminMode ? (
                <AdminDemoPublishButton publicationType="listing" returnHref="/cabinet/obyavleniya" label="Опубликовать без оплаты" />
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
