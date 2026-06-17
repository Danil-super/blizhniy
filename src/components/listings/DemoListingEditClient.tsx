"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { Camera, Save, Trash2, Video } from "lucide-react";
import { BackLink } from "@/components/BackLink";
import { SquareImageCropper } from "@/components/SquareImageCropper";
import { StoredMediaImage, StoredMediaVideo } from "@/components/StoredMedia";
import { ValidatedInput } from "@/components/ValidatedInput";
import { resolveAuthenticatedClientUserIdentity } from "@/lib/client-user-profile";
import { storeMediaDataUrl, storeMediaFile } from "@/lib/client-media-store";
import { appendPublicationHistory, DemoPublication, demoPublicationsStorageKey } from "@/lib/demo-publications";
import { categories, cities } from "@/lib/data";
import { extractListingPriceDigits, maxListingPriceDigits, normalizeListingPrice } from "@/lib/listing-price";
import { filterListingMediaFiles, listingMediaLimitText } from "@/lib/media-limits";
import { getSupabaseBrowserClient, isSupabaseBrowserConfigured } from "@/lib/supabase-browser";
import type { Listing } from "@/lib/types";
import { ListingKind, ListingKindBadge, StatusBadge } from "@/components/listings/ListingCard";
import { ListingLocationFields } from "@/components/listings/ListingFormControls";

const listingKinds: { value: ListingKind; label: string }[] = [
  { value: "prodam", label: "Продам" },
  { value: "kuplyu", label: "Куплю" },
  { value: "arenda", label: "Аренда" },
  { value: "menyayu", label: "Меняю" },
  { value: "otdam-darom", label: "Отдам даром" },
];

const maxMediaFiles = 20;

function readStoredPublications() {
  try {
    const stored = window.localStorage.getItem(demoPublicationsStorageKey);
    const parsed = stored ? (JSON.parse(stored) as unknown) : null;

    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is DemoPublication => Boolean(item && typeof item === "object" && "id" in item));
    }
  } catch {
    return [];
  }

  return [];
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  if (!isSupabaseBrowserConfigured()) {
    return {};
  }

  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  return token ? { Authorization: `Bearer ${token}` } : {};
}

function listingStatusLabel(status: Listing["status"]) {
  if (status === "published" || status === "paid") {
    return "Опубликовано";
  }

  if (status === "pending_payment") {
    return "Ждет оплаты";
  }

  if (status === "draft") {
    return "Черновик";
  }

  if (status === "sold") {
    return "Продано";
  }

  if (status === "archived") {
    return "Снята с публикации";
  }

  if (status === "expired") {
    return "Истек срок";
  }

  if (status === "rejected") {
    return "Отклонено";
  }

  return status;
}

function serverListingToPublication(listing: Listing): DemoPublication {
  return {
    id: listing.id,
    type: "listing",
    title: listing.title,
    subtitle: listing.subcategory || listing.categorySlug,
    city: listing.city,
    price: listing.price,
    description: listing.description,
    images: listing.images,
    lat: listing.lat,
    lng: listing.lng,
    address: listing.address ?? listing.district,
    hasMapPoint: listing.hasMapPoint,
    showExactAddress: listing.showExactAddress,
    phone: listing.phone,
    email: listing.email,
    messengerUrl: listing.messengerUrl,
    listingKind: listing.kind,
    categorySlug: listing.categorySlug,
    status: listingStatusLabel(listing.status),
    subcategorySlug: listing.subcategory,
    expiresAt: listing.expiresAt,
    createdAt: listing.publishedAt,
  };
}

async function fetchServerListing(slug: string) {
  try {
    const response = await fetch("/api/cabinet/listings", {
      cache: "no-store",
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      return undefined;
    }

    const payload = (await response.json().catch(() => null)) as { listings?: Listing[] } | null;
    const listing = payload?.listings?.find((item) => item.id === slug);

    return listing ? serverListingToPublication(listing) : undefined;
  } catch {
    return undefined;
  }
}

function limitMediaFiles(images: string[] = [], videos: string[] = []) {
  const nextImages = images.slice(0, maxMediaFiles);
  const nextVideos = videos.slice(0, Math.max(0, maxMediaFiles - nextImages.length));

  return {
    images: nextImages,
    videos: nextVideos,
  };
}

function slugifySubcategory(name: string) {
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
    "Садовый инвентарь": "sadovyy-inventar",
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
    Игрушки: "igrushki",
    "Технические игрушки": "tehnicheskie-igrushki",
    "Дидактические игрушки": "didakticheskie-igrushki",
    "Спортивные (спортивно-моторные) игрушки": "sportivnye-sportivno-motornye-igrushki",
    Одежда: "odezhda",
    Обувь: "obuv",
    Аксессуары: "aksessuary",
    Клининг: "klining",
  };

  return map[name] ?? name.toLowerCase().replaceAll(" ", "-");
}

function readCoordinate(formData: FormData, name: string) {
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

async function readOriginalImage(file: File) {
  return storeMediaFile(file);
}

async function readOriginalMedia(file: File) {
  return storeMediaFile(file);
}

export function DemoListingEditClient({ slug }: { slug: string }) {
  const [items, setItems] = useState<DemoPublication[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [videos, setVideos] = useState<string[]>([]);
  const [categorySlug, setCategorySlug] = useState("mebel-i-interer");
  const [cropEditorIndex, setCropEditorIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [mediaMessage, setMediaMessage] = useState("");
  const mediaCount = images.length + videos.length;

  const listing = useMemo(() => items.find((item) => item.type === "listing" && item.id === slug), [items, slug]);
  const selectedCategory = categories.find((category) => category.slug === categorySlug) ?? categories[0];
  const subcategories = selectedCategory?.children ?? [];
  const kind = (listing?.listingKind ?? "prodam") as ListingKind;

  useEffect(() => {
    let active = true;

    async function loadListing() {
      const storedItems = readStoredPublications();
      const storedListing = storedItems.find((item) => item.type === "listing" && item.id === slug);
      const serverListing = await fetchServerListing(slug);
      const mergedListing =
        storedListing && serverListing
          ? {
              ...serverListing,
              ...storedListing,
              images: storedListing.images?.length ? storedListing.images : serverListing.images,
              videos: storedListing.videos?.length ? storedListing.videos : serverListing.videos,
            }
          : storedListing ?? serverListing;
      const nextItems = mergedListing
        ? [mergedListing, ...storedItems.filter((item) => item.id !== mergedListing.id)]
        : storedItems;
      const storedMedia = limitMediaFiles(mergedListing?.images, mergedListing?.videos);

      if (!active) {
        return;
      }

      setItems(nextItems);
      setImages(storedMedia.images);
      setVideos(storedMedia.videos);
      setCategorySlug(mergedListing?.categorySlug ?? "mebel-i-interer");
    }

    void loadListing();

    return () => {
      active = false;
    };
  }, [slug]);

  async function handleMediaChange(event: ChangeEvent<HTMLInputElement>) {
    const availableSlots = Math.max(0, maxMediaFiles - mediaCount);
    const selectedFiles = Array.from(event.target.files ?? []).slice(0, availableSlots);
    const { accepted, rejectedMessages } = filterListingMediaFiles(selectedFiles);
    const files = accepted.slice(0, availableSlots);

    event.target.value = "";
    setMediaMessage(rejectedMessages[0] ?? "");

    if (!files.length) {
      return;
    }

    const nextMedia = await Promise.allSettled(
      files.map(async (file) => ({
        kind: file.type.startsWith("video/") ? "video" : "image",
        value: file.type.startsWith("video/") ? await readOriginalMedia(file) : await readOriginalImage(file),
      })),
    );
    const fulfilled = nextMedia.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
    const nextImages = fulfilled.filter((item) => item.kind === "image").map((item) => item.value);

    setImages((current) => {
      const next = [...current, ...nextImages].slice(0, maxMediaFiles);
      setCropEditorIndex(nextImages.length ? current.length : null);
      return next;
    });
    setVideos((current) => [...current, ...fulfilled.filter((item) => item.kind === "video").map((item) => item.value)].slice(0, maxMediaFiles));
  }

  function removeImage(index: number) {
    setImages((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function makeImageCover(index: number) {
    setImages((current) => {
      const target = current[index];

      if (!target) {
        return current;
      }

      return [target, ...current.filter((_, itemIndex) => itemIndex !== index)];
    });
  }

  async function applySquareCrop(index: number, dataUrl: string) {
    const storedImage = await storeMediaDataUrl(dataUrl, `listing-crop-${index + 1}.png`);
    setImages((current) => current.map((image, imageIndex) => (imageIndex === index ? storedImage : image)));
    setCropEditorIndex(null);
  }

  function removeVideo(index: number) {
    setVideos((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function makeVideoFirst(index: number) {
    setVideos((current) => {
      const target = current[index];

      if (!target) {
        return current;
      }

      return [target, ...current.filter((_, itemIndex) => itemIndex !== index)];
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    if (!listing) {
      return;
    }

    if (!form.reportValidity()) {
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const identity = await resolveAuthenticatedClientUserIdentity();
      const formData = new FormData(form);
      const nextCategorySlug = String(formData.get("category") ?? listing.categorySlug ?? "mebel-i-interer");
      const nextSubcategorySlug = String(formData.get("subcategory") ?? listing.subcategorySlug ?? "");
      const hasMapPoint = String(formData.get("locationMode") ?? "") === "exact" && String(formData.get("mapPointSelected") ?? "") === "1";
      const city = inferCityFromFormData(formData, listing.city || "Краснодар");
      const phone = String(formData.get("phone") ?? "").trim();
      const email = String(formData.get("email") ?? "").trim();
      const messengerUrl = String(formData.get("messengerUrl") ?? "").trim();

      if (!phone && !email && !messengerUrl) {
        throw new Error("Укажите хотя бы один контакт объявления: телефон, email или Telegram/WhatsApp.");
      }

      const updated: DemoPublication = {
        ...listing,
        ownerKey: identity.ownerKey,
        ownerName: identity.name,
        title: String(formData.get("title") ?? listing.title).trim() || listing.title,
        city,
        address: hasMapPoint ? String(formData.get("address") ?? "").trim() || undefined : undefined,
        lat: hasMapPoint ? readCoordinate(formData, "lat") : undefined,
        lng: hasMapPoint ? readCoordinate(formData, "lng") : undefined,
        hasMapPoint,
        price: normalizeListingPrice(String(formData.get("price") ?? ""), "по договоренности"),
        description: String(formData.get("description") ?? listing.description ?? "").trim() || "Описание будет дополнено.",
        phone,
        email,
        messengerUrl,
        listingKind: listingKinds.some((item) => item.value === formData.get("kind")) ? (formData.get("kind") as ListingKind) : kind,
        categorySlug: nextCategorySlug,
        subcategorySlug: nextSubcategorySlug,
        images,
        videos,
      };
      const nextItems = items.map((item) =>
        item.id === slug
          ? appendPublicationHistory(updated, "updated", {
              status: updated.status,
              description: "Объявление отредактировано владельцем.",
            })
          : item,
      );
      window.localStorage.setItem(demoPublicationsStorageKey, JSON.stringify(nextItems));
      window.dispatchEvent(new Event("blizhniy-demo-publications-updated"));
      window.location.href = "/cabinet/obyavleniya";
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить изменения: в браузере закончилось место для фото. Удалите часть изображений и попробуйте снова.");
      setSaving(false);
    }
  }

  if (!listing) {
    return (
      <main className="page-container py-10">
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-card">
          <h1 className="text-2xl font-black text-[#060b27]">Объявление не найдено</h1>
          <p className="mt-2 text-slate-600">Демо-объявления хранятся в браузере, где они были опубликованы.</p>
          <BackLink fallbackHref="/cabinet/obyavleniya" className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#0875d1] px-5 font-bold text-white">
            Вернуться в кабинет
          </BackLink>
        </section>
      </main>
    );
  }

  return (
    <main className="page-container py-10">
      <BackLink fallbackHref="/cabinet/obyavleniya" className="inline-flex items-center gap-2 text-sm font-bold text-[#0875d1]">
        Назад
      </BackLink>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <ListingKindBadge kind={kind} />
        <StatusBadge status="published" />
      </div>
      <h1 className="mt-4 text-3xl font-black text-[#060b27] sm:text-5xl">Редактировать объявление</h1>

      <form onSubmit={handleSubmit} className="mt-6 grid gap-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_minmax(0,1fr)]">
          <label className="block">
            <span className="text-sm font-bold text-slate-700">Тип объявления</span>
            <select name="kind" defaultValue={kind} className="mt-2 h-12 w-full rounded-lg border border-slate-300 px-4 outline-none focus:border-[#0875d1]">
              {listingKinds.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-bold text-slate-700">Категория</span>
            <select
              name="category"
              value={categorySlug}
              onChange={(event) => setCategorySlug(event.target.value)}
              className="mt-2 h-12 w-full rounded-lg border border-slate-300 px-4 outline-none focus:border-[#0875d1]"
            >
              {categories.map((category) => (
                <option key={category.slug} value={category.slug}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-bold text-slate-700">Подкатегория</span>
            <select key={categorySlug} name="subcategory" defaultValue={listing.subcategorySlug} className="mt-2 h-12 w-full rounded-lg border border-slate-300 px-4 outline-none focus:border-[#0875d1]">
              {subcategories.length ? (
                subcategories.map((subcategory) => (
                  <option key={subcategory} value={slugifySubcategory(subcategory)}>
                    {subcategory}
                  </option>
                ))
              ) : (
                <option value="">Без подкатегории</option>
              )}
            </select>
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
          <label className="block">
            <span className="text-sm font-bold text-slate-700">Название</span>
            <input
              name="title"
              defaultValue={listing.title}
              minLength={3}
              maxLength={120}
              required
              className="mt-2 h-12 w-full rounded-lg border border-slate-300 px-4 outline-none focus:border-[#0875d1]"
            />
          </label>
          <label className="block">
            <span className="text-sm font-bold text-slate-700">Цена</span>
            <input name="price" defaultValue={extractListingPriceDigits(listing.price)} inputMode="numeric" maxLength={maxListingPriceDigits} pattern="[0-9]*" placeholder="12000" className="mt-2 h-12 w-full rounded-lg border border-slate-300 px-4 outline-none focus:border-[#0875d1]" />
          </label>
        </div>

        <label className="block">
          <span className="text-sm font-bold text-slate-700">Описание</span>
          <textarea
            name="description"
            defaultValue={listing.description}
            maxLength={3000}
            className="mt-2 min-h-32 w-full rounded-lg border border-slate-300 px-4 py-3 outline-none focus:border-[#0875d1]"
          />
        </label>

        <ListingLocationFields
          defaultAddress={listing.address}
          defaultCity={listing.city}
          defaultLat={listing.hasMapPoint ? listing.lat : undefined}
          defaultLng={listing.hasMapPoint ? listing.lng : undefined}
        />

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="text-sm font-bold text-slate-700">Телефон</span>
            <ValidatedInput name="phone" defaultValue={listing.phone} validation="phone" className="mt-2 h-12 w-full rounded-lg border border-slate-300 px-4 outline-none focus:border-[#0875d1]" />
          </label>
          <label className="block">
            <span className="text-sm font-bold text-slate-700">Email</span>
            <ValidatedInput name="email" type="email" defaultValue={listing.email} validation="email" className="mt-2 h-12 w-full rounded-lg border border-slate-300 px-4 outline-none focus:border-[#0875d1]" />
          </label>
          <label className="block">
            <span className="text-sm font-bold text-slate-700">Telegram или WhatsApp</span>
            <ValidatedInput name="messengerUrl" defaultValue={listing.messengerUrl} validation="messenger" className="mt-2 h-12 w-full rounded-lg border border-slate-300 px-4 outline-none focus:border-[#0875d1]" />
          </label>
        </div>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Camera className="h-5 w-5 text-[#0875d1]" />
              <div>
                <h2 className="font-bold text-slate-800">Фото и видео объявления</h2>
                <p className="mt-1 text-sm text-slate-500">До {maxMediaFiles} файлов. Сейчас сохранено: {mediaCount}. {listingMediaLimitText()}</p>
              </div>
            </div>
            <label className="inline-flex h-10 cursor-pointer items-center justify-center rounded-lg border border-blue-200 bg-white px-4 text-sm font-bold text-[#0875d1] transition hover:bg-blue-50">
              Добавить файлы
              <input type="file" accept="image/*,video/*" multiple className="sr-only" onChange={handleMediaChange} />
            </label>
          </div>
          {mediaMessage ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{mediaMessage}</p> : null}

          {mediaCount ? (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {images.map((image, index) => (
                <figure key={`${image.slice(0, 40)}-${index}`} className="group relative overflow-hidden rounded-lg border border-slate-200 bg-white">
                  <StoredMediaImage src={image} alt={`Фото ${index + 1}`} className="aspect-square w-full bg-slate-50 object-cover" />
                  <button
                    type="button"
                    onClick={() => removeImage(index)}
                    className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-slate-700 shadow-sm transition hover:text-rose-600"
                    aria-label={`Удалить фото ${index + 1}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <div className="absolute inset-x-2 bottom-2 flex gap-2">
                    {index === 0 ? (
                      <span className="rounded-lg bg-[#0875d1] px-2.5 py-1.5 text-xs font-black text-white shadow-sm">Обложка</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => makeImageCover(index)}
                        className="rounded-lg bg-white/95 px-2.5 py-1.5 text-xs font-black text-[#0875d1] shadow-sm transition hover:text-[#0664b3]"
                      >
                        Обложка
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setCropEditorIndex(index)}
                      className="rounded-lg bg-white/95 px-2.5 py-1.5 text-xs font-black text-[#0875d1] shadow-sm transition hover:text-[#0664b3]"
                    >
                      Кадр
                    </button>
                  </div>
                </figure>
              ))}
              {videos.map((video, index) => (
                <figure key={`${video.slice(0, 40)}-${index}`} className="group relative overflow-hidden rounded-lg border border-slate-200 bg-white">
                  <StoredMediaVideo src={video} className="aspect-square w-full bg-slate-950 object-cover" muted playsInline preload="metadata" />
                  <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-slate-950/70 px-2 py-1 text-[11px] font-bold text-white">
                    <Video className="h-3 w-3" />
                    Видео
                  </span>
                  {!images.length ? (
                    index === 0 ? (
                      <span className="absolute left-2 top-2 rounded-lg bg-[#0875d1] px-2.5 py-1.5 text-xs font-black text-white shadow-sm">Обложка</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => makeVideoFirst(index)}
                        className="absolute left-2 top-2 rounded-lg bg-white/95 px-2.5 py-1.5 text-xs font-black text-[#0875d1] shadow-sm transition hover:text-[#0664b3]"
                      >
                        Обложка
                      </button>
                    )
                  ) : null}
                  <button
                    type="button"
                    onClick={() => removeVideo(index)}
                    className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-slate-700 shadow-sm transition hover:text-rose-600"
                    aria-label={`Удалить видео ${index + 1}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </figure>
              ))}
            </div>
          ) : (
            <div className="mt-4 flex min-h-28 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-sm font-semibold text-slate-500">
              Медиафайлы пока не добавлены
            </div>
          )}
        </section>

        {message ? <p className="rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-700">{message}</p> : null}

        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={saving} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#0aa337] px-6 font-bold text-white transition hover:bg-[#078a2e] disabled:cursor-wait disabled:bg-slate-300">
            <Save className="h-5 w-5" />
            {saving ? "Сохраняем..." : "Сохранить изменения"}
          </button>
          <BackLink fallbackHref="/cabinet/obyavleniya" className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 px-6 font-bold text-slate-800">
            Отмена
          </BackLink>
        </div>
      </form>
      {cropEditorIndex !== null && images[cropEditorIndex] ? (
        <SquareImageCropper
          alt={`Фото ${cropEditorIndex + 1}`}
          onApply={(dataUrl) => applySquareCrop(cropEditorIndex, dataUrl)}
          onCancel={() => setCropEditorIndex(null)}
          src={images[cropEditorIndex]}
          title="Кадр для карточки"
        />
      ) : null}
    </main>
  );
}
