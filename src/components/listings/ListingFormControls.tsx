"use client";

/* eslint-disable @next/next/no-img-element */

import { ChangeEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import type { InputHTMLAttributes } from "react";
import { Camera, Crop, ImagePlus, RotateCcw, SlidersHorizontal, Video, X } from "lucide-react";
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
  sourceFile: File;
  kind: "image" | "video";
  name: string;
  sourceUrl: string;
  url: string;
  crop?: ImageCrop;
};

type ImageCrop = {
  zoom: number;
  positionX: number;
  positionY: number;
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

function loadPreviewImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Не удалось открыть изображение"));
    image.src = src;
  });
}

function cropFileName(name: string) {
  const base = name.replace(/\.[^.]+$/, "") || "photo";
  return `${base}-preview.jpg`;
}

async function createCroppedImageFile(item: PreviewMedia, crop: ImageCrop) {
  const image = await loadPreviewImage(item.sourceUrl);
  const size = 1200;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Не удалось подготовить изображение");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, size, size);

  const imageWidth = image.naturalWidth || image.width;
  const imageHeight = image.naturalHeight || image.height;
  const scale = Math.max(size / imageWidth, size / imageHeight) * crop.zoom;
  const drawWidth = imageWidth * scale;
  const drawHeight = imageHeight * scale;
  const extraX = Math.max(0, drawWidth - size);
  const extraY = Math.max(0, drawHeight - size);
  const drawX = -extraX * (crop.positionX / 100);
  const drawY = -extraY * (crop.positionY / 100);

  context.drawImage(image, drawX, drawY, drawWidth, drawHeight);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) {
        resolve(result);
      } else {
        reject(new Error("Не удалось сохранить кадр"));
      }
    }, "image/jpeg", 0.88);
  });

  return new File([blob], cropFileName(item.name), { type: "image/jpeg" });
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
      <label className="listing-kind-field block min-w-0">
        <span className="text-xs font-bold text-slate-700 sm:text-sm">Тип объявления</span>
        <span className="mt-1 block sm:mt-2">
          <DropdownSelect name="kind" value={kind} onValueChange={handleKindChange} options={listingKindOptions} buttonClassName="min-h-10 !h-auto gap-1 px-2 py-2 text-xs sm:min-h-12 sm:gap-3 sm:px-4 sm:text-sm" />
        </span>
      </label>

      <label className="listing-category-field block min-w-0">
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

      <label className="listing-subcategory-field block min-w-0">
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
        <div className="listing-booking-fields col-span-full">
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
  const [cropDraft, setCropDraft] = useState<ImageCrop>({ zoom: 1, positionX: 50, positionY: 50 });
  const [cropError, setCropError] = useState("");
  const [cropping, setCropping] = useState(false);
  const urlsRef = useRef<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const maxFiles = 20;
  const availableSlots = maxFiles - media.length;
  const heroMedia = media[0];
  const selectedMedia = media.find((item) => item.id === selectedId) ?? heroMedia;

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
      const kind = file.type.startsWith("video/") ? "video" : "image";

      return {
        id: `${file.name}-${file.size}-${url}`,
        file,
        sourceFile: file,
        kind,
        name: file.name,
        sourceUrl: url,
        url,
        crop: kind === "image" ? { zoom: 1, positionX: 50, positionY: 50 } : undefined,
      } satisfies PreviewMedia;
    });

    setMedia((current) => {
      const updated = [...current, ...nextMedia];
      syncFileInput(updated);
      return updated;
    });
    setSelectedId(nextMedia[0]?.id ?? selectedId);
    setLibraryOpen(true);
    event.currentTarget.value = "";
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
    setCropError("");
  }

  async function applyCrop() {
    if (!selectedMedia || selectedMedia.kind !== "image") {
      return;
    }

    setCropping(true);
    setCropError("");

    try {
      const croppedFile = await createCroppedImageFile(selectedMedia, cropDraft);
      const croppedUrl = URL.createObjectURL(croppedFile);
      urlsRef.current.push(croppedUrl);

      setMedia((current) => {
        const updated = current.map((item) => {
          if (item.id !== selectedMedia.id) {
            return item;
          }

          if (item.url !== item.sourceUrl) {
            URL.revokeObjectURL(item.url);
            urlsRef.current = urlsRef.current.filter((url) => url !== item.url);
          }

          return {
            ...item,
            file: croppedFile,
            url: croppedUrl,
            crop: cropDraft,
          };
        });
        syncFileInput(updated);
        return updated;
      });
    } catch {
      setCropError("Не удалось применить кадр. Попробуйте другое изображение.");
    } finally {
      setCropping(false);
    }
  }

  function resetCropDraft() {
    setCropDraft({ zoom: 1, positionX: 50, positionY: 50 });
  }

  function selectMedia(item: PreviewMedia) {
    setSelectedId(item.id);
    setCropError("");
    setCropDraft(item.crop ?? { zoom: 1, positionX: 50, positionY: 50 });
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

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <input ref={inputRef} className="sr-only" type="file" accept="image/*,video/*" name="photos" multiple onChange={handleFiles} />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Camera className="h-5 w-5 shrink-0 text-[#0875d1]" />
          <div>
            <h2 className="font-bold text-slate-800">Фото и видео объявления</h2>
            <p className="mt-1 text-sm text-slate-500">{media.length ? `${media.length} из ${maxFiles}` : "Файлы не выбраны"}</p>
          </div>
        </div>
        <button type="button" onClick={openMediaLibrary} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#0875d1] px-4 text-sm font-bold text-white transition hover:bg-[#0669bd]">
          <ImagePlus className="h-4 w-4" />
          Медиатека
        </button>
      </div>

      <button type="button" onClick={openMediaLibrary} className="mt-4 grid w-full grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-blue-200 hover:bg-blue-50/40">
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
          <span className="mt-1 block text-sm font-semibold text-slate-500">{media.length ? `${media.length} файлов` : "Фото и видео"}</span>
        </span>
        <span className="hidden rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 sm:inline-flex">Открыть</span>
      </button>

      {libraryOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 sm:items-center sm:p-4" role="dialog" aria-modal="true">
          <div className="flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-xl bg-white shadow-2xl sm:max-h-[min(44rem,92vh)] sm:max-w-3xl sm:rounded-xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div className="min-w-0">
                <h2 className="text-base font-black text-[#060b27] sm:text-lg">Медиатека</h2>
                <p className="mt-0.5 text-xs font-semibold text-slate-500 sm:text-sm">{media.length} из {maxFiles}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button type="button" onClick={openFileDialog} disabled={availableSlots <= 0} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#0875d1] px-3 text-sm font-bold text-white transition hover:bg-[#0669bd] disabled:cursor-not-allowed disabled:opacity-50">
                  <ImagePlus className="h-4 w-4" />
                  Добавить
                </button>
                <button type="button" onClick={() => setLibraryOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:text-rose-600" aria-label="Закрыть">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {selectedMedia ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
                <div className="mx-auto max-w-xl">
                  <div className="relative mx-auto aspect-square max-h-[44dvh] overflow-hidden rounded-xl bg-slate-950 sm:max-h-[22rem]">
                    {selectedMedia.kind === "video" ? (
                      <video src={selectedMedia.url} className="h-full w-full object-contain" controls playsInline preload="metadata" />
                    ) : (
                      <img
                        src={selectedMedia.sourceUrl}
                        alt={selectedMedia.name}
                        className="h-full w-full object-cover"
                        style={{
                          objectPosition: `${cropDraft.positionX}% ${cropDraft.positionY}%`,
                          transform: `scale(${cropDraft.zoom})`,
                        }}
                      />
                    )}
                    {selectedMedia.kind === "image" ? <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/40" /> : null}
                  </div>

                  <div className="mt-3 flex min-w-0 items-center justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-black text-[#060b27]">{selectedMedia.name}</h3>
                      <p className="mt-0.5 text-xs font-semibold text-slate-500">{selectedMedia.kind === "video" ? "Видео" : "Фото"}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button type="button" onClick={() => makeCover(selectedMedia)} disabled={heroMedia?.id === selectedMedia.id} className="inline-flex h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 transition hover:border-blue-200 hover:text-[#0875d1] disabled:opacity-50">
                        Обложка
                      </button>
                      <button type="button" onClick={() => removeMedia(selectedMedia)} className="inline-flex h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 transition hover:text-rose-600">
                        Удалить
                      </button>
                    </div>
                  </div>

                  {selectedMedia.kind === "image" ? (
                    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="grid gap-3 sm:grid-cols-3">
                        <label className="block">
                          <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                            <SlidersHorizontal className="h-3.5 w-3.5 text-[#0875d1]" />
                            Зум
                          </span>
                          <input type="range" min="1" max="2.8" step="0.05" value={cropDraft.zoom} onChange={(event) => setCropDraft((current) => ({ ...current, zoom: Number(event.target.value) }))} className="mt-1.5 w-full accent-[#0875d1]" />
                        </label>
                        <label className="block">
                          <span className="text-xs font-bold text-slate-700">Гориз.</span>
                          <input type="range" min="0" max="100" step="1" value={cropDraft.positionX} onChange={(event) => setCropDraft((current) => ({ ...current, positionX: Number(event.target.value) }))} className="mt-1.5 w-full accent-[#0875d1]" />
                        </label>
                        <label className="block">
                          <span className="text-xs font-bold text-slate-700">Верт.</span>
                          <input type="range" min="0" max="100" step="1" value={cropDraft.positionY} onChange={(event) => setCropDraft((current) => ({ ...current, positionY: Number(event.target.value) }))} className="mt-1.5 w-full accent-[#0875d1]" />
                        </label>
                      </div>
                      {cropError ? <p className="mt-2 rounded-lg bg-rose-50 p-2 text-xs font-semibold text-rose-700">{cropError}</p> : null}
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button type="button" onClick={applyCrop} disabled={cropping} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-[#0875d1] px-3 text-sm font-bold text-white transition hover:bg-[#0669bd] disabled:cursor-wait disabled:opacity-60">
                          <Crop className="h-4 w-4" />
                          {cropping ? "..." : "Применить"}
                        </button>
                        <button type="button" onClick={resetCropDraft} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50">
                          <RotateCcw className="h-4 w-4" />
                          Сброс
                        </button>
                      </div>
                    </div>
                  ) : null}
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
                        {item.kind === "video" ? (
                          <video src={item.url} className="h-full w-full bg-slate-950 object-cover" muted playsInline preload="metadata" />
                        ) : (
                          <img src={item.url} alt={item.name} className="h-full w-full object-cover" />
                        )}
                        <span className="absolute left-1 top-1 rounded-full bg-white/95 px-1.5 py-0.5 text-[10px] font-black text-slate-700">{index + 1}</span>
                        {index === 0 ? <span className="absolute bottom-1 left-1 rounded-full bg-[#0875d1] px-1.5 py-0.5 text-[10px] font-black text-white">Обл.</span> : null}
                        {item.kind === "video" ? (
                          <span className="absolute right-1 top-1 rounded-full bg-slate-950/70 p-1 text-white">
                            <Video className="h-3 w-3" />
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="border-t border-slate-200 p-3 sm:p-4">
              <button type="button" onClick={() => setLibraryOpen(false)} className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-[#0875d1] px-5 text-sm font-bold text-white transition hover:bg-[#0669bd]">
                Готово
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
