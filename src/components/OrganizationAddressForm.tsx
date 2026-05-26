"use client";

import { useMemo, useState } from "react";
import { MapPin } from "lucide-react";
import { fairApplications, listings, specialists, vacancies, workRequests } from "@/lib/data";

type Suggestion = {
  label: string;
  hint: string;
};

const staticAddressSuggestions: Suggestion[] = [
  { label: "Краснодар, ул. Красная, 118", hint: "адрес" },
  { label: "Краснодар, ул. Красная, 5", hint: "адрес" },
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

const addressSuggestions = uniqueSuggestions([...staticAddressSuggestions, ...dynamicAddressSuggestions]);

function uniqueSuggestions(suggestions: Suggestion[]) {
  const used = new Set<string>();

  return suggestions.filter((suggestion) => {
    const key = suggestion.label.toLowerCase();

    if (used.has(key)) {
      return false;
    }

    used.add(key);
    return true;
  });
}

function filterSuggestions(value: string) {
  const query = value.trim().toLowerCase();

  if (!query) {
    return addressSuggestions.slice(0, 6);
  }

  return addressSuggestions.filter((suggestion) => suggestion.label.toLowerCase().includes(query)).slice(0, 6);
}

function parseCity(address: string) {
  return address.split(",")[0]?.trim() || "Краснодар";
}

export function OrganizationAddressForm() {
  const [address, setAddress] = useState("Краснодар, ул. Красная, 118");
  const [open, setOpen] = useState(false);
  const filteredSuggestions = useMemo(() => filterSuggestions(address), [address]);

  return (
    <div className="mt-6 grid gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        {[
          ["Регион", "Краснодарский край"],
          ["Город", parseCity(address)],
          ["Район", "Центральный округ"],
        ].map(([label, value]) => (
          <label className="grid gap-2 text-sm font-bold text-slate-700" key={label}>
            {label}
            <input className="h-11 rounded-lg border border-slate-300 px-3 font-normal outline-none focus:border-[#0875d1]" defaultValue={value} readOnly={label === "Город"} />
          </label>
        ))}
      </div>

      <label className="relative grid gap-2 text-sm font-bold text-slate-700">
        Адрес организации
        <span className="relative block">
          <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            name="organizationAddress"
            className="h-12 w-full rounded-xl border border-slate-300 pl-10 pr-4 font-normal outline-none focus:border-[#0875d1]"
            value={address}
            onChange={(event) => {
              setAddress(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 120)}
            placeholder="Начните вводить улицу, район или ориентир"
            autoComplete="off"
          />
        </span>
        {open && filteredSuggestions.length ? (
          <span className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl shadow-slate-900/10">
            {filteredSuggestions.map((suggestion) => (
              <button
                key={suggestion.label}
                type="button"
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm font-normal transition hover:bg-blue-50 hover:text-[#0875d1]"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setAddress(suggestion.label);
                  setOpen(false);
                }}
              >
                <span className="min-w-0 truncate font-semibold">{suggestion.label}</span>
                <span className="shrink-0 text-xs text-slate-500">{suggestion.hint}</span>
              </button>
            ))}
          </span>
        ) : null}
      </label>
    </div>
  );
}
