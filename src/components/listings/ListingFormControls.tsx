"use client";

/* eslint-disable @next/next/no-img-element */

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import { DropdownSelect } from "@/components/DropdownSelect";
import { YandexMapPicker } from "@/components/YandexMapPicker";
import { categories, cities, fairApplications, listings, region, specialists, vacancies, workRequests } from "@/lib/data";
import type { BookingDetails, ListingKind } from "@/lib/types";

type Suggestion = {
  label: string;
  hint?: string;
};

type PreviewPhoto = {
  id: string;
  file: File;
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

const staticAddressSuggestions: Suggestion[] = [
  { label: "Краснодар, ул. Красная", hint: "улица" },
  { label: "Краснодар, ТЦ Галерея", hint: "ориентир" },
  { label: "Краснодар, парк Галицкого", hint: "ориентир" },
  { label: "Краснодар, Фестивальный микрорайон", hint: "район" },
  { label: "Краснодар, Юбилейный микрорайон", hint: "район" },
];

const dynamicAddressSuggestions: Suggestion[] = [...listings, ...vacancies, ...workRequests, ...specialists, ...fairApplications].flatMap((item) => {
  const suggestions: Suggestion[] = [];

  if (item.address) {
    suggestions.push({ label: `${item.city}, ${item.address}`, hint: "адрес" });
  }

  if (item.district) {
    suggestions.push({ label: `${item.city}, ${item.district}`, hint: "район" });
  }

  return suggestions;
});

const addressSuggestions: Suggestion[] = uniqueSuggestions([...staticAddressSuggestions, ...dynamicAddressSuggestions]);

function uniqueSuggestions(suggestions: Suggestion[]) {
  const usedLabels = new Set<string>();

  return suggestions.filter((suggestion) => {
    const key = suggestion.label.toLowerCase();

    if (usedLabels.has(key)) {
      return false;
    }

    usedLabels.add(key);
    return true;
  });
}

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
    return suggestions.slice(0, 6);
  }

  return suggestions.filter((suggestion) => suggestion.label.toLowerCase().includes(query)).slice(0, 6);
}

function AutocompleteInput({
  label,
  name,
  defaultValue,
  placeholder,
  selectOnFocus = false,
  suggestions,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder: string;
  selectOnFocus?: boolean;
  suggestions: Suggestion[];
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
      />
      {open && filtered.length ? (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl shadow-slate-900/10">
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
              <span className="min-w-0 truncate font-semibold">{suggestion.label}</span>
              {suggestion.hint ? <span className="shrink-0 text-xs text-slate-500">{suggestion.hint}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ListingLocationFields({ defaultCity, defaultLat, defaultLng }: { defaultCity?: string; defaultLat?: number; defaultLng?: number }) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <AutocompleteInput
          label="Город и регион"
          name="location"
          defaultValue={formatCityValue(defaultCity)}
          placeholder="Начните вводить город"
          selectOnFocus
          suggestions={citySuggestions}
        />
        <AutocompleteInput
          label="Адрес или ориентир (необязательно)"
          name="address"
          placeholder="Улица, ТЦ, остановка или район"
          suggestions={addressSuggestions}
        />
      </div>
      <YandexMapPicker defaultLat={defaultLat} defaultLng={defaultLng} />
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
          <DropdownSelect name="kind" value={kind} onValueChange={handleKindChange} options={listingKindOptions} buttonClassName="h-10 gap-1 px-2 text-xs sm:h-12 sm:gap-3 sm:px-4 sm:text-sm" />
        </span>
      </label>

      <label className="block">
        <span className="text-xs font-bold text-slate-700 sm:text-sm">Категория</span>
        <span className="mt-1 block sm:mt-2">
          <DropdownSelect
            name="category"
            value={categorySlug}
            onValueChange={handleCategoryChange}
            buttonClassName="h-10 gap-1 px-2 text-xs sm:h-12 sm:gap-3 sm:px-4 sm:text-sm"
            options={categoryOptions.map((category) => ({ value: category.slug, label: category.name }))}
          />
        </span>
      </label>

      <label className="block">
        <span className="text-xs font-bold text-slate-700 sm:text-sm">Подкатегория</span>
        <span className="mt-1 block sm:mt-2">
          <DropdownSelect
            key={categorySlug}
            name="subcategory"
            value={subcategorySlug}
            onValueChange={setSubcategorySlug}
            buttonClassName="h-10 gap-1 px-2 text-xs sm:h-12 sm:gap-3 sm:px-4 sm:text-sm"
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
  const [photos, setPhotos] = useState<PreviewPhoto[]>([]);
  const urlsRef = useRef<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const maxPhotos = 20;
  const availableSlots = maxPhotos - photos.length;

  useEffect(() => {
    return () => {
      urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      urlsRef.current = [];
    };
  }, []);

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
      .filter((file) => file.type.startsWith("image/"))
      .slice(0, availableSlots);

    if (!files.length) {
      syncFileInput(photos);
      return;
    }

    const nextPhotos = files.map((file) => {
      const url = URL.createObjectURL(file);
      urlsRef.current.push(url);

      return {
        id: `${file.name}-${file.size}-${url}`,
        file,
        name: file.name,
        url,
      };
    });

    setPhotos((current) => {
      const updated = [...current, ...nextPhotos];
      syncFileInput(updated);
      return updated;
    });
  }

  function removePhoto(photo: PreviewPhoto) {
    URL.revokeObjectURL(photo.url);
    urlsRef.current = urlsRef.current.filter((url) => url !== photo.url);
    setPhotos((current) => {
      const updated = current.filter((item) => item.id !== photo.id);
      syncFileInput(updated);
      return updated;
    });
  }

  function syncFileInput(nextPhotos: PreviewPhoto[]) {
    if (!inputRef.current) {
      return;
    }

    const dataTransfer = new DataTransfer();
    nextPhotos.forEach((photo) => dataTransfer.items.add(photo.file));
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
      <input ref={inputRef} className="sr-only" type="file" accept="image/*" name="photos" multiple onChange={handleFiles} />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Camera className="h-5 w-5 shrink-0 text-[#0875d1]" />
          <div>
            <h2 className="font-bold text-slate-800">Фото объявления</h2>
            <p className="mt-1 text-sm text-slate-500">До {maxPhotos} изображений. Сейчас выбрано: {photos.length}.</p>
          </div>
        </div>
        <span className="text-sm font-semibold text-[#0875d1]">{availableSlots > 0 ? "Нажмите в область, чтобы выбрать фото" : "Лимит фото заполнен"}</span>
      </div>

      {photos.length ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          {photos.map((photo, index) => (
            <figure key={photo.id} className="group relative overflow-hidden rounded-lg border border-slate-200 bg-white">
              <img src={photo.url} alt={`Фото ${index + 1}: ${photo.name}`} className="aspect-square w-full bg-slate-50 object-contain p-1" />
              <figcaption className="sr-only">{photo.name}</figcaption>
              <button
                type="button"
                data-photo-remove
                onClick={(event) => {
                  event.stopPropagation();
                  removePhoto(photo);
                }}
                className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/95 text-slate-700 shadow-sm transition hover:text-rose-600"
                aria-label={`Удалить ${photo.name}`}
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
            Нажмите, чтобы добавить фотографии
          </span>
        </div>
      )}
    </section>
  );
}
