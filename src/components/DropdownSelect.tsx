"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown } from "lucide-react";

export type DropdownOption = {
  value: string;
  label: string;
};

export function DropdownSelect({
  name,
  options,
  value,
  defaultValue,
  onValueChange,
  placeholder = "Выберите",
  buttonClassName = "",
}: {
  name?: string;
  options: DropdownOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  buttonClassName?: string;
}) {
  const [internalValue, setInternalValue] = useState(defaultValue ?? "");
  const [open, setOpen] = useState(false);
  const pointerSelectionRef = useRef<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedValue = value ?? internalValue;
  const selectedOption = useMemo(() => options.find((option) => option.value === selectedValue), [options, selectedValue]);

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
    if (value !== undefined || !internalValue || !options.length || options.some((option) => option.value === internalValue)) {
      return;
    }

    setInternalValue("");
  }, [internalValue, options, value]);

  function choose(nextValue: string) {
    setOpen(false);

    if (value === undefined) {
      setInternalValue(nextValue);
    }

    onValueChange?.(nextValue);
  }

  function chooseFromPointer(event: ReactPointerEvent<HTMLButtonElement>, nextValue: string) {
    event.preventDefault();
    event.stopPropagation();
    pointerSelectionRef.current = nextValue;
    choose(nextValue);
  }

  function chooseFromClick(event: ReactMouseEvent<HTMLButtonElement>, nextValue: string) {
    event.stopPropagation();

    if (pointerSelectionRef.current === nextValue) {
      pointerSelectionRef.current = null;
      return;
    }

    choose(nextValue);
  }

  return (
    <div className="relative min-w-0 max-w-full" ref={rootRef}>
      {name ? <input type="hidden" name={name} value={selectedOption?.value ?? ""} /> : null}
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`flex h-12 w-full min-w-0 max-w-full items-center justify-between gap-3 rounded-lg border border-slate-300 bg-white px-4 text-left text-sm font-semibold text-slate-950 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-100 sm:text-base ${buttonClassName}`}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className={`min-w-0 truncate ${selectedOption ? "" : "text-slate-400"}`}>{selectedOption?.label ?? placeholder}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white py-2 shadow-xl shadow-slate-900/10" role="listbox">
          {options.map((option) => {
            const active = option.value === selectedOption?.value;

            return (
              <button
                key={option.value}
                type="button"
                onPointerDown={(event) => chooseFromPointer(event, option.value)}
                onClick={(event) => chooseFromClick(event, option.value)}
                className={`flex min-h-10 w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm font-semibold transition ${
                  active ? "bg-blue-50 text-[#0875d1]" : "text-slate-700 hover:bg-slate-50 hover:text-[#0875d1]"
                }`}
                role="option"
                aria-selected={active}
              >
                <span className="min-w-0 [overflow-wrap:anywhere]">{option.label}</span>
                {active ? <span className="h-2 w-2 shrink-0 rounded-full bg-[#0875d1]" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
