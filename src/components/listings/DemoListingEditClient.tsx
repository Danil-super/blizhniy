"use client";

/* eslint-disable @next/next/no-img-element */

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { Camera, Save, Trash2, Video } from "lucide-react";
import { BackLink } from "@/components/BackLink";
import { SquareImageCropper } from "@/components/SquareImageCropper";
import { resolveAuthenticatedClientUserIdentity } from "@/lib/client-user-profile";
import { appendPublicationHistory, DemoPublication, demoPublicationsStorageKey } from "@/lib/demo-publications";
import { categories } from "@/lib/data";
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

function readImageFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Не удалось прочитать фото"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function readMediaFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Не удалось подготовить фото"));
    image.src = src;
  });
}

async function readCompressedImage(file: File) {
  const dataUrl = await readImageFile(file);

  if (file.type === "image/svg+xml") {
    return dataUrl;
  }

  const image = await loadImage(dataUrl);
  const maxSide = 1440;
  const ratio = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
  const width = Math.max(1, Math.round((image.naturalWidth || image.width) * ratio));
  const height = Math.max(1, Math.round((image.naturalHeight || image.height) * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");

  if (!context) {
    return dataUrl;
  }

  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

export function DemoListingEditClient({ slug }: { slug: string }) {
  const [items, setItems] = useState<DemoPublication[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [videos, setVideos] = useState<string[]>([]);
  const [categorySlug, setCategorySlug] = useState("mebel-i-interer");
  const [cropEditorIndex, setCropEditorIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const mediaCount = images.length + videos.length;

  const listing = useMemo(() => items.find((item) => item.type === "listing" && item.id === slug), [items, slug]);
  const selectedCategory = categories.find((category) => category.slug === categorySlug) ?? categories[0];
  const subcategories = selectedCategory?.children ?? [];
  const kind = (listing?.listingKind ?? "prodam") as ListingKind;

  useEffect(() => {
    const storedItems = readStoredPublications();
    const storedListing = storedItems.find((item) => item.type === "listing" && item.id === slug);
    const storedMedia = limitMediaFiles(storedListing?.images, storedListing?.videos);

    setItems(storedItems);
    setImages(storedMedia.images);
    setVideos(storedMedia.videos);
    setCategorySlug(storedListing?.categorySlug ?? "mebel-i-interer");
  }, [slug]);

  async function handleMediaChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
      .filter((file) => file.type.startsWith("image/") || file.type.startsWith("video/"))
      .slice(0, Math.max(0, maxMediaFiles - mediaCount));

    event.target.value = "";

    if (!files.length) {
      return;
    }

    const nextMedia = await Promise.allSettled(
      files.map(async (file) => ({
        kind: file.type.startsWith("video/") ? "video" : "image",
        value: file.type.startsWith("video/") ? await readMediaFile(file) : await readCompressedImage(file),
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

  function applySquareCrop(index: number, dataUrl: string) {
    setImages((current) => current.map((image, imageIndex) => (imageIndex === index ? dataUrl : image)));
    setCropEditorIndex(null);
  }

  function removeVideo(index: number) {
    setVideos((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    if (!listing) {
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const identity = await resolveAuthenticatedClientUserIdentity();
      const formData = new FormData(form);
      const nextCategorySlug = String(formData.get("category") ?? listing.categorySlug ?? "mebel-i-interer");
      const nextSubcategorySlug = String(formData.get("subcategory") ?? listing.subcategorySlug ?? "");
      const location = String(formData.get("location") ?? listing.city).trim();
      const city = location.split(",")[0]?.trim() || "Краснодар";
      const hasMapPoint = String(formData.get("locationMode") ?? "") === "exact" && String(formData.get("mapPointSelected") ?? "") === "1";
      const updated: DemoPublication = {
        ...listing,
        ownerKey: identity.ownerKey,
        ownerName: identity.name,
        title: String(formData.get("title") ?? listing.title).trim() || listing.title,
        subtitle: String(formData.get("subtitle") ?? listing.subtitle).trim() || listing.subtitle,
        city,
        address: hasMapPoint ? String(formData.get("address") ?? "").trim() || undefined : undefined,
        lat: hasMapPoint ? readCoordinate(formData, "lat") : undefined,
        lng: hasMapPoint ? readCoordinate(formData, "lng") : undefined,
        hasMapPoint,
        price: String(formData.get("price") ?? listing.price ?? "").trim() || "по договоренности",
        description: String(formData.get("description") ?? listing.description ?? "").trim() || "Описание будет дополнено.",
        phone: String(formData.get("phone") ?? listing.phone ?? "").trim() || "+78610009999",
        messengerUrl: String(formData.get("messengerUrl") ?? listing.messengerUrl ?? "").trim(),
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
      window.location.href = `/blizhniy/obyavlenie/${slug}`;
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
            <input name="title" defaultValue={listing.title} className="mt-2 h-12 w-full rounded-lg border border-slate-300 px-4 outline-none focus:border-[#0875d1]" />
          </label>
          <label className="block">
            <span className="text-sm font-bold text-slate-700">Цена</span>
            <input name="price" defaultValue={listing.price} className="mt-2 h-12 w-full rounded-lg border border-slate-300 px-4 outline-none focus:border-[#0875d1]" />
          </label>
        </div>

        <label className="block">
          <span className="text-sm font-bold text-slate-700">Короткое описание для кабинета</span>
          <input name="subtitle" defaultValue={listing.subtitle} className="mt-2 h-12 w-full rounded-lg border border-slate-300 px-4 outline-none focus:border-[#0875d1]" />
        </label>

        <label className="block">
          <span className="text-sm font-bold text-slate-700">Описание</span>
          <textarea
            name="description"
            defaultValue={listing.description}
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
            <input name="phone" defaultValue={listing.phone} className="mt-2 h-12 w-full rounded-lg border border-slate-300 px-4 outline-none focus:border-[#0875d1]" />
          </label>
          <label className="block">
            <span className="text-sm font-bold text-slate-700">Telegram или WhatsApp</span>
            <input name="messengerUrl" defaultValue={listing.messengerUrl} className="mt-2 h-12 w-full rounded-lg border border-slate-300 px-4 outline-none focus:border-[#0875d1]" />
          </label>
        </div>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Camera className="h-5 w-5 text-[#0875d1]" />
              <div>
                <h2 className="font-bold text-slate-800">Фото и видео объявления</h2>
                <p className="mt-1 text-sm text-slate-500">До {maxMediaFiles} файлов. Сейчас сохранено: {mediaCount}.</p>
              </div>
            </div>
            <label className="inline-flex h-10 cursor-pointer items-center justify-center rounded-lg border border-blue-200 bg-white px-4 text-sm font-bold text-[#0875d1] transition hover:bg-blue-50">
              Добавить файлы
              <input type="file" accept="image/*,video/*" multiple className="sr-only" onChange={handleMediaChange} />
            </label>
          </div>

          {mediaCount ? (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {images.map((image, index) => (
                <figure key={`${image.slice(0, 40)}-${index}`} className="group relative overflow-hidden rounded-lg border border-slate-200 bg-white">
                  <img src={image} alt={`Фото ${index + 1}`} className="aspect-square w-full bg-slate-50 object-cover" />
                  <button
                    type="button"
                    onClick={() => removeImage(index)}
                    className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-slate-700 shadow-sm transition hover:text-rose-600"
                    aria-label={`Удалить фото ${index + 1}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setCropEditorIndex(index)}
                    className="absolute bottom-2 left-2 rounded-lg bg-white/95 px-2.5 py-1.5 text-xs font-black text-[#0875d1] shadow-sm transition hover:text-[#0664b3]"
                  >
                    Кадр
                  </button>
                </figure>
              ))}
              {videos.map((video, index) => (
                <figure key={`${video.slice(0, 40)}-${index}`} className="group relative overflow-hidden rounded-lg border border-slate-200 bg-white">
                  <video src={video} className="aspect-square w-full bg-slate-950 object-cover" muted playsInline preload="metadata" />
                  <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-slate-950/70 px-2 py-1 text-[11px] font-bold text-white">
                    <Video className="h-3 w-3" />
                    Видео
                  </span>
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
