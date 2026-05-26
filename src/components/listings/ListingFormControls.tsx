"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import { cities, fairApplications, listings, region, specialists, vacancies, workRequests } from "@/lib/data";

type Suggestion = {
  label: string;
  hint?: string;
};

type PreviewPhoto = {
  id: string;
  name: string;
  url: string;
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

export function ListingLocationFields({ defaultCity }: { defaultCity?: string }) {
  return (
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
      event.target.value = "";
      return;
    }

    const nextPhotos = files.map((file) => {
      const url = URL.createObjectURL(file);
      urlsRef.current.push(url);

      return {
        id: `${file.name}-${file.size}-${url}`,
        name: file.name,
        url,
      };
    });

    setPhotos((current) => [...current, ...nextPhotos]);
    event.target.value = "";
  }

  function removePhoto(photo: PreviewPhoto) {
    URL.revokeObjectURL(photo.url);
    urlsRef.current = urlsRef.current.filter((url) => url !== photo.url);
    setPhotos((current) => current.filter((item) => item.id !== photo.id));
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
              <div
                className="aspect-square w-full bg-cover bg-center"
                role="img"
                aria-label={`Фото ${index + 1}: ${photo.name}`}
                style={{ backgroundImage: `url(${photo.url})` }}
              />
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
