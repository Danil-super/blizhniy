"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { demoPublicationLabels, demoPublicationsStorageKey, DemoPublication, DemoPublicationType } from "@/lib/demo-publications";
import { categories } from "@/lib/data";

type AdminDemoPublishButtonProps = {
  publicationType: DemoPublicationType;
  returnHref: string;
  label: string;
};

function readValue(formData: FormData, name: string, fallback = "") {
  return String(formData.get(name) ?? "").trim() || fallback;
}

function readCoordinate(formData: FormData, name: string) {
  const value = Number(readValue(formData, name).replace(",", "."));
  return Number.isFinite(value) ? value : undefined;
}

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

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Не удалось подготовить фото"));
    image.src = src;
  });
}

function readImageFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error("Не удалось прочитать фото"));
    reader.onload = () => {
      resolve(String(reader.result));
    };
    reader.readAsDataURL(file);
  });
}

async function readCompressedImage(file: File) {
  const dataUrl = await readImageFile(file);

  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
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

async function readSelectedImages(formData: FormData) {
  const files = formData
    .getAll("photos")
    .filter((file): file is File => file instanceof File && file.size > 0 && file.type.startsWith("image/"))
    .slice(0, 12);

  const images = await Promise.allSettled(files.map((file) => readCompressedImage(file)));
  return images.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
}

async function buildPublication(formData: FormData, type: DemoPublicationType): Promise<DemoPublication> {
  const now = new Date().toISOString();
  const id = `demo-${type}-${Date.now().toString(36)}`;
  const listingKind = readValue(formData, "kind", "prodam") as DemoPublication["listingKind"];

  if (type === "listing") {
    const categorySlug = readValue(formData, "category", "mebel-i-interer");
    const categoryName = categories.find((category) => category.slug === categorySlug)?.name ?? "Категория";

    return {
      id,
      type,
      title: readValue(formData, "title", "Новое объявление"),
      subtitle: categoryName,
      city: readValue(formData, "location", "Краснодар").split(",")[0]?.trim() || "Краснодар",
      price: readValue(formData, "price", "по договоренности"),
      description: readValue(formData, "description", "Описание будет дополнено."),
      images: await readSelectedImages(formData),
      lat: readCoordinate(formData, "lat"),
      lng: readCoordinate(formData, "lng"),
      showExactAddress: false,
      phone: readValue(formData, "phone", "+78610009999"),
      messengerUrl: readValue(formData, "messengerUrl"),
      listingKind: ["prodam", "kuplyu", "menyayu", "otdam-darom"].includes(listingKind ?? "") ? listingKind : "prodam",
      categorySlug,
      subcategorySlug: readValue(formData, "subcategory", "mebel"),
      status: "Опубликовано",
      createdAt: now,
    };
  }

  if (type === "vacancy") {
    return {
      id,
      type,
      title: readValue(formData, "title", "Новая вакансия"),
      subtitle: readValue(formData, "organization", "Организация"),
      city: readValue(formData, "city", "Краснодар"),
      price: readValue(formData, "salary", "по договоренности"),
      lat: readCoordinate(formData, "lat"),
      lng: readCoordinate(formData, "lng"),
      showExactAddress: Boolean(readValue(formData, "address")),
      status: "Опубликовано",
      createdAt: now,
    };
  }

  if (type === "workRequest") {
    return {
      id,
      type,
      title: readValue(formData, "title", "Новый заказ исполнителю"),
      subtitle: readValue(formData, "profession", "Специалист"),
      city: readValue(formData, "city", "Краснодар"),
      price: readValue(formData, "budget", "по договоренности"),
      lat: readCoordinate(formData, "lat"),
      lng: readCoordinate(formData, "lng"),
      showExactAddress: false,
      status: "Опубликовано",
      createdAt: now,
    };
  }

  if (type === "specialist") {
    return {
      id,
      type,
      title: readValue(formData, "name", "Новый специалист"),
      subtitle: readValue(formData, "profession", "Специалист"),
      city: readValue(formData, "city", "Краснодар"),
      price: readValue(formData, "price", "по договоренности"),
      images: await readSelectedImages(formData),
      lat: readCoordinate(formData, "lat"),
      lng: readCoordinate(formData, "lng"),
      showExactAddress: false,
      status: "Опубликовано",
      createdAt: now,
    };
  }

  return {
    id,
    type,
    title: readValue(formData, "participantName", "Новая заявка"),
    subtitle: readValue(formData, "category", demoPublicationLabels.fairApplication),
    city: readValue(formData, "city", "Краснодар"),
    status: "Опубликовано",
    createdAt: now,
  };
}

export function AdminDemoPublishButton({ publicationType, returnHref, label }: AdminDemoPublishButtonProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleClick(event: React.MouseEvent<HTMLButtonElement>) {
    const form = event.currentTarget.form;

    if (!form) {
      return;
    }

    if (!form.reportValidity()) {
      return;
    }

    setSaving(true);
    setError("");
    try {
      const publication = await buildPublication(new FormData(form), publicationType);
      const stored = readStoredPublications();
      const nextPublications = [publication, ...stored].slice(0, 50);

      try {
        window.localStorage.setItem(demoPublicationsStorageKey, JSON.stringify(nextPublications));
      } catch {
        window.localStorage.setItem(demoPublicationsStorageKey, JSON.stringify([{ ...publication, images: [] }, ...stored].slice(0, 50)));
      }

      window.dispatchEvent(new Event("blizhniy-demo-publications-updated"));
      window.location.href = returnHref;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось сохранить публикацию в демо-режиме.");
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={saving}
        className="inline-flex h-12 w-fit items-center justify-center gap-2 rounded-xl bg-[#0aa337] px-6 font-bold text-white transition hover:bg-[#078a2e] disabled:cursor-wait disabled:bg-slate-300"
      >
        {saving ? "Сохраняем..." : label}
        <ArrowRight className="h-5 w-5" />
      </button>
      {error ? <p className="text-sm font-semibold text-rose-600">{error}</p> : null}
    </div>
  );
}
