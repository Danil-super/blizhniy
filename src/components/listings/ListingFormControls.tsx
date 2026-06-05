"use client";

/* eslint-disable @next/next/no-img-element */

import { ChangeEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import type { InputHTMLAttributes } from "react";
import { Camera, Video, X } from "lucide-react";
import { DropdownSelect } from "@/components/DropdownSelect";
import { YandexMapPicker } from "@/components/YandexMapPicker";
import { categories, cities, region } from "@/lib/data";
import { hasMapCoordinates } from "@/lib/map-location";
import type { BookingDetails, ListingKind } from "@/lib/types";

type Suggestion = {
  label: string;
  hint?: string;
};

type PreviewMedia = {
  id: string;
  file: File;
  kind: "image" | "video";
  name: string;
  url: string;
};

const listingKindOptions: Array<{ value: ListingKind; label: string }> = [
  { value: "prodam", label: "Продам" },
  { value: "kuplyu", label: "Куплю" },
  { value: "arenda", label: "Аренда" },
  { value: "menyayu", label: "Меняю" },
  { value: "otdam-darom", label: "Отдам даром" },
];

const rentalCategorySlugs = ["otdyh", "nedvizhimost"];
const rentalSubcategoryNames: Record<string, string[] | undefined> = {
  nedvizhimost: ["Коммерческая недвижимость"],
};

const citySuggestions: Suggestion[] = cities.map((city) => ({
  label: `${city.name}, ${region.name}`,
  hint: "город",
}));

function formatCityValue(city?: string) {
  if (!city) {
    return `${cities[0]?.name ?? "Краснодар"}, ${region.name}`;
  }

  return city.includes(region.name) ? city : `${city}, ${region.name}`;
}

function slugifySubcategoryValue(name: string) {
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

function isRentalCategory(categorySlug: string) {
  return rentalCategorySlugs.includes(categorySlug);
}

function getRentalSubcategories(categorySlug: string, subcategories: string[]) {
  const allowedNames = rentalSubcategoryNames[categorySlug];

  if (!allowedNames) {
    return subcategories;
  }

  return subcategories.filter((subcategory) => allowedNames.includes(subcategory));
}

function filterSuggestions(suggestions: Suggestion[], value: string) {
  const query = value.trim().toLowerCase();

  if (!query) {
    return suggestions;
  }

  return suggestions.filter((suggestion) => {
    const label = suggestion.label.toLowerCase();
    return label.startsWith(query) || label.includes(query);
  });
}

function AutocompleteInput({
  label,
  name,
  defaultValue,
  placeholder,
  selectOnFocus = false,
  suggestions,
  inputProps = {},
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder: string;
  selectOnFocus?: boolean;
  suggestions: Suggestion[];
  inputProps?: InputHTMLAttributes<HTMLInputElement>;
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  const [open, setOpen] = useState(false);
  const filtered = useMemo(() => filterSuggestions(suggestions, value), [suggestions, value]);

  return (
    <div className="relative">
      <span className="text-sm font-bold text-slate-700">{label}</span>
      <input
        name={name}
        className="mt-2 h-11 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-[#0875d1] sm:h-12 sm:px-4 sm:text-base"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setOpen(true);
        }}
        onFocus={(event) => {
          setOpen(true);

          if (selectOnFocus) {
            event.currentTarget.select();
          }
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        placeholder={placeholder}
        autoComplete="off"
        {...inputProps}
      />
      {open && filtered.length ? (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 max-h-[14.75rem] overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl shadow-slate-900/10">
          {filtered.map((suggestion) => (
            <button
              key={suggestion.label}
              type="button"
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition hover:bg-blue-50 hover:text-[#0875d1]"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setValue(suggestion.label);
                setOpen(false);
              }}
            >
              <span className="min-w-0 break-words font-semibold [overflow-wrap:anywhere]">{suggestion.label}</span>
              {suggestion.hint ? <span className="shrink-0 text-xs text-slate-500">{suggestion.hint}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
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
      <div className={inlineControls ? "listing-location-row grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(24rem,0.8fr)] lg:items-start" : "listing-location-row grid gap-4"}>
        <AutocompleteInput
          label={cityLabel}
          name={cityFieldName}
          defaultValue={formatCityValue(defaultCity)}
          placeholder="Начните вводить город"
          selectOnFocus
          suggestions={citySuggestions}
          inputProps={{
            maxLength: 80,
            required: true,
            title: "Выберите город из списка или укажите город и регион.",
          }}
        />
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
      </div>
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
  defaultCategorySlug = "mebel-i-interer",
  defaultSubcategorySlug,
}: {
  defaultCategorySlug?: string;
  defaultSubcategorySlug?: string;
}) {
  const fallbackCategory = categories.find((category) => category.slug === defaultCategorySlug) ?? categories[0];
  const [categorySlug, setCategorySlug] = useState(fallbackCategory?.slug ?? "");
  const selectedCategory = categories.find((category) => category.slug === categorySlug) ?? fallbackCategory;
  const subcategories = selectedCategory?.children ?? [];
  const fallbackSubcategory = subcategories[0] ? slugifySubcategoryValue(subcategories[0]) : "";
  const selectedSubcategory =
    defaultSubcategorySlug && subcategories.some((child) => slugifySubcategoryValue(child) === defaultSubcategorySlug)
      ? defaultSubcategorySlug
      : fallbackSubcategory;

  return (
    <>
      <label className="block min-w-0">
        <span className="text-sm font-bold text-slate-700">Категория</span>
        <span className="mt-2 block">
          <DropdownSelect
            name="category"
            value={categorySlug}
            onValueChange={setCategorySlug}
            options={categories.map((category) => ({ value: category.slug, label: category.name }))}
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
  name,
  placeholder,
}: {
  defaultValue?: number;
  label: string;
  name: string;
  placeholder: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-bold text-slate-700">{label}</span>
      <input
        name={name}
        type="number"
        min="0"
        defaultValue={defaultValue}
        className="mt-2 h-12 w-full rounded-lg border border-slate-300 px-4 outline-none focus:border-[#0875d1]"
        placeholder={placeholder}
      />
    </label>
  );
}

function BookingTextInput({
  defaultValue,
  label,
  name,
  placeholder,
  type = "text",
}: {
  defaultValue?: string;
  label: string;
  name: string;
  placeholder: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-bold text-slate-700">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        className="mt-2 h-12 w-full rounded-lg border border-slate-300 px-4 outline-none focus:border-[#0875d1]"
        placeholder={placeholder}
      />
    </label>
  );
}

function ListingBookingFields({ booking, mode }: { booking?: BookingDetails; mode: BookingDetails["mode"] }) {
  const isTour = mode === "tour";

  return (
    <section className="rounded-xl border border-blue-200 bg-blue-50/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-[#060b27]">{isTour ? "Параметры похода" : "Параметры бронирования"}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
            {isTour
              ? "Укажите дату, время, длительность, стоимость и условия участия. Эти данные будут показаны в карточке объявления."
              : "Укажите цены, доступные даты и занятые дни. В карточке объявления пользователь сможет выбрать даты и увидеть итоговую стоимость."}
          </p>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-[#0875d1]">Аренда</span>
      </div>
      <input type="hidden" name="bookingMode" value={mode} />

      {isTour ? (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <BookingNumberInput name="bookingPricePerPerson" label="Стоимость с человека, ₽" placeholder="3500" defaultValue={booking?.pricePerPerson} />
          <BookingNumberInput name="bookingMaxGuests" label="Количество мест" placeholder="12" defaultValue={booking?.maxGuests} />
          <BookingTextInput name="tourDate" label="Дата похода" type="date" placeholder="" defaultValue={booking?.tourDate} />
          <BookingTextInput name="tourTime" label="Время старта" type="time" placeholder="" defaultValue={booking?.tourTime} />
          <BookingTextInput name="tourDuration" label="Продолжительность" placeholder="6 часов / 2 дня" defaultValue={booking?.tourDuration} />
          <BookingTextInput name="tourDifficulty" label="Сложность" placeholder="Легкий / средний / сложный" defaultValue={booking?.tourDifficulty} />
          <div className="md:col-span-2">
            <BookingTextInput name="tourMeetingPoint" label="Место сбора" placeholder="Краснодар, парковка у ТЦ..." defaultValue={booking?.tourMeetingPoint} />
          </div>
        </div>
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <BookingNumberInput name="bookingPriceWeekday" label="Цена за сутки в будни, ₽" placeholder="6000" defaultValue={booking?.priceWeekday} />
          <BookingNumberInput name="bookingPriceWeekend" label="Цена за сутки в выходные, ₽" placeholder="8500" defaultValue={booking?.priceWeekend} />
          <BookingNumberInput name="bookingMinNights" label="Минимум ночей" placeholder="1" defaultValue={booking?.minNights} />
          <BookingNumberInput name="bookingIncludedGuests" label="Гостей включено в цену" placeholder="4" defaultValue={booking?.includedGuests} />
          <BookingNumberInput name="bookingMaxGuests" label="Максимум гостей" placeholder="8" defaultValue={booking?.maxGuests} />
          <BookingNumberInput name="bookingExtraGuestPrice" label="Доплата за гостя за сутки, ₽" placeholder="900" defaultValue={booking?.extraGuestPrice} />
          <BookingTextInput name="bookingAvailableFrom" label="Можно арендовать с" type="date" placeholder="" defaultValue={booking?.availableFrom} />
          <BookingTextInput name="bookingAvailableTo" label="Можно арендовать до" type="date" placeholder="" defaultValue={booking?.availableTo} />
          <BookingTextInput name="bookingCheckIn" label="Заезд" type="time" placeholder="" defaultValue={booking?.checkInTime} />
          <BookingTextInput name="bookingCheckOut" label="Выезд" type="time" placeholder="" defaultValue={booking?.checkOutTime} />
          <label className="block md:col-span-2">
            <span className="text-sm font-bold text-slate-700">Занятые даты</span>
            <textarea
              name="bookingBlockedDates"
              defaultValue={booking?.blockedDates?.join(", ")}
              className="mt-2 min-h-20 w-full rounded-lg border border-slate-300 px-4 py-3 outline-none focus:border-[#0875d1]"
              placeholder="2026-06-10, 2026-06-11, 2026-06-20"
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
            className="mt-2 min-h-24 w-full rounded-lg border border-slate-300 px-4 py-3 outline-none focus:border-[#0875d1]"
            placeholder={isTour ? "Трансфер, инструктор, перекус, страховка" : "Мангал, баня, бассейн, парковка"}
          />
        </label>
        <label className="block">
          <span className="text-sm font-bold text-slate-700">Правила и ограничения</span>
          <textarea
            name="bookingRules"
            defaultValue={booking?.rules}
            className="mt-2 min-h-24 w-full rounded-lg border border-slate-300 px-4 py-3 outline-none focus:border-[#0875d1]"
            placeholder={isTour ? "Что взять с собой, возраст, отмена" : "Можно ли с детьми, животными, условия отмены"}
          />
        </label>
      </div>
    </section>
  );
}

export function ListingKindAndCategoryFields({
  defaultCategorySlug = "mebel-i-interer",
  defaultKind = "prodam",
  defaultSubcategorySlug,
  booking,
}: {
  defaultCategorySlug?: string;
  defaultKind?: ListingKind;
  defaultSubcategorySlug?: string;
  booking?: BookingDetails;
}) {
  const rentalCategories = categories.filter((category) => isRentalCategory(category.slug));
  const fallbackCategory = categories.find((category) => category.slug === defaultCategorySlug) ?? categories[0];
  const fallbackRentalCategory = rentalCategories[0] ?? fallbackCategory;
  const initialCategory = defaultKind === "arenda" ? (isRentalCategory(fallbackCategory?.slug ?? "") ? fallbackCategory : fallbackRentalCategory) : fallbackCategory;
  const [categorySlug, setCategorySlug] = useState(initialCategory?.slug ?? "");
  const selectedCategory = categories.find((category) => category.slug === categorySlug) ?? fallbackCategory;
  const [kind, setKind] = useState<ListingKind>(defaultCategorySlug === "otdyh" || defaultKind === "arenda" ? "arenda" : defaultKind);
  const allSubcategories = selectedCategory?.children ?? [];
  const subcategories = kind === "arenda" ? getRentalSubcategories(categorySlug, allSubcategories) : allSubcategories;
  const fallbackSubcategory = subcategories[0] ? slugifySubcategoryValue(subcategories[0]) : "";
  const initialSubcategory =
    defaultSubcategorySlug && subcategories.some((child) => slugifySubcategoryValue(child) === defaultSubcategorySlug)
      ? defaultSubcategorySlug
      : fallbackSubcategory;
  const [subcategorySlug, setSubcategorySlug] = useState(initialSubcategory);
  const isRental = kind === "arenda" && isRentalCategory(categorySlug);
  const selectedSubcategoryName = subcategories.find((child) => slugifySubcategoryValue(child) === subcategorySlug) ?? subcategories[0] ?? "";
  const bookingMode: BookingDetails["mode"] = selectedSubcategoryName === "Походы" ? "tour" : "stay";
  const categoryOptions = kind === "arenda" ? rentalCategories : categories;

  function setCategoryWithFirstSubcategory(nextCategorySlug: string, nextKind = kind) {
    const nextCategory = categories.find((category) => category.slug === nextCategorySlug);
    const nextSubcategories = nextKind === "arenda" ? getRentalSubcategories(nextCategorySlug, nextCategory?.children ?? []) : nextCategory?.children ?? [];
    const nextFirstSubcategory = nextSubcategories[0] ? slugifySubcategoryValue(nextSubcategories[0]) : "";

    setCategorySlug(nextCategorySlug);
    setSubcategorySlug(nextFirstSubcategory);
  }

  function handleKindChange(nextKind: string) {
    const safeKind = listingKindOptions.some((option) => option.value === nextKind) ? (nextKind as ListingKind) : "prodam";

    setKind(safeKind);

    if (safeKind === "arenda") {
      setCategoryWithFirstSubcategory(isRentalCategory(categorySlug) ? categorySlug : fallbackRentalCategory.slug, safeKind);
      return;
    }

    if (isRentalCategory(categorySlug)) {
      setCategoryWithFirstSubcategory("mebel-i-interer");
    }
  }

  function handleCategoryChange(nextCategorySlug: string) {
    const nextKind = kind === "arenda" || nextCategorySlug === "otdyh" ? "arenda" : kind;
    setCategoryWithFirstSubcategory(nextCategorySlug, nextKind);

    if (nextCategorySlug === "otdyh") {
      setKind("arenda");
    } else if (kind === "arenda") {
      setKind(isRentalCategory(nextCategorySlug) ? "arenda" : "prodam");
    }
  }

  return (
    <>
      <label className="block min-w-0">
        <span className="text-xs font-bold text-slate-700 sm:text-sm">Тип объявления</span>
        <span className="mt-1 block sm:mt-2">
          <DropdownSelect name="kind" value={kind} onValueChange={handleKindChange} options={listingKindOptions} buttonClassName="min-h-10 !h-auto gap-1 px-2 py-2 text-xs sm:min-h-12 sm:gap-3 sm:px-4 sm:text-sm" />
        </span>
      </label>

      <label className="block min-w-0">
        <span className="text-xs font-bold text-slate-700 sm:text-sm">Категория</span>
        <span className="mt-1 block sm:mt-2">
          <DropdownSelect
            name="category"
            value={categorySlug}
            onValueChange={handleCategoryChange}
            buttonClassName="min-h-10 !h-auto gap-1 px-2 py-2 text-xs sm:min-h-12 sm:gap-3 sm:px-4 sm:text-sm"
            options={categoryOptions.map((category) => ({ value: category.slug, label: category.name }))}
          />
        </span>
      </label>

      <label className="block min-w-0">
        <span className="text-xs font-bold text-slate-700 sm:text-sm">Подкатегория</span>
        <span className="mt-1 block sm:mt-2">
          <DropdownSelect
            key={categorySlug}
            name="subcategory"
            value={subcategorySlug}
            onValueChange={setSubcategorySlug}
            buttonClassName="min-h-10 !h-auto gap-1 px-2 py-2 text-xs sm:min-h-12 sm:gap-3 sm:px-4 sm:text-sm"
            options={
              subcategories.length
                ? subcategories.map((child) => ({ value: slugifySubcategoryValue(child), label: child }))
                : [{ value: "", label: "Без подкатегории" }]
            }
          />
        </span>
      </label>

      {isRental ? (
        <div className="col-span-full">
          <ListingBookingFields booking={booking} mode={bookingMode} />
        </div>
      ) : null}
    </>
  );
}

export function ListingPhotoUploader() {
  const [media, setMedia] = useState<PreviewMedia[]>([]);
  const urlsRef = useRef<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const maxFiles = 20;
  const availableSlots = maxFiles - media.length;

  useEffect(() => {
    return () => {
      urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      urlsRef.current = [];
    };
  }, []);

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
      .filter((file) => file.type.startsWith("image/") || file.type.startsWith("video/"))
      .slice(0, availableSlots);

    if (!files.length) {
      syncFileInput(media);
      return;
    }

    const nextMedia = files.map((file) => {
      const url = URL.createObjectURL(file);
      urlsRef.current.push(url);

      return {
        id: `${file.name}-${file.size}-${url}`,
        file,
        kind: file.type.startsWith("video/") ? "video" : "image",
        name: file.name,
        url,
      } satisfies PreviewMedia;
    });

    setMedia((current) => {
      const updated = [...current, ...nextMedia];
      syncFileInput(updated);
      return updated;
    });
  }

  function removeMedia(item: PreviewMedia) {
    URL.revokeObjectURL(item.url);
    urlsRef.current = urlsRef.current.filter((url) => url !== item.url);
    setMedia((current) => {
      const updated = current.filter((mediaItem) => mediaItem.id !== item.id);
      syncFileInput(updated);
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

  return (
    <section
      className="cursor-pointer rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 transition hover:border-blue-300 hover:bg-blue-50/40 sm:p-5"
      onClick={openFileDialog}
    >
      <input ref={inputRef} className="sr-only" type="file" accept="image/*,video/*" name="photos" multiple onChange={handleFiles} />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Camera className="h-5 w-5 shrink-0 text-[#0875d1]" />
          <div>
            <h2 className="font-bold text-slate-800">Фото и видео объявления</h2>
            <p className="mt-1 text-sm text-slate-500">До {maxFiles} файлов. Сейчас выбрано: {media.length}.</p>
          </div>
        </div>
        <span className="text-sm font-semibold text-[#0875d1]">{availableSlots > 0 ? "Нажмите в область, чтобы выбрать файлы" : "Лимит файлов заполнен"}</span>
      </div>

      {media.length ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          {media.map((item, index) => (
            <figure key={item.id} className="group relative overflow-hidden rounded-lg border border-slate-200 bg-white">
              {item.kind === "video" ? (
                <video src={item.url} className="aspect-square w-full bg-slate-950 object-cover" muted playsInline preload="metadata" />
              ) : (
                <img src={item.url} alt={`Фото ${index + 1}: ${item.name}`} className="aspect-square w-full bg-slate-50 object-contain p-1" />
              )}
              {item.kind === "video" ? (
                <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-slate-950/70 px-2 py-1 text-[11px] font-bold text-white">
                  <Video className="h-3 w-3" />
                  Видео
                </span>
              ) : null}
              <figcaption className="sr-only">{item.name}</figcaption>
              <button
                type="button"
                data-photo-remove
                onClick={(event) => {
                  event.stopPropagation();
                  removeMedia(item);
                }}
                className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/95 text-slate-700 shadow-sm transition hover:text-rose-600"
                aria-label={`Удалить ${item.name}`}
              >
                <X className="h-4 w-4" />
              </button>
            </figure>
          ))}
        </div>
      ) : (
        <div className="mt-4 flex min-h-28 w-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-sm font-semibold text-slate-500">
          <span className="inline-flex items-center gap-2">
            <Camera className="h-4 w-4" />
            Нажмите, чтобы добавить фото или видео
          </span>
        </div>
      )}
    </section>
  );
}
