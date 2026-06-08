"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { DropdownSelect } from "@/components/DropdownSelect";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { fairCategories } from "@/lib/data";
import { ValidatedInput } from "@/components/ValidatedInput";
import { demoPublicationsStorageKey, demoPublicationsUpdatedEvent, type DemoPublication } from "@/lib/demo-publications";
import { resolveAuthenticatedClientUserIdentity } from "@/lib/client-user-profile";

type SubmitState = "idle" | "loading" | "error";

function readStoredPublications() {
  try {
    const storedRaw = window.localStorage.getItem(demoPublicationsStorageKey);
    const stored = storedRaw ? (JSON.parse(storedRaw) as unknown) : [];

    return Array.isArray(stored) ? stored.filter((item): item is DemoPublication => Boolean(item && typeof item === "object" && "id" in item)) : [];
  } catch {
    return [];
  }
}

function writeFairApplicationPublication(publication: DemoPublication) {
  const stored = readStoredPublications().filter((item) => item.id !== publication.id);

  window.localStorage.setItem(demoPublicationsStorageKey, JSON.stringify([publication, ...stored].slice(0, 50)));
  window.dispatchEvent(new Event(demoPublicationsUpdatedEvent));
}

export function FairApplicationForm({ adminMode = false }: { adminMode?: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<SubmitState>("idle");
  const [message, setMessage] = useState("");
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [captchaToken, setCaptchaToken] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;

    if (!form.reportValidity()) {
      return;
    }

    const data = new FormData(form);
    setState("loading");
    setMessage("");

    try {
      const identity = await resolveAuthenticatedClientUserIdentity();
      const response = await fetch("/api/fair-applications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${identity.accessToken}`,
        },
        body: JSON.stringify({
          participantName: data.get("participantName"),
          city: data.get("city"),
          category: data.get("category"),
          description: data.get("description"),
          productPhotos: String(data.get("productPhotos") ?? "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
          videoUrl: data.get("videoUrl"),
          phone: data.get("phone"),
          email: data.get("email"),
          comment: data.get("comment"),
          captchaToken,
          skipPayment: adminMode,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Не удалось создать заявку");
      }

      const applicationId = typeof payload.application?.id === "string" ? payload.application.id : `demo-fairApplication-${Date.now().toString(36)}`;
      const publication: DemoPublication = {
        id: applicationId,
        type: "fairApplication",
        ownerKey: identity.ownerKey,
        ownerName: identity.name,
        title: String(data.get("participantName") ?? "").trim() || "Новая заявка",
        subtitle: String(data.get("category") ?? "").trim() || "Заявка на ярмарку",
        city: String(data.get("city") ?? "").trim() || "Краснодар",
        description: String(data.get("description") ?? "").trim(),
        phone: String(data.get("phone") ?? "").trim(),
        email: String(data.get("email") ?? "").trim(),
        status: adminMode ? "Опубликовано" : "Ждет оплаты",
        createdAt: new Date().toISOString(),
      };

      writeFairApplicationPublication(publication);

      if (adminMode) {
        router.push("/cabinet/fair-applications");
        return;
      }

      if (typeof payload.payment?.id !== "string") {
        throw new Error("Не удалось создать платеж по заявке.");
      }

      router.push(`/blizhniy/oplata/${payload.payment.id}`);
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Не удалось отправить заявку");
      setCaptchaToken("");
      setCaptchaResetKey((value) => value + 1);
    }
  }

  return (
    <form className="mt-6 grid gap-4" onSubmit={handleSubmit}>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-2 text-sm font-bold text-slate-600">
          Название мастерской или ФИО
          <input name="participantName" className="h-11 rounded-lg border border-slate-300 px-3 font-normal outline-none focus:border-[#0875d1] sm:h-12 sm:px-4" placeholder="Мастерская Кубань Дуб" required />
        </label>
        <label className="grid gap-2 text-sm font-bold text-slate-600">
          Город
          <input name="city" className="h-11 rounded-lg border border-slate-300 px-3 font-normal outline-none focus:border-[#0875d1] sm:h-12 sm:px-4" placeholder="Краснодар" required />
        </label>
      </div>
      <label className="grid gap-2 text-sm font-bold text-slate-600">
        Категория ярмарки
        <DropdownSelect name="category" options={fairCategories.map((category) => ({ value: category, label: category }))} buttonClassName="h-11 font-normal sm:h-12" />
      </label>
      <label className="grid gap-2 text-sm font-bold text-slate-600">
        Описание работ или товаров
        <textarea name="description" className="min-h-24 rounded-lg border border-slate-300 px-3 py-3 font-normal outline-none focus:border-[#0875d1] sm:min-h-28 sm:px-4" placeholder="Что вы покажете на ярмарке" required />
      </label>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-2 text-sm font-bold text-slate-600">
          Фото товаров
          <input name="productPhotos" className="h-11 rounded-lg border border-slate-300 px-3 font-normal outline-none focus:border-[#0875d1] sm:h-12 sm:px-4" placeholder="Стол, кашпо, макраме" />
        </label>
        <label className="grid gap-2 text-sm font-bold text-slate-600">
          Ссылка на видео
          <ValidatedInput name="videoUrl" className="h-11 rounded-lg border border-slate-300 px-3 font-normal outline-none focus:border-[#0875d1] sm:h-12 sm:px-4" placeholder="https://..." validation="url" />
        </label>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-2 text-sm font-bold text-slate-600">
          Телефон
          <ValidatedInput name="phone" className="h-11 rounded-lg border border-slate-300 px-3 font-normal outline-none focus:border-[#0875d1] sm:h-12 sm:px-4" placeholder="+7..." validation="phone" required />
        </label>
        <label className="grid gap-2 text-sm font-bold text-slate-600">
          Email
          <ValidatedInput name="email" className="h-11 rounded-lg border border-slate-300 px-3 font-normal outline-none focus:border-[#0875d1] sm:h-12 sm:px-4" placeholder="you@example.ru" validation="email" required />
        </label>
      </div>
      <label className="grid gap-2 text-sm font-bold text-slate-600">
        Комментарий
        <textarea name="comment" className="min-h-20 rounded-lg border border-slate-300 px-3 py-3 font-normal outline-none focus:border-[#0875d1] sm:min-h-24 sm:px-4" placeholder="Пожелания к месту, столу, электричеству" />
      </label>
      <label className="flex gap-3 text-sm leading-6 text-slate-700">
        <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-[#0875d1]" required />
        <span>{adminMode ? "Согласен с правилами ярмарки. Заявка будет создана в тестовом режиме без оплаты." : "Согласен с правилами ярмарки и понимаю, что участие оплачивается после подачи заявки."}</span>
      </label>
      <TurnstileWidget
        resetKey={captchaResetKey}
        onVerify={setCaptchaToken}
      />
      <button type="submit" disabled={state === "loading" || !captchaToken} className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-[#0aa337] px-5 text-sm font-bold text-white transition hover:bg-[#078a2e] disabled:cursor-not-allowed disabled:bg-slate-300 sm:h-12 sm:w-fit sm:px-7 sm:text-base">
        {state === "loading" ? "Создаем заявку..." : adminMode ? "Создать заявку без оплаты" : "Создать заявку и перейти к оплате"}
      </button>
      {state === "error" ? <p className="text-sm font-semibold text-rose-600">{message}</p> : null}
    </form>
  );
}
