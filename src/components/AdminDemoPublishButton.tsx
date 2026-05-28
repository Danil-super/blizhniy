"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { demoPublicationLabels, demoPublicationsStorageKey, DemoPublication, DemoPublicationType } from "@/lib/demo-publications";

type AdminDemoPublishButtonProps = {
  publicationType: DemoPublicationType;
  returnHref: string;
  label: string;
};

function readValue(formData: FormData, name: string, fallback = "") {
  return String(formData.get(name) ?? "").trim() || fallback;
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

function buildPublication(formData: FormData, type: DemoPublicationType): DemoPublication {
  const now = new Date().toISOString();
  const id = `demo-${type}-${Date.now().toString(36)}`;

  if (type === "listing") {
    return {
      id,
      type,
      title: readValue(formData, "title", "Новое объявление"),
      subtitle: readValue(formData, "category", "Категория"),
      city: readValue(formData, "location", "Краснодар").split(",")[0]?.trim() || "Краснодар",
      price: readValue(formData, "price", "по договоренности"),
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

  function handleClick(event: React.MouseEvent<HTMLButtonElement>) {
    const form = event.currentTarget.form;

    if (!form) {
      return;
    }

    if (!form.reportValidity()) {
      return;
    }

    setSaving(true);
    const publication = buildPublication(new FormData(form), publicationType);
    const stored = readStoredPublications();
    window.localStorage.setItem(demoPublicationsStorageKey, JSON.stringify([publication, ...stored].slice(0, 50)));
    window.dispatchEvent(new Event("blizhniy-demo-publications-updated"));
    window.location.href = returnHref;
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={saving}
      className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#0aa337] px-6 font-bold text-white transition hover:bg-[#078a2e] disabled:cursor-wait disabled:bg-slate-300"
    >
      {saving ? "Сохраняем..." : label}
      <ArrowRight className="h-5 w-5" />
    </button>
  );
}
