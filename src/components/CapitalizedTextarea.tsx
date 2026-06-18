"use client";

import type { FormEvent, TextareaHTMLAttributes } from "react";
import { capitalizeFirstTextLetter } from "@/lib/text-format";

type CapitalizedTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "defaultValue" | "onInput"> & {
  defaultValue?: string;
};

export function CapitalizedTextarea({ defaultValue, ...props }: CapitalizedTextareaProps) {
  function handleInput(event: FormEvent<HTMLTextAreaElement>) {
    event.currentTarget.value = capitalizeFirstTextLetter(event.currentTarget.value);
  }

  return <textarea {...props} defaultValue={defaultValue ? capitalizeFirstTextLetter(defaultValue) : defaultValue} onInput={handleInput} />;
}
