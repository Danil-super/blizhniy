"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
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
  required = false,
}: {
  name?: string;
  options: DropdownOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  buttonClassName?: string;
  required?: boolean;
}) {
  const [internalValue, setInternalValue] = useState(defaultValue ?? "");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [invalid, setInvalid] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef({text: "", time: 0});
  const rootRef = useRef<HTMLDivElement>(null);
  const id = useId(), listId = `${id}-list`, errorId = `${id}-error`;
  const selectedValue = value ?? internalValue;
  const selectedOption = useMemo(() => options.find((option) => option.value === selectedValue), [options, selectedValue]);

  useEffect(() => {
    function handleDocumentClick(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handleDocumentClick);
    return () => document.removeEventListener("pointerdown", handleDocumentClick);
  }, []);

  useEffect(() => {
    if (!open) return;
    if (!options.length) {setOpen(false); buttonRef.current?.focus(); return;}
    const item = rootRef.current?.querySelectorAll<HTMLElement>('[role="option"]')[Math.min(activeIndex, options.length - 1)];
    item?.focus({preventScroll: true});
    item?.scrollIntoView({block: "nearest"});
  }, [open, activeIndex, options]);

  useEffect(() => {
    if (value !== undefined || !internalValue || !options.length || options.some((option) => option.value === internalValue)) {
      return;
    }

    setInternalValue("");
  }, [internalValue, options, value]);

  useEffect(() => {
    if (!required || selectedOption) setInvalid(false);
  }, [required, selectedOption]);

  function choose(nextValue: string) {
    if (buttonRef.current?.matches(':disabled') || !options.some(option => option.value === nextValue)) return;
    setOpen(false);
    setInvalid(false);

    if (value === undefined) {
      setInternalValue(nextValue);
    }

    onValueChange?.(nextValue);
    buttonRef.current?.focus();
  }

  function reveal(index = Math.max(0, options.findIndex(option => option.value === selectedOption?.value))) {
    if (!options.length) return;
    searchRef.current.text = "";
    setActiveIndex(index);
    setOpen(true);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!options.length || event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent?.isComposing) return;
    if (event.key.length !== 1) searchRef.current.text = "";
    const index = Math.min(activeIndex, options.length - 1);
    if (event.key === "Tab") {
      if (open) setOpen(false);
      return;
    }
    if (event.key === "Escape") {
      if (!open) return;
      setOpen(false); buttonRef.current?.focus();
    } else if (event.key === "Enter" || event.key === " ") {
      if (open) choose(options[index].value); else reveal();
    } else if (["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp"].includes(event.key)) {
      if (event.key === "Home") reveal(0);
      else if (event.key === "End") reveal(options.length - 1);
      else if (!open) reveal();
      else setActiveIndex(Math.max(0, Math.min(options.length - 1, index + ({ArrowDown: 1, ArrowUp: -1, PageDown: 10, PageUp: -10}[event.key] ?? 0))));
    } else if (event.key.length === 1) {
      const character = event.key.toLocaleLowerCase("ru");
      const text = event.timeStamp - searchRef.current.time < 700 ? searchRef.current.text + character : character;
      searchRef.current = {text, time: event.timeStamp};
      const repeated = [...text].every(letter => letter === character), query = repeated ? character : text;
      const start = repeated ? (open ? index : options.findIndex(option => option === selectedOption)) + 1 : 0;
      const match = options.map((_, offset) => (start + offset) % options.length).find(next => options[next].label.toLocaleLowerCase("ru").startsWith(query));
      if (match !== undefined) {setActiveIndex(match); setOpen(true);}
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <div className="relative min-w-0 max-w-full" ref={rootRef} onKeyDown={handleKeyDown} onBlur={event => {if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);}}>
      {name ? <input type="hidden" name={name} value={selectedOption?.value ?? ""} /> : null}
      <button
        type="button"
        id={id}
        ref={buttonRef}
        onClick={() => {if (open) setOpen(false); else reveal();}}
        className={`flex h-12 w-full min-w-0 max-w-full items-center justify-between gap-3 rounded-lg border border-slate-300 bg-white px-4 text-left text-sm font-semibold text-slate-950 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-100 sm:text-base ${buttonClassName}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        aria-describedby={invalid ? errorId : undefined}
      >
        <span className={`min-w-0 whitespace-normal break-words leading-tight [overflow-wrap:anywhere] ${selectedOption ? "" : "text-slate-500"}`}>
          {selectedOption?.label ?? placeholder}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {required && name ? (
        <input
          className="pointer-events-none absolute h-px w-px opacity-0"
          tabIndex={-1}
          aria-hidden="true"
          aria-invalid={invalid || undefined}
          required
          value={selectedOption?.value ?? ""}
          onChange={() => undefined}
          onInvalid={event => {event.preventDefault(); setInvalid(true); buttonRef.current?.focus(); reveal();}}
        />
      ) : null}
      {open ? (
        <div id={listId} aria-labelledby={id} className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 max-h-72 overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white py-2 shadow-xl shadow-slate-900/10" role="listbox">
          {options.map((option, index) => {
            const active = option.value === selectedOption?.value;

            return (
              <button
                key={option.value}
                type="button"
                tabIndex={index === Math.min(activeIndex, options.length - 1) ? 0 : -1}
                onPointerDown={event => {if (event.pointerType === "mouse") event.preventDefault();}}
                onClick={event => {event.stopPropagation(); choose(option.value);}}
                onFocus={() => setActiveIndex(index)}
                className={`flex min-h-10 w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm font-semibold transition ${
                  active ? "bg-blue-50 text-[#0664b3]" : "text-slate-700 hover:bg-slate-50 hover:text-[#0664b3]"
                } focus:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-600`}
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
      {invalid ? <p id={errorId} role="alert" className="mt-1 text-sm font-semibold text-rose-700">Выберите значение из списка.</p> : null}
    </div>
  );
}
