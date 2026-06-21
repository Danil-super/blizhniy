"use client";

/* eslint-disable @next/next/no-img-element */

import type { ChangeEvent } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { Camera, ImagePlus, Trash2, X } from "lucide-react";
import { DropdownSelect } from "@/components/DropdownSelect";
import { SquareImageCropper } from "@/components/SquareImageCropper";
import { YandexMapPicker } from "@/components/YandexMapPicker";
import { categoryDisplayItems } from "@/lib/category-display-order";
import { categories, cities, region } from "@/lib/data";
import { extractListingPriceDigits, maxListingPriceDigits } from "@/lib/listing-price";
import { getRentalSubcategories, isRentalCategorySlug, isRentalSubcategorySlug } from "@/lib/listing-rental";
import { filterListingMediaFiles, listingMediaLimitText } from "@/lib/media-limits";
import { hasMapCoordinates } from "@/lib/map-location";
import type { BookingDetails, ListingKind } from "@/lib/types";

type PreviewMedia = {
  id: string;
  file: File;
  sourceFile: File;
  kind: "image" | "video";
  name: string;
  sourceUrl: string;
  url: string;
};

const listingKindOptions: Array<{ value: ListingKind; label: string }> = [
  { value: "prodam", label: "Продам" },
  { value: "kuplyu", label: "Куплю" },
  { value: "arenda", label: "Аренда" },
  { value: "menyayu", label: "Меняю" },
  { value: "otdam-darom", label: "Отдам даром" },
];

const cityOptions = cities.map((city) => ({
  value: `${city.name}, ${region.name}`,
  label: `${city.name}, ${region.name}`,
}));

function formatCityValue(city?: string) {
  if (!city?.trim()) {
    return "";
  }

  return city.includes(region.name) ? city : `${city}, ${region.name}`;
}

function slugifySubcategoryValue(name: string) {
  const map: Record<string, string> = {
    "Товары времен СССР": "tovary-vremen-sssr",
    "Картины и живопись": "kartiny-i-zhivopis",
    "Продам недвижимость": "prodam-nedvizhimost",
    "Куплю недвижимость": "kuplyu-nedvizhimost",
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
    Игрушки: "igrushki",
    "Технические игрушки": "tehnicheskie-igrushki",
    "Дидактические игрушки": "didakticheskie-igrushki",
    "Спортивные (спортивно-моторные) игрушки": "sportivnye-sportivno-motornye-igrushki",
    Одежда: "odezhda",
    Обувь: "obuv",
    Аксессуары: "aksessuary",
    Разное: "raznoe",
  };

  return map[name] ?? name.toLowerCase().replaceAll(" ", "-");
}

function subcategoryWordCount(name: string) {
  return name.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
}

function orderSubcategoriesLikeCatalog(subcategories: string[]) {
  return [...subcategories].sort((left, right) => {
    const wordCountDiff = subcategoryWordCount(left) - subcategoryWordCount(right);

    return wordCountDiff || left.length - right.length || left.localeCompare(right, "ru");
  });
}

function inferListingKindFromCatalog(categorySlug: string, subcategorySlug: string): ListingKind {
  if (isRentalSubcategorySlug(categorySlug, subcategorySlug, slugifySubcategoryValue)) {
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

type ListingCategoryOption = {
  categorySlug: string;
  label: string;
  preferredKind?: ListingKind;
  subcategorySlug?: string;
  value: string;
};

function parseCatalogHref(href: string) {
  const parts = href.split("?")[0]?.split("/").filter(Boolean) ?? [];

  if (parts[0] !== "katalog") {
    return undefined;
  }

  return {
    categorySlug: parts[1] ?? "",
    subcategorySlug: parts[2],
  };
}

const listingCategoryOptions = categoryDisplayItems.flatMap<ListingCategoryOption>((item) => {
  const route = parseCatalogHref(item.href);

  if (!route) {
    return [];
  }

  const category = categories.find((entry) => entry.slug === route.categorySlug);

  if (!category) {
    return [];
  }

  return [
    {
      categorySlug: category.slug,
      label: item.label,
      preferredKind: route.subcategorySlug ? inferListingKindFromCatalog(category.slug, route.subcategorySlug) : undefined,
      subcategorySlug: route.subcategorySlug,
      value: item.id,
    },
  ];
});

function getCategoryOptionByCategorySlug(categorySlug: string) {
  return listingCategoryOptions.find((option) => option.categorySlug === categorySlug && !option.subcategorySlug) ?? listingCategoryOptions.find((option) => option.categorySlug === categorySlug);
}

function getCategoryOptionForDefaults(categorySlug: string, subcategorySlug?: string) {
  if (subcategorySlug) {
    const exactOption = listingCategoryOptions.find((option) => option.categorySlug === categorySlug && option.subcategorySlug === subcategorySlug);

    if (exactOption) {
      return exactOption;
    }
  }

  return getCategoryOptionByCategorySlug(categorySlug);
}

function cropFileName(name: string) {
  const base = name.replace(/\.[^.]+$/, "") || "photo";
  return `${base}-crop.png`;
}

async function dataUrlToImageFile(dataUrl: string, name: string) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], cropFileName(name), { type: blob.type || "image/png" });
}

export function ListingLocationFields({
  addressLegend = "Адрес объявления",
  className = "",
  cityFieldName = "location",
  cityLabel = "Город и регион",
  defaultAddress,
  defaultCity,
  defaultLat,
  defaultLng,
  inlineControls = false,
}: {
  addressLegend?: string;
  className?: string;
  cityFieldName?: string;
  cityLabel?: string;
  defaultAddress?: string;
  defaultCity?: string;
  defaultLat?: number;
  defaultLng?: number;
  inlineControls?: boolean;
}) {
  const hasInitialPoint = hasMapCoordinates(defaultLat, defaultLng);
  const addressGroupId = useId();
  const [mode, setMode] = useState<"city" | "exact">(hasInitialPoint ? "exact" : "city");
  const [cityValue, setCityValue] = useState(formatCityValue(defaultCity));
  const [pointSelected, setPointSelected] = useState(hasInitialPoint);
  const optionClassName = (active: boolean) =>
    `listing-location-option flex min-w-0 cursor-pointer items-center gap-3 rounded-lg border bg-white text-sm font-bold transition ${inlineControls ? "h-11 px-3" : "p-3"} ${active ? "border-[#0875d1] text-[#0875d1] ring-2 ring-blue-100" : "border-slate-200 text-slate-700 hover:border-blue-200"}`;
  const addressOptions = (
    <div className="listing-location-options grid gap-2 sm:grid-cols-2">
      <label className={optionClassName(mode === "city")}>
        <input
          type="radio"
          name="locationMode"
          value="city"
          checked={mode === "city"}
          onChange={() => {
            setMode("city");
            setPointSelected(false);
          }}
          className="h-4 w-4 shrink-0 accent-[#0875d1]"
        />
        Только город
      </label>
      <label className={optionClassName(mode === "exact")}>
        <input
          type="radio"
          name="locationMode"
          value="exact"
          checked={mode === "exact"}
          onChange={() => setMode("exact")}
          className="h-4 w-4 shrink-0 accent-[#0875d1]"
        />
        Точный адрес
      </label>
    </div>
  );

  return (
    <div className={`listing-location-fields grid gap-4 ${inlineControls ? "listing-location-fields--inline" : ""} ${className}`}>
      {inlineControls ? (
        <div className="listing-location-address-group" role="group" aria-labelledby={addressGroupId}>
          <span id={addressGroupId} className="listing-location-label text-sm font-bold text-slate-700">
            {addressLegend}
          </span>
          <div className="mt-2">{addressOptions}</div>
        </div>
      ) : (
        <fieldset className="rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
          <legend className="px-1 text-sm font-bold text-slate-700">{addressLegend}</legend>
          <div className="mt-2">{addressOptions}</div>
        </fieldset>
      )}
      {mode === "city" ? (
        <label className="block min-w-0">
          <span className="text-sm font-bold text-slate-700">{cityLabel}</span>
          <span className="mt-2 block">
            <DropdownSelect
              name={cityFieldName}
              value={cityValue}
              onValueChange={setCityValue}
              options={cityOptions}
              placeholder="Выбрать"
              required
            />
          </span>
        </label>
      ) : null}
      {mode === "exact" ? (
        <>
          <YandexMapPicker defaultAddress={defaultAddress} defaultLat={defaultLat} defaultLng={defaultLng} onPointSelectedChange={setPointSelected} />
          <input
            className="pointer-events-none absolute h-px w-px -translate-x-[200vw] opacity-0"
            tabIndex={-1}
            aria-hidden="true"
            value={pointSelected ? "1" : ""}
            onChange={() => undefined}
            readOnly
            required
          />
          {!pointSelected ? <p className="text-sm font-semibold text-amber-700">Введите точный адрес в поиске карты или поставьте точку кликом по карте.</p> : null}
        </>
      ) : null}
    </div>
  );
}

export function ListingCategoryFields({
  defaultCategorySlug = "dlya-doma-i-dachi",
  defaultSubcategorySlug,
}: {
  defaultCategorySlug?: string;
  defaultSubcategorySlug?: string;
}) {
  const fallbackCategory = categories.find((category) => category.slug === defaultCategorySlug) ?? categories[0];
  const [categorySlug, setCategorySlug] = useState(fallbackCategory?.slug ?? "");
  const selectedCategory = categories.find((category) => category.slug === categorySlug) ?? fallbackCategory;
  const subcategories = orderSubcategoriesLikeCatalog(selectedCategory?.children ?? []);
  const fallbackSubcategory = subcategories[0] ? slugifySubcategoryValue(subcategories[0]) : "";
  const selectedSubcategory =
    defaultSubcategorySlug && subcategories.some((child) => slugifySubcategoryValue(child) === defaultSubcategorySlug)
      ? defaultSubcategorySlug
      : fallbackSubcategory;
  const selectedCategoryOption = getCategoryOptionByCategorySlug(categorySlug);

  return (
    <>
      <label className="block min-w-0">
        <span className="text-sm font-bold text-slate-700">Категория</span>
        <span className="mt-2 block">
          <input type="hidden" name="category" value={categorySlug} />
          <DropdownSelect
            value={selectedCategoryOption?.value ?? categorySlug}
            onValueChange={(nextValue) => {
              const nextOption = listingCategoryOptions.find((option) => option.value === nextValue);

              setCategorySlug(nextOption?.categorySlug ?? nextValue);
            }}
            options={listingCategoryOptions.map((option) => ({ value: option.value, label: option.label }))}
          />
        </span>
      </label>
      <label className="block min-w-0">
        <span className="text-sm font-bold text-slate-700">Подкатегория</span>
        <span className="mt-2 block">
          <DropdownSelect
            key={categorySlug}
            name="subcategory"
            defaultValue={selectedSubcategory}
            options={
              subcategories.length
                ? subcategories.map((child) => ({ value: slugifySubcategoryValue(child), label: child }))
                : [{ value: "", label: "Без подкатегории" }]
            }
          />
        </span>
      </label>
    </>
  );
}

function BookingNumberInput({
  defaultValue,
  label,
  min = 0,
  name,
  placeholder,
}: {
  defaultValue?: number;
  label: string;
  min?: number;
  name: string;
  placeholder: string;
}) {
  return (
    <label className="booking-field block">
      <span className="text-sm font-bold text-slate-700">{label}</span>
      <input
        name={name}
        type="number"
        min={min}
        defaultValue={defaultValue}
        className="mt-2 h-11 w-full rounded-lg border border-slate-300 bg-white px-4 text-sm outline-none transition focus:border-[#0875d1] focus:ring-2 focus:ring-blue-100 sm:h-12"
        placeholder={placeholder}
      />
    </label>
  );
}

function BookingTextInput({
  defaultValue,
  label,
  min,
  name,
  placeholder,
  type = "text",
}: {
  defaultValue?: string;
  label: string;
  min?: string;
  name: string;
  placeholder: string;
  type?: string;
}) {
  return (
    <label className="booking-field block">
      <span className="text-sm font-bold text-slate-700">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        min={min}
        className="mt-2 h-11 w-full rounded-lg border border-slate-300 bg-white px-4 text-sm outline-none transition focus:border-[#0875d1] focus:ring-2 focus:ring-blue-100 sm:h-12"
        placeholder={placeholder}
      />
    </label>
  );
}

function todayInputValue() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function ListingPriceField({ defaultValue }: { defaultValue?: string }) {
  return (
    <label className="listing-price-field form-field block min-w-0" data-field-size="sm">
      <span className="text-xs font-bold text-slate-700 sm:text-sm">Цена</span>
      <span className="relative mt-1 block sm:mt-2">
        <input
          name="price"
          defaultValue={extractListingPriceDigits(defaultValue)}
          inputMode="numeric"
          maxLength={maxListingPriceDigits}
          pattern="[0-9]*"
          placeholder="12000"
          className="h-10 w-full rounded-lg border border-slate-300 px-3 pr-9 text-sm outline-none focus:border-[#0875d1] sm:h-12 sm:px-4 sm:pr-10 sm:text-base"
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 inline-flex items-center text-sm font-black text-slate-500 sm:right-4 sm:text-base">₽</span>
      </span>
    </label>
  );
}

export function ListingBookingFields({ booking, mode }: { booking?: BookingDetails; mode: BookingDetails["mode"] }) {
  const isTour = mode === "tour";
  const today = todayInputValue();

  return (
    <section className="listing-booking-card rounded-xl border border-blue-100 bg-white p-4 shadow-sm sm:p-5">
      <div className="grid gap-3 border-b border-slate-100 pb-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0">
          <h2 className="text-base font-black text-[#060b27] sm:text-lg">{isTour ? "Поход и участие" : "Доступность и бронирование"}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
            {isTour
              ? "Укажите дату, время, длительность, стоимость и условия участия. Эти данные будут показаны в карточке объявления."
              : "Задайте период приема гостей, правила заезда и занятые даты. На странице объявления пользователь выберет заезд и выезд в календаре."}
          </p>
        </div>
        <span className="w-fit rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-[#0875d1]">Аренда</span>
      </div>
      <input type="hidden" name="bookingMode" value={mode} />

      {isTour ? (
        <div className="booking-compact-grid mt-4 grid gap-4 md:grid-cols-2">
          <BookingNumberInput name="bookingPricePerPerson" label="Стоимость с человека, ₽" placeholder="3500" defaultValue={booking?.pricePerPerson} min={1} />
          <BookingNumberInput name="bookingMaxGuests" label="Количество мест" placeholder="12" defaultValue={booking?.maxGuests} min={1} />
          <BookingTextInput name="tourDate" label="Дата похода" type="date" placeholder="" defaultValue={booking?.tourDate} min={today} />
          <BookingTextInput name="tourTime" label="Время старта" type="time" placeholder="" defaultValue={booking?.tourTime} />
          <BookingTextInput name="tourDuration" label="Продолжительность" placeholder="6 часов / 2 дня" defaultValue={booking?.tourDuration} />
          <BookingTextInput name="tourDifficulty" label="Сложность" placeholder="Легкий / средний / сложный" defaultValue={booking?.tourDifficulty} />
          <div className="md:col-span-2">
            <BookingTextInput name="tourMeetingPoint" label="Место сбора" placeholder="Краснодар, парковка у ТЦ..." defaultValue={booking?.tourMeetingPoint} />
          </div>
        </div>
      ) : (
        <div className="mt-4 grid gap-4">
          <div className="booking-compact-grid grid gap-4 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:p-4 md:grid-cols-2 xl:grid-cols-3">
            <BookingTextInput name="bookingAvailableFrom" label="Принимать гостей с" type="date" placeholder="" defaultValue={booking?.availableFrom} min={today} />
            <BookingTextInput name="bookingAvailableTo" label="Принимать гостей до" type="date" placeholder="" defaultValue={booking?.availableTo} min={today} />
            <BookingNumberInput name="bookingMinNights" label="Минимум ночей" placeholder="1" defaultValue={booking?.minNights} min={1} />
          </div>

          <div className="booking-compact-grid grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <BookingNumberInput name="bookingPriceWeekday" label="Будни, ₽/сутки" placeholder="6000" defaultValue={booking?.priceWeekday} min={1} />
            <BookingNumberInput name="bookingPriceWeekend" label="Выходные, ₽/сутки" placeholder="8500" defaultValue={booking?.priceWeekend} min={1} />
            <BookingNumberInput name="bookingIncludedGuests" label="Гостей включено" placeholder="4" defaultValue={booking?.includedGuests} min={1} />
            <BookingNumberInput name="bookingMaxGuests" label="Максимум гостей" placeholder="8" defaultValue={booking?.maxGuests} min={1} />
          </div>

          <div className="booking-compact-grid grid gap-4 md:grid-cols-3">
            <BookingNumberInput name="bookingExtraGuestPrice" label="Доплата за гостя, ₽/сутки" placeholder="900" defaultValue={booking?.extraGuestPrice} />
            <BookingTextInput name="bookingCheckIn" label="Заезд после" type="time" placeholder="" defaultValue={booking?.checkInTime} />
            <BookingTextInput name="bookingCheckOut" label="Выезд до" type="time" placeholder="" defaultValue={booking?.checkOutTime} />
          </div>

          <label className="block">
            <span className="text-sm font-bold text-slate-700">Занятые даты</span>
            <span className="mt-1 block text-xs font-semibold leading-5 text-slate-500">
              Укажите даты через запятую или с новой строки. Эти дни будут недоступны в календаре гостя.
            </span>
            <textarea
              name="bookingBlockedDates"
              defaultValue={booking?.blockedDates?.join(", ")}
              className="mt-2 min-h-24 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-[#0875d1] focus:ring-2 focus:ring-blue-100"
              placeholder="2026-06-10, 2026-06-11&#10;2026-06-20"
            />
          </label>
        </div>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="text-sm font-bold text-slate-700">Что включено</span>
          <textarea
            name="bookingIncluded"
            defaultValue={booking?.included}
            className="mt-2 min-h-24 w-full rounded-lg border border-slate-300 px-4 py-3 text-sm outline-none focus:border-[#0875d1] focus:ring-2 focus:ring-blue-100"
            placeholder={isTour ? "Трансфер, инструктор, перекус, страховка" : "Мангал, баня, бассейн, парковка"}
          />
        </label>
        <label className="block">
          <span className="text-sm font-bold text-slate-700">Правила и ограничения</span>
          <textarea
            name="bookingRules"
            defaultValue={booking?.rules}
            className="mt-2 min-h-24 w-full rounded-lg border border-slate-300 px-4 py-3 text-sm outline-none focus:border-[#0875d1] focus:ring-2 focus:ring-blue-100"
            placeholder={isTour ? "Что взять с собой, возраст, отмена" : "Можно ли с детьми, животными, условия отмены"}
          />
        </label>
      </div>
    </section>
  );
}

export function ListingKindAndCategoryFields({
  defaultPrice,
  defaultCategorySlug = "dlya-doma-i-dachi",
  defaultKind = "prodam",
  defaultSubcategorySlug,
  booking,
}: {
  defaultPrice?: string;
  defaultCategorySlug?: string;
  defaultKind?: ListingKind;
  defaultSubcategorySlug?: string;
  booking?: BookingDetails;
}) {
  const rentalCategories = categories.filter((category) => isRentalCategorySlug(category.slug));
  const fallbackCategory = categories.find((category) => category.slug === defaultCategorySlug) ?? categories[0];
  const fallbackRentalCategory = rentalCategories[0] ?? fallbackCategory;
  const initialCategory = defaultKind === "arenda" ? (isRentalCategorySlug(fallbackCategory?.slug ?? "") ? fallbackCategory : fallbackRentalCategory) : fallbackCategory;
  const initialCategoryOption = getCategoryOptionForDefaults(initialCategory?.slug ?? "", defaultSubcategorySlug);
  const [categorySlug, setCategorySlug] = useState(initialCategory?.slug ?? "");
  const [categoryOptionValue, setCategoryOptionValue] = useState(initialCategoryOption?.value ?? initialCategory?.slug ?? "");
  const selectedCategory = categories.find((category) => category.slug === categorySlug) ?? fallbackCategory;
  const [kind, setKind] = useState<ListingKind>(initialCategoryOption?.preferredKind === "arenda" || defaultKind === "arenda" ? "arenda" : defaultKind);
  const allSubcategories = orderSubcategoriesLikeCatalog(selectedCategory?.children ?? []);
  const subcategories = kind === "arenda" ? getRentalSubcategories(categorySlug, allSubcategories) : allSubcategories;
  const fallbackSubcategory = subcategories[0] ? slugifySubcategoryValue(subcategories[0]) : "";
  const initialSubcategory =
    defaultSubcategorySlug && subcategories.some((child) => slugifySubcategoryValue(child) === defaultSubcategorySlug)
      ? defaultSubcategorySlug
      : initialCategoryOption?.subcategorySlug && subcategories.some((child) => slugifySubcategoryValue(child) === initialCategoryOption.subcategorySlug)
        ? initialCategoryOption.subcategorySlug
      : fallbackSubcategory;
  const [subcategorySlug, setSubcategorySlug] = useState(initialSubcategory);
  const isRental = kind === "arenda" && isRentalCategorySlug(categorySlug);
  const selectedSubcategoryName = subcategories.find((child) => slugifySubcategoryValue(child) === subcategorySlug) ?? subcategories[0] ?? "";
  const bookingMode: BookingDetails["mode"] = selectedSubcategoryName === "Походы" ? "tour" : "stay";

  function setCategoryWithSubcategory(nextOption: ListingCategoryOption, nextKind = kind) {
    const nextCategory = categories.find((category) => category.slug === nextOption.categorySlug);
    const orderedSubcategories = orderSubcategoriesLikeCatalog(nextCategory?.children ?? []);
    const nextSubcategories = nextKind === "arenda" ? getRentalSubcategories(nextOption.categorySlug, orderedSubcategories) : orderedSubcategories;
    const nextSubcategory = nextOption.subcategorySlug && nextSubcategories.some((child) => slugifySubcategoryValue(child) === nextOption.subcategorySlug)
      ? nextOption.subcategorySlug
      : nextSubcategories[0]
        ? slugifySubcategoryValue(nextSubcategories[0])
        : "";

    setCategoryOptionValue(nextOption.value);
    setCategorySlug(nextOption.categorySlug);
    setSubcategorySlug(nextSubcategory);
  }

  function handleKindChange(nextKind: string) {
    const safeKind = listingKindOptions.some((option) => option.value === nextKind) ? (nextKind as ListingKind) : "prodam";

    setKind(safeKind);

    if (safeKind === "arenda") {
      const rentalCategorySlug = isRentalCategorySlug(categorySlug) ? categorySlug : fallbackRentalCategory.slug;
      const rentalOption = getCategoryOptionByCategorySlug(rentalCategorySlug);

      if (rentalOption) {
        setCategoryWithSubcategory(rentalOption, safeKind);
      }
      return;
    }

    const currentOption = listingCategoryOptions.find((option) => option.value === categoryOptionValue);

    if (currentOption?.preferredKind === "arenda") {
      const baseOption = getCategoryOptionByCategorySlug(categorySlug);

      if (baseOption) {
        setCategoryWithSubcategory(baseOption, safeKind);
      }
    }
  }

  function handleCategoryChange(nextOptionValue: string) {
    const nextOption = listingCategoryOptions.find((option) => option.value === nextOptionValue);

    if (!nextOption) {
      return;
    }

    const nextKind =
      nextOption.preferredKind ??
      (kind === "arenda" && !isRentalCategorySlug(nextOption.categorySlug) ? "prodam" : kind);

    setKind(nextKind);
    setCategoryWithSubcategory(nextOption, nextKind);
  }

  function handleSubcategoryChange(nextSubcategorySlug: string) {
    setSubcategorySlug(nextSubcategorySlug);

    if (isRentalSubcategorySlug(categorySlug, nextSubcategorySlug, slugifySubcategoryValue)) {
      setKind("arenda");
      return;
    }

    if (kind === "arenda") {
      setKind("prodam");
    }
  }

  return (
    <>
      <label className="listing-kind-field form-field block min-w-0" data-field-size="sm">
        <span className="text-xs font-bold text-slate-700 sm:text-sm">Тип объявления</span>
        <span className="mt-1 block sm:mt-2">
          <DropdownSelect name="kind" value={kind} onValueChange={handleKindChange} options={listingKindOptions} buttonClassName="min-h-10 !h-auto gap-1 px-2 py-2 text-xs sm:min-h-12 sm:gap-3 sm:px-4 sm:text-sm" />
        </span>
      </label>

      <label className="listing-category-field form-field block min-w-0" data-field-size="md">
        <span className="text-xs font-bold text-slate-700 sm:text-sm">Категория</span>
        <span className="mt-1 block sm:mt-2">
          <input type="hidden" name="category" value={categorySlug} />
          <DropdownSelect
            value={categoryOptionValue}
            onValueChange={handleCategoryChange}
            buttonClassName="min-h-10 !h-auto gap-1 px-2 py-2 text-xs sm:min-h-12 sm:gap-3 sm:px-4 sm:text-sm"
            options={listingCategoryOptions.map((option) => ({ value: option.value, label: option.label }))}
          />
        </span>
      </label>

      <label className="listing-subcategory-field form-field block min-w-0" data-field-size="md">
        <span className="text-xs font-bold text-slate-700 sm:text-sm">Подкатегория</span>
        <span className="mt-1 block sm:mt-2">
          <DropdownSelect
            key={categorySlug}
            name="subcategory"
            value={subcategorySlug}
            onValueChange={handleSubcategoryChange}
            buttonClassName="min-h-10 !h-auto gap-1 px-2 py-2 text-xs sm:min-h-12 sm:gap-3 sm:px-4 sm:text-sm"
            options={
              subcategories.length
                ? subcategories.map((child) => ({ value: slugifySubcategoryValue(child), label: child }))
                : [{ value: "", label: "Без подкатегории" }]
            }
          />
        </span>
      </label>

      {isRental ? null : <ListingPriceField defaultValue={defaultPrice} />}

      {isRental ? (
        <div className="listing-booking-fields order-last col-span-full">
          <ListingBookingFields booking={booking} mode={bookingMode} />
        </div>
      ) : null}
    </>
  );
}

export function ListingPhotoUploader() {
  const [media, setMedia] = useState<PreviewMedia[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [cropEditorId, setCropEditorId] = useState("");
  const [mediaMessage, setMediaMessage] = useState("");
  const urlsRef = useRef<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const maxFiles = 20;
  const availableSlots = maxFiles - media.length;
  const heroMedia = media[0];
  const selectedMedia = media.find((item) => item.id === selectedId) ?? heroMedia;
  const cropEditorMedia = media.find((item) => item.id === cropEditorId && item.kind === "image");

  useEffect(() => {
    return () => {
      urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      urlsRef.current = [];
    };
  }, []);

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? []).slice(0, availableSlots);
    const currentTotalSize = media.reduce((sum, item) => sum + item.file.size, 0);
    const { accepted, rejectedMessages } = filterListingMediaFiles(selectedFiles, currentTotalSize);
    const files = accepted.slice(0, availableSlots);

    setMediaMessage(rejectedMessages[0] ?? "");

    if (!files.length) {
      syncFileInput(media);
      return;
    }

    const nextMedia = files.map((file) => {
      const url = URL.createObjectURL(file);
      urlsRef.current.push(url);
      const kind = file.type.startsWith("video/") ? "video" : "image";

      return {
        id: `${file.name}-${file.size}-${url}`,
        file,
        sourceFile: file,
        kind,
        name: file.name,
        sourceUrl: url,
        url,
      } satisfies PreviewMedia;
    });
    setMedia((current) => {
      const updated = [...current, ...nextMedia];
      syncFileInput(updated);
      return updated;
    });
    setSelectedId(nextMedia[0]?.id ?? selectedId);
  }

  function removeMedia(item: PreviewMedia) {
    URL.revokeObjectURL(item.sourceUrl);

    if (item.url !== item.sourceUrl) {
      URL.revokeObjectURL(item.url);
    }

    urlsRef.current = urlsRef.current.filter((url) => url !== item.url && url !== item.sourceUrl);
    setMedia((current) => {
      const updated = current.filter((mediaItem) => mediaItem.id !== item.id);
      syncFileInput(updated);

      if (selectedId === item.id) {
        setSelectedId(updated[0]?.id ?? "");
      }

      return updated;
    });
  }

  function syncFileInput(nextMedia: PreviewMedia[]) {
    if (!inputRef.current) {
      return;
    }

    const dataTransfer = new DataTransfer();
    nextMedia.forEach((item) => dataTransfer.items.add(item.file));
    inputRef.current.files = dataTransfer.files;
  }

  function openFileDialog() {
    if (availableSlots > 0) {
      inputRef.current?.click();
    }
  }

  function openMediaLibrary() {
    setLibraryOpen(true);
    setSelectedId((current) => current || heroMedia?.id || "");
  }

  function selectMedia(item: PreviewMedia) {
    setSelectedId(item.id);
  }

  function makeCover(item: PreviewMedia) {
    setMedia((current) => {
      const target = current.find((mediaItem) => mediaItem.id === item.id);

      if (!target) {
        return current;
      }

      const updated = [target, ...current.filter((mediaItem) => mediaItem.id !== item.id)];
      syncFileInput(updated);
      return updated;
    });
  }

  async function applySquareCrop(item: PreviewMedia, dataUrl: string) {
    const croppedFile = await dataUrlToImageFile(dataUrl, item.name);
    const croppedUrl = URL.createObjectURL(croppedFile);
    urlsRef.current.push(croppedUrl);

    setMedia((current) => {
      const updated = current.map((mediaItem) => {
        if (mediaItem.id !== item.id) {
          return mediaItem;
        }

        if (mediaItem.url !== mediaItem.sourceUrl) {
          URL.revokeObjectURL(mediaItem.url);
          urlsRef.current = urlsRef.current.filter((url) => url !== mediaItem.url);
        }

        return {
          ...mediaItem,
          file: croppedFile,
          url: croppedUrl,
        };
      });

      syncFileInput(updated);
      return updated;
    });
    setCropEditorId("");
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <input ref={inputRef} className="sr-only" type="file" accept="image/*" name="photos" multiple onChange={handleFiles} />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Camera className="h-5 w-5 shrink-0 text-[#0875d1]" />
          <div>
            <h2 className="font-bold text-slate-800">Фото объявления</h2>
            <p className="mt-1 text-sm text-slate-500">{media.length ? `${media.length} из ${maxFiles}` : "Файлы не выбраны"}. {listingMediaLimitText()}</p>
          </div>
        </div>
        <button type="button" onClick={openFileDialog} disabled={availableSlots <= 0} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#0875d1] px-4 text-sm font-bold text-white transition hover:bg-[#0669bd] disabled:cursor-not-allowed disabled:opacity-50">
          <ImagePlus className="h-4 w-4" />
          Добавить файлы
        </button>
      </div>

      <button type="button" onClick={media.length ? openMediaLibrary : openFileDialog} className="mt-4 grid w-full grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-blue-200 hover:bg-blue-50/40">
        <span className="relative flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-blue-50 text-[#0875d1]">
          {heroMedia ? (
            heroMedia.kind === "video" ? (
              <video src={heroMedia.url} className="h-full w-full bg-slate-950 object-cover" muted playsInline preload="metadata" />
            ) : (
              <img src={heroMedia.url} alt="" className="h-full w-full object-cover" />
            )
          ) : (
            <ImagePlus className="h-6 w-6" />
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-black text-[#060b27]">{heroMedia ? heroMedia.name : "Добавить медиа"}</span>
          <span className="mt-1 block text-sm font-semibold text-slate-500">{media.length ? `${media.length} файлов` : "Фото"}</span>
        </span>
        <span className="hidden rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 sm:inline-flex">Открыть</span>
      </button>

      {mediaMessage ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{mediaMessage}</p> : null}

      {media.length ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {media.map((item, index) => (
            <figure key={item.id} className="group relative overflow-hidden rounded-lg border border-slate-200 bg-white">
              <button
                type="button"
                onClick={() => {
                  selectMedia(item);
                  setLibraryOpen(true);
                }}
                className="block w-full text-left"
                aria-label={`Открыть файл ${index + 1}`}
              >
                {item.kind === "video" ? (
                  <video src={item.url} className="aspect-square w-full bg-slate-950 object-cover" muted playsInline preload="metadata" />
                ) : (
                  <img src={item.url} alt={item.name || `Фото ${index + 1}`} className="aspect-square w-full bg-slate-50 object-cover" />
                )}
              </button>
              {index === 0 ? (
                <span className="absolute bottom-2 left-2 rounded-lg bg-[#0875d1] px-2.5 py-1.5 text-xs font-black text-white shadow-sm">Обложка</span>
              ) : (
                <button
                  type="button"
                  onClick={() => makeCover(item)}
                  className="absolute bottom-2 left-2 rounded-lg bg-white/95 px-2.5 py-1.5 text-xs font-black text-[#0875d1] shadow-sm transition hover:text-[#0664b3]"
                >
                  Обложка
                </button>
              )}
              <button
                type="button"
                onClick={() => setCropEditorId(item.id)}
                className="absolute bottom-2 right-2 rounded-lg bg-white/95 px-2.5 py-1.5 text-xs font-black text-[#0875d1] shadow-sm transition hover:text-[#0664b3]"
              >
                Кадр
              </button>
              <button
                type="button"
                onClick={() => removeMedia(item)}
                className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-slate-700 shadow-sm transition hover:text-rose-600"
                aria-label={`Удалить файл ${index + 1}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </figure>
          ))}
        </div>
      ) : null}

      {libraryOpen ? (
        <div className="fixed inset-0 z-[200] flex items-stretch justify-center bg-white sm:items-center sm:bg-slate-950/60 sm:p-4" role="dialog" aria-modal="true">
          <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-white shadow-2xl sm:h-auto sm:max-h-[min(42rem,92vh)] sm:max-w-3xl sm:rounded-xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div className="min-w-0">
                <h2 className="text-base font-black text-[#060b27] sm:text-lg">Медиатека</h2>
                <p className="mt-0.5 text-xs font-semibold text-slate-500 sm:text-sm">{media.length} из {maxFiles}. {listingMediaLimitText()}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button type="button" onClick={openFileDialog} disabled={availableSlots <= 0} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#0875d1] px-3 text-sm font-bold text-white transition hover:bg-[#0669bd] disabled:cursor-not-allowed disabled:opacity-50">
                  <ImagePlus className="h-4 w-4" />
                  Добавить
                </button>
                <button type="button" onClick={() => setLibraryOpen(false)} className="inline-flex h-9 items-center rounded-lg bg-slate-950 px-3 text-sm font-bold text-white transition hover:bg-slate-800">
                  Готово
                </button>
                <button type="button" onClick={() => setLibraryOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:text-rose-600" aria-label="Закрыть">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {selectedMedia ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
                <div className="mx-auto max-w-xl">
                  <div className="relative mx-auto aspect-square max-h-[38dvh] overflow-hidden rounded-xl bg-slate-950 sm:max-h-[22rem]">
                    <img src={selectedMedia.url} alt={selectedMedia.name} className="h-full w-full object-cover" />
                    <div className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-inset ring-white/70" />
                  </div>

                  <div className="mt-3 flex min-w-0 items-center justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-black text-[#060b27]">{selectedMedia.name}</h3>
                      <p className="mt-0.5 text-xs font-semibold text-slate-500">Фото</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button type="button" onClick={() => setCropEditorId(selectedMedia.id)} className="inline-flex h-9 items-center rounded-lg border border-blue-200 bg-blue-50 px-3 text-sm font-bold text-[#0875d1] transition hover:border-[#0875d1] hover:bg-white">
                        Кадр
                      </button>
                      <button type="button" onClick={() => makeCover(selectedMedia)} disabled={heroMedia?.id === selectedMedia.id} className="inline-flex h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 transition hover:border-blue-200 hover:text-[#0875d1] disabled:opacity-50">
                        Обложка
                      </button>
                      <button type="button" onClick={() => removeMedia(selectedMedia)} className="inline-flex h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 transition hover:text-rose-600">
                        Удалить
                      </button>
                    </div>
                  </div>

                  <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold leading-6 text-slate-600">Для карточек используется квадратный кадр. Нажмите “Кадр”, чтобы перетащить фото и настроить масштаб.</p>
                </div>
              </div>
            ) : (
              <div className="flex min-h-72 flex-1 items-center justify-center p-4">
                <button type="button" onClick={openFileDialog} className="flex min-h-52 w-full max-w-md items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-sm font-bold text-slate-500 transition hover:border-blue-300 hover:bg-blue-50/40">
                  <span className="inline-flex items-center gap-2">
                    <Camera className="h-4 w-4" />
                    Выбрать файлы
                  </span>
                </button>
              </div>
            )}

            {mediaMessage ? <p className="border-t border-rose-100 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700">{mediaMessage}</p> : null}

            {media.length ? (
              <div className="border-t border-slate-200 px-3 py-2 sm:px-4">
                <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {media.map((item, index) => {
                    const selected = selectedMedia?.id === item.id;

                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => selectMedia(item)}
                        className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border bg-slate-100 text-left transition sm:h-20 sm:w-20 ${
                          selected ? "border-[#0875d1] ring-2 ring-blue-100" : "border-slate-200 hover:border-blue-200"
                        }`}
                      >
                        <img src={item.url} alt={item.name} className="h-full w-full object-cover" />
                        <span className="absolute left-1 top-1 rounded-full bg-white/95 px-1.5 py-0.5 text-[10px] font-black text-slate-700">{index + 1}</span>
                        {index === 0 ? <span className="absolute bottom-1 left-1 rounded-full bg-[#0875d1] px-1.5 py-0.5 text-[10px] font-black text-white">Обл.</span> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

          </div>
        </div>
      ) : null}
      {cropEditorMedia ? (
        <SquareImageCropper
          alt={cropEditorMedia.name}
          onApply={(dataUrl) => applySquareCrop(cropEditorMedia, dataUrl)}
          onCancel={() => setCropEditorId("")}
          src={cropEditorMedia.sourceUrl}
          title="Кадр для карточки"
        />
      ) : null}
    </section>
  );
}
