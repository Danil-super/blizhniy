"use client";

/* eslint-disable @next/next/no-img-element */

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Camera, Save, Trash2 } from "lucide-react";
import { DemoPublication, demoPublicationsStorageKey } from "@/lib/demo-publications";
import { categories, region } from "@/lib/data";
import { ListingKind, ListingKindBadge, StatusBadge } from "@/components/listings/ListingCard";

const listingKinds: { value: ListingKind; label: string }[] = [
  { value: "prodam", label: "Продам" },
  { value: "kuplyu", label: "Куплю" },
  { value: "menyayu", label: "Меняю" },
  { value: "otdam-darom", label: "Отдам даром" },
];

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

function slugifySubcategory(name: string) {
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

function readImageFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Не удалось прочитать фото"));
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
  const [categorySlug, setCategorySlug] = useState("mebel-i-interer");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const listing = useMemo(() => items.find((item) => item.type === "listing" && item.id === slug), [items, slug]);
  const selectedCategory = categories.find((category) => category.slug === categorySlug) ?? categories[0];
  const subcategories = selectedCategory?.children ?? [];
  const kind = (listing?.listingKind ?? "prodam") as ListingKind;

  useEffect(() => {
    const storedItems = readStoredPublications();
    const storedListing = storedItems.find((item) => item.type === "listing" && item.id === slug);

    setItems(storedItems);
    setImages(storedListing?.images ?? []);
    setCategorySlug(storedListing?.categorySlug ?? "mebel-i-interer");
  }, [slug]);

  async function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
      .filter((file) => file.type.startsWith("image/"))
      .slice(0, Math.max(0, 12 - images.length));

    event.target.value = "";

    if (!files.length) {
      return;
    }

    const nextImages = await Promise.allSettled(files.map((file) => readCompressedImage(file)));
    setImages((current) => [...current, ...nextImages.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))].slice(0, 12));
  }

  function removeImage(index: number) {
    setImages((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!listing) {
      return;
    }

    setSaving(true);
    setMessage("");

    const formData = new FormData(event.currentTarget);
    const nextCategorySlug = String(formData.get("category") ?? listing.categorySlug ?? "mebel-i-interer");
    const nextSubcategorySlug = String(formData.get("subcategory") ?? listing.subcategorySlug ?? "");
    const location = String(formData.get("location") ?? listing.city).trim();
    const city = location.split(",")[0]?.trim() || "Краснодар";
    const updated: DemoPublication = {
      ...listing,
      title: String(formData.get("title") ?? listing.title).trim() || listing.title,
      subtitle: String(formData.get("subtitle") ?? listing.subtitle).trim() || listing.subtitle,
      city,
      price: String(formData.get("price") ?? listing.price ?? "").trim() || "по договоренности",
      description: String(formData.get("description") ?? listing.description ?? "").trim() || "Описание будет дополнено.",
      phone: String(formData.get("phone") ?? listing.phone ?? "").trim() || "+78610009999",
      messengerUrl: String(formData.get("messengerUrl") ?? listing.messengerUrl ?? "").trim(),
      listingKind: listingKinds.some((item) => item.value === formData.get("kind")) ? (formData.get("kind") as ListingKind) : kind,
      categorySlug: nextCategorySlug,
      subcategorySlug: nextSubcategorySlug,
      images,
    };
    const nextItems = items.map((item) => (item.id === slug ? updated : item));

    try {
      window.localStorage.setItem(demoPublicationsStorageKey, JSON.stringify(nextItems));
      window.dispatchEvent(new Event("blizhniy-demo-publications-updated"));
      window.location.href = `/blizhniy/obyavlenie/${slug}`;
    } catch {
      setMessage("Не удалось сохранить изменения: в браузере закончилось место для фото. Удалите часть изображений и попробуйте снова.");
      setSaving(false);
    }
  }

  if (!listing) {
    return (
      <main className="page-container py-10">
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-card">
          <h1 className="text-2xl font-black text-[#060b27]">Объявление не найдено</h1>
          <p className="mt-2 text-slate-600">Демо-объявления хранятся в браузере, где они были опубликованы.</p>
          <Link href="/cabinet/obyavleniya" className="mt-5 inline-flex h-11 items-center justify-center rounded-lg bg-[#0875d1] px-5 font-bold text-white">
            Вернуться в кабинет
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="page-container py-10">
      <Link href={`/blizhniy/obyavlenie/${slug}`} className="inline-flex items-center gap-2 text-sm font-bold text-[#0875d1]">
        <ArrowLeft className="h-4 w-4" />
        К объявлению
      </Link>
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

        <div className="grid gap-4 md:grid-cols-3">
          <label className="block">
            <span className="text-sm font-bold text-slate-700">Город и регион</span>
            <input name="location" defaultValue={`${listing.city}, ${region.name}`} className="mt-2 h-12 w-full rounded-lg border border-slate-300 px-4 outline-none focus:border-[#0875d1]" />
          </label>
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
                <h2 className="font-bold text-slate-800">Фото объявления</h2>
                <p className="mt-1 text-sm text-slate-500">До 12 изображений. Сейчас сохранено: {images.length}.</p>
              </div>
            </div>
            <label className="inline-flex h-10 cursor-pointer items-center justify-center rounded-lg border border-blue-200 bg-white px-4 text-sm font-bold text-[#0875d1] transition hover:bg-blue-50">
              Добавить фото
              <input type="file" accept="image/*" multiple className="sr-only" onChange={handleImageChange} />
            </label>
          </div>

          {images.length ? (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {images.map((image, index) => (
                <figure key={`${image.slice(0, 40)}-${index}`} className="group relative overflow-hidden rounded-lg border border-slate-200 bg-white">
                  <img src={image} alt={`Фото ${index + 1}`} className="aspect-square w-full bg-slate-50 object-contain p-1" />
                  <button
                    type="button"
                    onClick={() => removeImage(index)}
                    className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-slate-700 shadow-sm transition hover:text-rose-600"
                    aria-label={`Удалить фото ${index + 1}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </figure>
              ))}
            </div>
          ) : (
            <div className="mt-4 flex min-h-28 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-sm font-semibold text-slate-500">
              Фото пока не добавлены
            </div>
          )}
        </section>

        {message ? <p className="rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-700">{message}</p> : null}

        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={saving} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#0aa337] px-6 font-bold text-white transition hover:bg-[#078a2e] disabled:cursor-wait disabled:bg-slate-300">
            <Save className="h-5 w-5" />
            {saving ? "Сохраняем..." : "Сохранить изменения"}
          </button>
          <Link href={`/blizhniy/obyavlenie/${slug}`} className="inline-flex h-12 items-center justify-center rounded-xl border border-slate-300 px-6 font-bold text-slate-800">
            Отмена
          </Link>
        </div>
      </form>
    </main>
  );
}
