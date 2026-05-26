"use client";

import { ChangeEvent, FormEvent, InputHTMLAttributes, useEffect, useState } from "react";

type ValidationKind = "phone" | "email" | "messenger" | "url";

type ValidatedInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> & {
  validation?: ValidationKind;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
};

const maxPhoneDigits = 11;
const maxPhoneLength = 18;
const phonePattern = "^(?=(?:\\D*\\d){10,11}\\D*$)\\+?[0-9 ()-]+$";
const emailPattern = "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$";
const messengerPattern = "^(@[A-Za-z0-9_]{5,32}|https?://[^\\s]+)$";
const urlPattern = "^https?://[^\\s]+$";

function sanitizePhone(value: string) {
  let digitCount = 0;
  let sanitized = value.trimStart().startsWith("+") ? "+" : "";

  for (const char of value.replace(/\+/g, "")) {
    if (/\d/.test(char)) {
      if (digitCount >= maxPhoneDigits) {
        continue;
      }

      digitCount += 1;
      sanitized += char;
      continue;
    }

    if (/[()\-\s]/.test(char) && sanitized.length < maxPhoneLength) {
      sanitized += char;
    }
  }

  return sanitized.slice(0, maxPhoneLength);
}

function sanitizeNoSpaces(value: string) {
  return value.replace(/\s/g, "");
}

function sanitizeByValidation(value: string, validation?: ValidationKind) {
  if (validation === "phone") {
    return sanitizePhone(value);
  }

  if (validation === "email" || validation === "messenger" || validation === "url") {
    return sanitizeNoSpaces(value);
  }

  return value;
}

function getValidationProps(validation?: ValidationKind) {
  if (validation === "phone") {
    return {
      autoComplete: "tel",
      inputMode: "tel" as const,
      maxLength: maxPhoneLength,
      pattern: phonePattern,
      title: "Введите телефон: 10-11 цифр, можно использовать +, пробелы, скобки и дефисы.",
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

export function ValidatedInput({ validation, defaultValue, value, onChange, onBeforeInput, onInput, ...props }: ValidatedInputProps) {
  const [innerValue, setInnerValue] = useState(() => sanitizeByValidation(String(value ?? defaultValue ?? ""), validation));
  const validationProps = getValidationProps(validation);

  function syncSanitizedValue(event: ChangeEvent<HTMLInputElement> | FormEvent<HTMLInputElement>) {
    const nextValue = sanitizeByValidation(event.currentTarget.value, validation);
    event.currentTarget.value = nextValue;
    setInnerValue(nextValue);
  }

  useEffect(() => {
    if (value !== undefined) {
      setInnerValue(sanitizeByValidation(String(value), validation));
    }
  }, [validation, value]);

  return (
    <input
      {...props}
      {...validationProps}
      value={innerValue}
      onBeforeInput={(event) => {
        onBeforeInput?.(event);

        if (event.defaultPrevented || validation !== "phone") {
          return;
        }

        if (event.data && /[^\d()+\-\s]/.test(event.data)) {
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
