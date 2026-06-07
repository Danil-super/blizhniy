"use client";

/* eslint-disable @next/next/no-img-element */

import { ChangeEvent, useEffect, useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import { SquareImageCropper } from "@/components/SquareImageCropper";

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
  return new File([blob], `${base}-preview.jpg`, { type: "image/jpeg" });
}

export function FormPhotoUploader({
  defaultPhotos = [],
  description,
  label,
  name = "photos",
  required = false,
}: {
  defaultPhotos?: string[];
  description: string;
  label: string;
  name?: string;
  required?: boolean;
}) {
  const [photos, setPhotos] = useState<PreviewPhoto[]>(
    defaultPhotos.map((url, index) => ({
      id: `persisted-${index}-${url.slice(0, 24)}`,
      name: `Фото ${index + 1}`,
      persisted: true,
      sourceUrl: url,
      url,
    }))
  );
  const [cropEditorId, setCropEditorId] = useState("");
  const urlsRef = useRef<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const maxPhotos = 12;
  const cropEditorPhoto = photos.find((photo) => photo.id === cropEditorId);

  useEffect(() => {
    return () => {
      urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      urlsRef.current = [];
    };
  }, []);

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const availableSlots = maxPhotos - photos.length;
    const files = Array.from(event.target.files ?? [])
      .filter((file) => file.type.startsWith("image/"))
      .slice(0, availableSlots);

    if (!files.length) {
      syncFileInput(inputRef.current, photos);
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
      const next = [...current, ...nextPhotos].slice(0, maxPhotos);
      window.requestAnimationFrame(() => syncFileInput(inputRef.current, next));
      return next;
    });
    setCropEditorId(nextPhotos[0]?.id ?? "");
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
    <section className="min-w-0 max-w-full overflow-hidden rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 sm:p-4">
      <label className="block cursor-pointer rounded-lg border border-dashed border-transparent p-2 transition hover:border-blue-200 hover:bg-white/70 sm:p-3">
        <input ref={inputRef} className="sr-only" name={name} type="file" accept="image/*" multiple required={required && !photos.length} onChange={handleFiles} />
        <span className="flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-[#0875d1] ring-1 ring-blue-100">
            <Camera className="h-5 w-5" />
          </span>
          <span className="min-w-0 [overflow-wrap:anywhere]">
            <span className="block text-sm font-bold text-slate-700">
              {label}
              {required ? <span className="text-rose-600"> *</span> : null}
            </span>
            <span className="mt-1 block text-xs leading-5 text-slate-500 sm:text-sm sm:leading-6">{description}</span>
          </span>
        </span>
      </label>
      {photos
        .filter((photo) => photo.persisted)
        .map((photo) => (
          <input key={`hidden-${photo.id}`} type="hidden" name="existingPhotos" value={photo.url} />
        ))}
      {photos.length ? (
        <div className="photo-preview-grid mt-4">
          {photos.map((photo) => (
            <figure key={photo.id} className="group relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-white">
              <img src={photo.url} alt={photo.name} className="h-full w-full object-contain p-1.5" />
              <button
                type="button"
                onClick={() => removePhoto(photo.id)}
                className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-slate-700 shadow-sm transition hover:text-rose-600"
                aria-label={`Убрать ${photo.name}`}
              >
                <X className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setCropEditorId(photo.id)}
                className="absolute bottom-2 left-2 rounded-lg bg-white/95 px-2.5 py-1.5 text-xs font-black text-[#0875d1] shadow-sm transition hover:text-[#0664b3]"
              >
                Кадр
              </button>
            </figure>
          ))}
        </div>
      ) : null}
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
