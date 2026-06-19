"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cities } from "@/lib/data";

const sortedCities = [...cities].sort((left, right) => left.name.localeCompare(right.name, "ru"));

function sanitizeCityQuery(value: string) {
  return value.replace(/[^\p{L}\s-]/gu, "").replace(/\s{2,}/g, " ").replace(/-{2,}/g, "-").slice(0, 60);
}

export function CitySelectField({
  defaultValue = "",
  label,
  name = "city",
  required = false,
}: {
  defaultValue?: string;
  label: string;
  name?: string;
  required?: boolean;
}) {
  const initialValue = sortedCities.some((city) => city.name === defaultValue) ? defaultValue : "";
  const [value, setValue] = useState(initialValue);
  const [open, setOpen] = useState(false);
  const listboxId = useId();
  const rootRef = useRef<HTMLLabelElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const filteredCities = useMemo(() => {
    const normalizedQuery = value.trim().toLowerCase();

    if (!normalizedQuery) {
      return sortedCities;
    }

    return sortedCities.filter((city) => city.name.toLowerCase().startsWith(normalizedQuery));
  }, [value]);

  useEffect(() => {
    function handleDocumentClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleDocumentClick);
    return () => document.removeEventListener("mousedown", handleDocumentClick);
  }, []);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  function selectCity(cityName: string) {
    setValue(cityName);
    setOpen(false);
    inputRef.current?.blur();
  }

  function syncValidity(input: HTMLInputElement) {
    const valid = !input.value || sortedCities.some((city) => city.name === input.value);
    input.setCustomValidity(valid ? "" : "Выберите город из списка.");
  }

  return (
    <label ref={rootRef} className="form-field relative grid min-w-0 max-w-full gap-1.5 text-xs font-bold leading-4 text-slate-700 sm:gap-2 sm:text-sm" data-field-size="sm">
      <span className="break-words [overflow-wrap:anywhere]">{label}</span>
      <span className="relative block">
        <input
          ref={inputRef}
          name={name}
          value={value}
          required={required}
          onBlur={(event) => syncValidity(event.currentTarget)}
          onChange={(event) => {
            const nextValue = sanitizeCityQuery(event.currentTarget.value);

            setValue(nextValue);
            setOpen(true);
            event.currentTarget.setCustomValidity("");
          }}
          onFocus={() => setOpen(true)}
          className="h-10 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 pr-10 text-sm font-normal text-slate-950 outline-none transition placeholder:text-slate-400 hover:bg-slate-50 focus:border-[#0875d1] focus:ring-2 focus:ring-blue-100 sm:h-12 sm:px-4 sm:pr-11 sm:text-base"
          placeholder="Выберите город"
          autoComplete="off"
          role="combobox"
          aria-controls={listboxId}
          aria-expanded={open}
          aria-haspopup="listbox"
        />
        <button
          type="button"
          onClick={() => {
            if (open) {
              setOpen(false);
              inputRef.current?.blur();
              return;
            }

            setOpen(true);
            inputRef.current?.focus();
          }}
          className="absolute inset-y-0 right-2 inline-flex w-8 items-center justify-center text-slate-500"
          aria-label={open ? "Закрыть список городов" : "Открыть список городов"}
        >
          <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
        </button>
      </span>
      {open ? (
        <div id={listboxId} className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-xl border border-slate-200 bg-white p-2 shadow-xl shadow-slate-900/10" role="listbox">
          <div className="max-h-56 overflow-y-auto">
            {filteredCities.length ? (
              filteredCities.map((city) => {
                const active = city.name === value;

                return (
                  <button
                    key={city.slug}
                    type="button"
                    onClick={() => selectCity(city.name)}
                    className={`flex h-10 w-full items-center justify-between rounded-lg px-3 text-left text-sm font-semibold transition ${
                      active ? "bg-blue-50 text-[#0875d1]" : "text-slate-700 hover:bg-slate-50 hover:text-[#0875d1]"
                    }`}
                    role="option"
                    aria-selected={active}
                  >
                    <span className="min-w-0 break-words [overflow-wrap:anywhere]">{city.name}</span>
                    {active ? <span className="h-2 w-2 shrink-0 rounded-full bg-[#0875d1]" /> : null}
                  </button>
                );
              })
            ) : (
              <p className="px-3 py-3 text-sm font-semibold text-slate-500">Город не найден</p>
            )}
          </div>
        </div>
      ) : null}
    </label>
  );
}
