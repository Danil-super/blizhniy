"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import { Camera, Images, Plus, X } from "lucide-react";
import { SquareImageCropper } from "@/components/SquareImageCropper";
import { StoredMediaImage } from "@/components/StoredMedia";
import { filterFormPhotoFiles, formPhotoLimitText } from "@/lib/media-limits";

type PreviewPhoto = {
  id: string;
  file?: File;
  name: string;
  persisted?: boolean;
  sourceUrl: string;
  url: string;
};

function syncFileInput(input: HTMLInputElement | null, photos: PreviewPhoto[]) {
  if (!input) {
    return;
  }

  const transfer = new DataTransfer();
  photos.forEach((photo) => {
    if (photo.file) {
      transfer.items.add(photo.file);
    }
  });
  input.files = transfer.files;
}

async function dataUrlToImageFile(dataUrl: string, name: string) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const base = name.replace(/\.[^.]+$/, "") || "photo";
  return new File([blob], `${base}-crop.png`, { type: blob.type || "image/png" });
}

export function FormPhotoUploader({
  autoOpenCropper = true,
  defaultPhotos = [],
  description,
  label,
  maxPhotos = 12,
  name = "photos",
  required = false,
}: {
  autoOpenCropper?: boolean;
  defaultPhotos?: string[];
  description: string;
  label: string;
  maxPhotos?: number;
  name?: string;
  required?: boolean;
}) {
  const normalizedMaxPhotos = Math.max(1, maxPhotos);
  const [photos, setPhotos] = useState<PreviewPhoto[]>(
    defaultPhotos.slice(0, normalizedMaxPhotos).map((url, index) => ({
      id: `persisted-${index}-${url.slice(0, 24)}`,
      name: `Фото ${index + 1}`,
      persisted: true,
      sourceUrl: url,
      url,
    }))
  );
  const [cropEditorId, setCropEditorId] = useState("");
  const [message, setMessage] = useState("");
  const urlsRef = useRef<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const cropEditorPhoto = photos.find((photo) => photo.id === cropEditorId);

  useEffect(() => {
    return () => {
      urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      urlsRef.current = [];
    };
  }, []);

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const availableSlots = normalizedMaxPhotos - photos.length;
    const selectedFiles = Array.from(event.target.files ?? []).slice(0, availableSlots);
    const { accepted, rejectedMessages } = filterFormPhotoFiles(selectedFiles);
    const files = accepted.slice(0, availableSlots);

    setMessage(rejectedMessages[0] ?? (availableSlots <= 0 ? `Можно добавить не больше ${normalizedMaxPhotos} фото.` : ""));

    if (!files.length) {
      syncFileInput(inputRef.current, photos);
      event.currentTarget.value = "";
      return;
    }

    const nextPhotos = files.map((file) => {
      const url = URL.createObjectURL(file);
      urlsRef.current.push(url);

      return {
        id: `${file.name}-${file.size}-${url}`,
        file,
        name: file.name,
        sourceUrl: url,
        url,
      };
    });

    setPhotos((current) => {
      const next = [...current, ...nextPhotos].slice(0, normalizedMaxPhotos);
      window.requestAnimationFrame(() => syncFileInput(inputRef.current, next));
      return next;
    });
    if (autoOpenCropper) {
      setCropEditorId(nextPhotos[0]?.id ?? "");
    }
    event.currentTarget.value = "";
  }

  function removePhoto(id: string) {
    setPhotos((current) => {
      const removed = current.find((photo) => photo.id === id);
      const next = current.filter((photo) => photo.id !== id);

      if (removed) {
        URL.revokeObjectURL(removed.url);
        urlsRef.current = urlsRef.current.filter((url) => url !== removed.url);
      }

      window.requestAnimationFrame(() => syncFileInput(inputRef.current, next));
      return next;
    });
  }

  async function applySquareCrop(photo: PreviewPhoto, dataUrl: string) {
    const file = await dataUrlToImageFile(dataUrl, photo.name);

    setPhotos((current) => {
      const next = current.map((item) =>
        item.id === photo.id
          ? {
              ...item,
              file,
              persisted: false,
              url: dataUrl,
            }
          : item
      );

      window.requestAnimationFrame(() => syncFileInput(inputRef.current, next));
      return next;
    });
    setCropEditorId("");
  }

  return (
    <section className="min-w-0 max-w-full overflow-hidden rounded-xl border border-blue-100 bg-white p-3 shadow-sm sm:p-4">
      <div className="grid min-w-0 gap-3">
        <label className="group flex min-w-0 cursor-pointer flex-col justify-between rounded-xl border border-dashed border-blue-200 bg-blue-50/60 p-3 transition hover:border-[#0875d1] hover:bg-blue-50 sm:min-h-32 sm:p-4">
          <input ref={inputRef} className="sr-only" name={name} type="file" accept="image/*" multiple={normalizedMaxPhotos > 1} required={required && !photos.length} onChange={handleFiles} />
          <span className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-[#0875d1] ring-1 ring-blue-100 transition group-hover:ring-[#0875d1]">
              <Camera className="h-5 w-5" />
            </span>
            <span className="min-w-0 [overflow-wrap:anywhere]">
              <span className="block text-sm font-bold text-slate-700">
                {label}
                {required ? <span className="text-rose-600"> *</span> : null}
              </span>
              <span className="mt-1 block text-xs leading-5 text-slate-500 sm:text-sm sm:leading-6">
                {description} {formPhotoLimitText()}
              </span>
            </span>
          </span>
          <span className="mt-3 flex min-w-0 flex-wrap items-center gap-2 text-xs font-bold text-slate-600">
            <span className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-2.5 text-[#0875d1] ring-1 ring-blue-100">
              <Plus className="h-3.5 w-3.5" />
              Добавить файлы
            </span>
            <span className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-2.5 ring-1 ring-slate-200">
              <Images className="h-3.5 w-3.5 text-slate-400" />
              {photos.length}/{normalizedMaxPhotos}
            </span>
          </span>
        </label>
        {photos.length ? (
          <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-2 sm:p-2.5">
            <div className="mb-2 flex min-w-0 items-center justify-between gap-2 px-1">
              <span className="text-xs font-black uppercase tracking-normal text-slate-500">Превью</span>
              <span className="text-xs font-bold text-slate-500">Первое фото - обложка</span>
            </div>
            <div className="grid max-h-[17.5rem] min-w-0 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3 lg:flex lg:max-h-none lg:grid-cols-none lg:overflow-x-auto lg:overflow-y-hidden lg:pb-1 lg:pr-0">
              {photos.map((photo, index) => (
                <figure key={photo.id} className="group relative aspect-square min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm lg:w-36 lg:shrink-0">
                  <StoredMediaImage src={photo.url} alt={photo.name} className="h-full w-full object-cover" />
                  {index === 0 ? (
                    <span className="absolute left-1.5 top-1.5 rounded-md bg-white/95 px-2 py-1 text-[0.68rem] font-black text-[#0875d1] shadow-sm">
                      Обложка
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => removePhoto(photo.id)}
                    className="absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-slate-700 shadow-sm transition hover:text-rose-600"
                    aria-label={`Убрать ${photo.name}`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setCropEditorId(photo.id)}
                    className="absolute bottom-1.5 left-1.5 rounded-lg bg-white/95 px-2 py-1 text-xs font-black text-[#0875d1] shadow-sm transition hover:text-[#0664b3] sm:bottom-2 sm:left-2 sm:px-2.5 sm:py-1.5"
                  >
                    <span className="lg:hidden">Кадр</span>
                    <span className="hidden lg:inline">Изменить кадр</span>
                  </button>
                </figure>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      {message ? <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{message}</p> : null}
      {photos
        .filter((photo) => photo.persisted)
        .map((photo) => (
          <input key={`hidden-${photo.id}`} type="hidden" name="existingPhotos" value={photo.url} />
        ))}
      <input type="hidden" name={`${name}Refs`} value={JSON.stringify(photos.map((photo) => photo.url))} />
      {cropEditorPhoto ? (
        <SquareImageCropper
          alt={cropEditorPhoto.name}
          onApply={(dataUrl) => applySquareCrop(cropEditorPhoto, dataUrl)}
          onCancel={() => setCropEditorId("")}
          src={cropEditorPhoto.sourceUrl}
          title="Кадр для карточки"
        />
      ) : null}
    </section>
  );
}
