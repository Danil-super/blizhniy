"use client";

/* eslint-disable @next/next/no-img-element */

import { ChangeEvent, useEffect, useRef, useState } from "react";
import { Camera, X } from "lucide-react";

type PreviewPhoto = {
  id: string;
  file?: File;
  name: string;
  persisted?: boolean;
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

export function FormPhotoUploader({
  defaultPhotos = [],
  description,
  label,
  name = "photos",
}: {
  defaultPhotos?: string[];
  description: string;
  label: string;
  name?: string;
}) {
  const [photos, setPhotos] = useState<PreviewPhoto[]>(
    defaultPhotos.map((url, index) => ({
      id: `persisted-${index}-${url.slice(0, 24)}`,
      name: `Фото ${index + 1}`,
      persisted: true,
      url,
    }))
  );
  const urlsRef = useRef<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const maxPhotos = 12;

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
        url,
      };
    });

    setPhotos((current) => {
      const next = [...current, ...nextPhotos].slice(0, maxPhotos);
      window.requestAnimationFrame(() => syncFileInput(inputRef.current, next));
      return next;
    });
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

  return (
    <section className="min-w-0 max-w-full overflow-hidden rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 sm:p-4">
      <label className="block cursor-pointer rounded-lg border border-dashed border-transparent p-2 transition hover:border-blue-200 hover:bg-white/70 sm:p-3">
        <input ref={inputRef} className="sr-only" name={name} type="file" accept="image/*" multiple onChange={handleFiles} />
        <span className="flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-[#0875d1] ring-1 ring-blue-100">
            <Camera className="h-5 w-5" />
          </span>
          <span className="min-w-0 [overflow-wrap:anywhere]">
            <span className="block text-sm font-bold text-slate-700">{label}</span>
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
            </figure>
          ))}
        </div>
      ) : null}
    </section>
  );
}
