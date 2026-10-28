"use client";

import { ChangeEvent, FormEvent, InputHTMLAttributes, useEffect, useState } from "react";
import { extractListingPriceDigits, maxListingPriceDigits } from "@/lib/listing-price";
import { capitalizeFirstTextLetter } from "@/lib/text-format";

type ValidationKind = "phone" | "internationalPhone" | "email" | "messenger" | "emailOrMessenger" | "salary" | "urlOrHandle" | "url";

type ValidatedInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> & {
  capitalizeFirstLetter?: boolean;
  validation?: ValidationKind;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
};

const maxPhoneLength = 18;
const phonePattern = "^\\+7-\\([0-9]{3}\\)-[0-9]{3}-[0-9]{2}-[0-9]{2}$";
const emailPattern = "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$";
const messengerPattern = "^(@[A-Za-z0-9_]{5,32}|https?://[^\\s]+)$";
const emailOrMessengerPattern = `(${emailPattern.slice(1, -1)}|@[A-Za-z0-9_]{5,32}|https?://[^\\s]+)`;
const urlOrHandlePattern = "^(@[A-Za-z0-9_.-]{2,64}|https?://[^\\s]+)$";
const urlPattern = "^https?://[^\\s]+$";

function sanitizePhone(value: string) {
  value = value.trim();
  // A country code must never be silently replaced with +7. Leave such input
  // visibly invalid for the +7 pattern so the user can correct it explicitly.
  if (/^\+(?!7)/.test(value)) return value.slice(0, 40);
  const digits = value.replace(/\D/g, "");

  if (!digits) {
    return "";
  }

  if (digits.length > 11 || digits.length === 11 && !/^[78]/.test(digits)) return value.slice(0, 40);
  const hasCountryPrefix = value.trimStart().startsWith('+7') || digits.length !== 10 && /^[78]/.test(digits);
  const nationalDigits = hasCountryPrefix ? digits.slice(1) : digits;
  const parts = [
    nationalDigits.slice(0, 3),
    nationalDigits.slice(3, 6),
    nationalDigits.slice(6, 8),
    nationalDigits.slice(8, 10),
  ];
  let formatted = "+7";

  if (parts[0]) {
    formatted += `-(${parts[0]}`;
  }

  if (parts[0].length === 3) {
    formatted += ")";
  }

  if (parts[1]) {
    formatted += `-${parts[1]}`;
  }

  if (parts[2]) {
    formatted += `-${parts[2]}`;
  }

  if (parts[3]) {
    formatted += `-${parts[3]}`;
  }

  return formatted.slice(0, maxPhoneLength);
}

function sanitizeNoSpaces(value: string) {
  return value.replace(/\s/g, "");
}

function sanitizeByValidation(value: string, validation?: ValidationKind, capitalizeFirstLetter = false) {
  if (validation === 'internationalPhone') return value.replace(/[^\d+ ().-]/g,'').slice(0,40);
  if (validation === "salary") {
    return extractListingPriceDigits(value);
  }

  if (validation === "phone") {
    return sanitizePhone(value);
  }

  if (validation === "email" || validation === "messenger" || validation === "emailOrMessenger" || validation === "urlOrHandle" || validation === "url") {
    return sanitizeNoSpaces(value);
  }

  return capitalizeFirstLetter ? capitalizeFirstTextLetter(value) : value;
}

function getValidationProps(validation?: ValidationKind) {
  if (validation === 'internationalPhone') return {autoComplete:'tel',inputMode:'tel' as const,maxLength:40,
    pattern:'\\+?[0-9 ()\\.\\-]{7,39}',title:'Введите номер с кодом страны, например +79991234567.',type:'tel'};
  if (validation === "salary") {
    return {
      autoComplete: "off",
      inputMode: "numeric" as const,
      maxLength: maxListingPriceDigits,
      pattern: "[0-9]*",
      title: "Введите сумму цифрами, например 80000.",
      type: "text",
    };
  }

  if (validation === "phone") {
    return {
      autoComplete: "tel",
      inputMode: "tel" as const,
      maxLength: maxPhoneLength,
      pattern: phonePattern,
      title: "Введите телефон в формате +7-(999)-999-99-99.",
      type: "tel",
    };
  }

  if (validation === "email") {
    return {
      autoComplete: "email",
      inputMode: "email" as const,
      pattern: emailPattern,
      title: "Введите email в формате name@example.ru.",
      type: "email",
    };
  }

  if (validation === "messenger") {
    return {
      autoComplete: "url",
      inputMode: "url" as const,
      pattern: messengerPattern,
      title: "Введите @username или ссылку на Telegram/WhatsApp.",
      type: "text",
    };
  }

  if (validation === "emailOrMessenger") {
    return {
      autoComplete: "url",
      inputMode: "text" as const,
      pattern: emailOrMessengerPattern,
      title: "Введите email, @username или ссылку на мессенджер.",
      type: "text",
    };
  }

  if (validation === "urlOrHandle") {
    return {
      autoComplete: "url",
      inputMode: "url" as const,
      pattern: urlOrHandlePattern,
      title: "Введите ссылку, начинающуюся с http:// или https://, или @username.",
      type: "text",
    };
  }

  if (validation === "url") {
    return {
      autoComplete: "url",
      inputMode: "url" as const,
      pattern: urlPattern,
      title: "Введите ссылку, начинающуюся с http:// или https://.",
      type: "url",
    };
  }

  return {};
}

export function ValidatedInput({ validation, defaultValue, value, onChange, onBeforeInput, onInput, capitalizeFirstLetter = false, ...props }: ValidatedInputProps) {
  const [innerValue, setInnerValue] = useState(() => sanitizeByValidation(String(value ?? defaultValue ?? ""), validation, capitalizeFirstLetter));
  const validationProps = getValidationProps(validation);

  function syncSanitizedValue(event: ChangeEvent<HTMLInputElement> | FormEvent<HTMLInputElement>) {
    // Do not restore mask punctuation while deleting: Backspace otherwise keeps
    // deleting the same automatically reinserted ')' forever (including on mobile).
    const deleting = validation === 'phone' && (event.nativeEvent as InputEvent).inputType?.startsWith('delete');
    const raw = event.currentTarget.value;
    const nextValue = deleting ? (/^\+?7?\D*$/.test(raw) ? '' : raw.replace(/[^\d]+$/, ''))
      : sanitizeByValidation(raw, validation, capitalizeFirstLetter);
    event.currentTarget.value = nextValue;
    setInnerValue(nextValue);
  }

  useEffect(() => {
    if (value !== undefined) {
      setInnerValue(sanitizeByValidation(String(value), validation, capitalizeFirstLetter));
    }
  }, [capitalizeFirstLetter, validation, value]);

  return (
    <input
      {...props}
      {...validationProps}
      value={innerValue}
      onBeforeInput={(event) => {
        onBeforeInput?.(event);

        if (event.defaultPrevented || (validation !== "phone" && validation !== "salary")) {
          return;
        }

        if (event.data && validation === "phone" && /[^\d()+\-\s]/.test(event.data)) {
          event.preventDefault();
        }

        if (event.data && validation === "salary" && /\D/.test(event.data)) {
          event.preventDefault();
        }
      }}
      onInput={(event) => {
        syncSanitizedValue(event);
        onInput?.(event);
      }}
      onChange={(event) => {
        syncSanitizedValue(event);
        onChange?.(event);
      }}
    />
  );
}
